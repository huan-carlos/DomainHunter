/**
 * Release scan service (LEX-25): applies the official release publications
 * (calendar + public lists) to the persisted `DomainWatch` set.
 *
 * The service is repository-backed and side-effect driven, but it never
 * touches the network — it consumes already-normalized `ReleaseCalendarLike`
 * / `ReleaseListLike` records (produced by the versioned collector in
 * `@domainhunter/providers`) and decides transitions with the pure
 * `decideReleaseTransition` function. Unknown formats never reach this
 * layer: they surface as `ReleaseError` at the collector boundary and the
 * caller records a technical error while preserving the last confirmed
 * state (LEX-25 AC10, RN07).
 *
 * Flow per publication run:
 *   1. derive the release process period and upsert the `ReleaseProcess`;
 *   2. for every active watch, decide the transition from the lists
 *      (competitive > release > eligible when a domain appears in several);
 *   3. update the watch (state, priority, process links, phase D) and emit
 *      the corresponding events with evidence (RNF-007, AC10).
 */
import type { DomainEvent } from "../entities/domain-event.ts";
import type { DomainWatch } from "../entities/domain-watch.ts";
import type { ReleaseProcess, ReleaseProcessStatus } from "../entities/release-process.ts";
import type { DomainEventRepository } from "../repositories/domain-event-repository.ts";
import type { DomainWatchRepository } from "../repositories/domain-watch-repository.ts";
import type { ReleaseProcessRepository } from "../repositories/release-process-repository.ts";
import { decideReleaseTransition, type ReleaseListLike } from "./release-decision.ts";

/** Structural subset of `ReleaseCalendarRecord` from `@domainhunter/providers`. */
export interface ReleaseCalendarLike {
  startsAt: string | null;
  endsAt: string | null;
  publish: boolean;
  next: string[];
  sourceVersion: string;
  raw: string;
}

export interface ReleaseScanServiceDeps {
  watches: DomainWatchRepository;
  processes: ReleaseProcessRepository;
  events: DomainEventRepository;
  /** Clock for collectedAt/occurredAt (defaults to now, ISO-8601 UTC). */
  clock?: () => string;
}

export interface ReleasePublicationInput {
  calendar?: ReleaseCalendarLike | null;
  lists: ReleaseListLike[];
}

export interface ReleaseScanResult {
  /** The release process the publications refer to (created or existing). */
  process: ReleaseProcess | null;
  /** Watches whose state/priority/process linkage was updated. */
  updatedWatches: DomainWatch[];
  /** Events created for the observed changes. */
  createdEvents: DomainEvent[];
  /** Watches the lists were compared against. */
  consideredWatches: number;
}

/** Derive a stable process reference from the publication period. */
export function releaseProcessReference(
  calendar: ReleaseCalendarLike | null | undefined,
  lists: ReleaseListLike[],
): string {
  const firstList = lists[0];
  const periodStart = calendar?.startsAt ?? firstList?.periodStart ?? null;
  if (periodStart) return `release-process@${periodStart}`;
  return `release-process@unknown`;
}

/** Derive the process status from the publication contents. */
export function releaseProcessStatus(
  calendar: ReleaseCalendarLike | null | undefined,
  lists: ReleaseListLike[],
): ReleaseProcessStatus {
  if (lists.some((list) => list.kind === "competitive")) return "COMPETITIVE";
  if (lists.some((list) => list.kind === "eligible")) return "CANDIDATURE_OPEN";
  if (calendar?.publish ?? lists.length > 0) return "DETECTED";
  return "DETECTED";
}

/** Preferred ordering when a domain appears in several lists. */
const KIND_ORDER: Record<ReleaseListLike["kind"], number> = {
  competitive: 0,
  release: 1,
  eligible: 2,
};

export function createReleaseScanService(deps: ReleaseScanServiceDeps) {
  const clock = deps.clock ?? (() => new Date().toISOString());

  function evidenceFor(list: ReleaseListLike): string {
    return JSON.stringify({
      kind: list.kind,
      sourceUrl: list.sourceUrl,
      sourceVersion: list.sourceVersion,
      periodStart: list.periodStart,
      periodEnd: list.periodEnd,
      generatedAt: list.generatedAt,
      domains: list.domains,
    });
  }

  /** Upsert the release process for the current publication window. */
  function upsertProcess(input: ReleasePublicationInput): ReleaseProcess {
    const reference = releaseProcessReference(input.calendar ?? null, input.lists);
    const existing = deps.processes.findBySourceReference(reference);
    const collectedAt = clock();
    const startAt =
      input.calendar?.startsAt ?? input.lists[0]?.periodStart ?? null;
    const endAt = input.calendar?.endsAt ?? input.lists[0]?.periodEnd ?? null;
    const publicationAt = input.calendar?.publish
      ? (input.lists[0]?.generatedAt ?? collectedAt)
      : null;
    const status = releaseProcessStatus(input.calendar ?? null, input.lists);

    if (existing) {
      return (
        deps.processes.update(existing.id, {
          startAt,
          endAt,
          publicationAt,
          status,
          source: "release_collector",
          rawJson: input.calendar?.raw ?? null,
          collectedAt,
        }) ?? existing
      );
    }

    return deps.processes.create({
      sourceReference: reference,
      startAt,
      endAt,
      publicationAt,
      candidatureWindowStartAt: null,
      candidatureWindowEndAt: null,
      status,
      source: "release_collector",
      rawJson: input.calendar?.raw ?? null,
      collectedAt,
    });
  }

  /** Apply one publication run to the active watch set. */
  function apply(input: ReleasePublicationInput): ReleaseScanResult {
    const process = upsertProcess(input);
    const watches = deps.watches.findAll().filter((watch) => watch.monitoringState === "ACTIVE");
    const updatedWatches: DomainWatch[] = [];
    const createdEvents: DomainEvent[] = [];

    for (const watch of watches) {
      // Best (highest-priority) decision for this watch across all lists.
      const decisions = input.lists
        .map((list) =>
          decideReleaseTransition(watch.status, watch.priority, watch.domain, list),
        )
        .filter((decision) => decision !== null)
        .sort(
          (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
        );
      const decision = decisions[0];
      if (!decision) continue;

      const changed = decision.statusChanged || decision.priorityElevated;
      const updated = deps.watches.update(watch.id, {
        status: decision.nextStatus,
        priority: decision.priority,
        phase: "D",
        releaseProcessId: process.id,
        releaseStartAt: process.startAt,
        releaseEndAt: process.endAt,
        rawLastStatus: watch.rawLastStatus,
      });
      if (updated) updatedWatches.push(updated);

      // Events are only produced for an observed change (RNF-003
      // idempotency): re-scanning an already-linked watch must not spam the
      // timeline with duplicate entries.
      if (!changed) continue;
      const occurredAt = clock();
      const sourceList = input.lists.find((list) => list.kind === decision.kind)!;
      for (const eventType of decision.eventTypes) {
        const event = deps.events.create({
          domainWatchId: watch.id,
          type: eventType,
          source: "release_collector",
          sourceVersion: decision.sourceVersion,
          occurredAt,
          previousValue: watch.status,
          newValue: decision.nextStatus,
          evidenceJson: evidenceFor(sourceList),
          priority: decision.priority,
        });
        createdEvents.push(event);
      }
    }

    return {
      process,
      updatedWatches,
      createdEvents,
      consideredWatches: watches.length,
    };
  }

  return { apply };
}

export type ReleaseScanService = ReturnType<typeof createReleaseScanService>;
