/**
 * Pure decision logic for the release process collector (LEX-25, AC07/AC08).
 *
 * Given a published official list and a watched domain, decides whether the
 * watch is present in a release publication and what state/priority/event
 * that implies. The three official list kinds map to distinct internal
 * states:
 *
 * - `release`      (lista-processo-liberacao.txt)     → `RELEASE_PROCESS`
 * - `eligible`     (lista-competicao.txt)             → `RELEASE_PENDING`
 * - `competitive`  (lista-processo-competitivo.txt)   → `COMPETITIVE_RELEASE`
 *
 * AC08 (concorrência): presence in the competitive publication raises the
 * watch priority to `CRITICAL` and emits `COMPETITIVE_PROCESS_DETECTED`.
 *
 * This module is pure (no I/O) so it is trivially testable; the repository
 * wiring that applies a decision lives in `release-scan-service.ts`.
 */
import type { DomainEventType } from "../entities/domain-event.ts";
import type { DomainWatchStatus, WatchPriority } from "../entities/domain-watch.ts";

/** The three official public release publications. */
export type ReleaseListKind = "release" | "competitive" | "eligible";

/** Structural subset of `ReleaseListRecord` from `@domainhunter/providers`. */
export interface ReleaseListLike {
  kind: ReleaseListKind;
  domains: string[];
  periodStart: string | null;
  periodEnd: string | null;
  generatedAt: string | null;
  sourceUrl: string;
  sourceVersion: string;
}

/** Priority rank used to decide elevation (higher wins). */
export const WATCH_PRIORITY_RANK: Record<WatchPriority, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

/** Map each official list kind to the resulting internal domain state. */
export const RELEASE_KIND_TO_STATE: Record<ReleaseListKind, DomainWatchStatus> = {
  release: "RELEASE_PROCESS",
  eligible: "RELEASE_PENDING",
  competitive: "COMPETITIVE_RELEASE",
};

/** Map each official list kind to the notifiable event it produces. */
export const RELEASE_KIND_TO_EVENT: Record<ReleaseListKind, DomainEventType> = {
  release: "DOMAIN_ENTERED_RELEASE",
  eligible: "CANDIDATURE_WINDOW_OPEN",
  competitive: "COMPETITIVE_PROCESS_DETECTED",
};

/** Map each official list kind to the priority it should carry (AC08). */
export const RELEASE_KIND_TO_PRIORITY: Record<ReleaseListKind, WatchPriority> = {
  release: "HIGH",
  eligible: "HIGH",
  competitive: "CRITICAL",
};

/** A decided transition for one watched domain found in a publication. */
export interface ReleaseTransitionDecision {
  kind: ReleaseListKind;
  domain: string;
  currentStatus: DomainWatchStatus;
  nextStatus: DomainWatchStatus;
  statusChanged: boolean;
  priority: WatchPriority;
  priorityElevated: boolean;
  eventTypes: DomainEventType[];
  sourceVersion: string;
  sourceUrl: string;
}

/**
 * Decide the transition for a single watch given one published list.
 *
 * Returns `null` when the domain is not present in the list. When present,
 * the decision always carries the target state and priority; the
 * `statusChanged`/`priorityElevated` flags tell the caller whether emitting
 * events and updating the watch is actually needed (idempotency — RNF-003:
 * events are only produced for an observed change).
 */
export function decideReleaseTransition(
  watchStatus: DomainWatchStatus,
  watchPriority: WatchPriority,
  domain: string,
  list: ReleaseListLike,
): ReleaseTransitionDecision | null {
  if (!list.domains.includes(domain)) return null;

  const nextStatus = RELEASE_KIND_TO_STATE[list.kind];
  const priority = RELEASE_KIND_TO_PRIORITY[list.kind];
  const eventTypes: DomainEventType[] = [RELEASE_KIND_TO_EVENT[list.kind]];

  return {
    kind: list.kind,
    domain,
    currentStatus: watchStatus,
    nextStatus,
    statusChanged: watchStatus !== nextStatus,
    priority,
    priorityElevated: WATCH_PRIORITY_RANK[priority] > WATCH_PRIORITY_RANK[watchPriority],
    eventTypes,
    sourceVersion: list.sourceVersion,
    sourceUrl: list.sourceUrl,
  };
}
