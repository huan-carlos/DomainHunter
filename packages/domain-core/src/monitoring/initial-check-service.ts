/**
 * Initial check runner (LEX-20, technical plan §4/§5/§10, AC01–AC03,
 * AC05, AC06, RNF-001, RNF-004, RNF-007, RNF-016, RNF-020).
 *
 * Executes one check pass over a `DomainWatch` using injected provider
 * adapters (structural subsets of the `@domainhunter/providers` contracts), runs
 * the pure state machine (`transitionDomainState`) and persists the result:
 * updated watch snapshot, audit events and `next_check_at` (AC03).
 *
 * The runner never touches the network itself — providers are injected
 * functions — so both `apps/server` (synchronous diagnostic on POST /domains)
 * and `apps/automations` (queued INITIAL job) share the exact same logic.
 * Per-source failures are isolated (RNF-004): a failing source produces a
 * technical error, never a false availability verdict (RNF-020, AC06).
 */
import type { DomainEvent } from "../entities/domain-event.ts";
import type { DomainWatch, DomainWatchStatus } from "../entities/domain-watch.ts";
import type { DomainEventRepository } from "../repositories/domain-event-repository.ts";
import type { DomainWatchRepository } from "../repositories/domain-watch-repository.ts";
import type { MonitoringPhase } from "../entities/domain-watch.ts";
import { priorityForState, transitionDomainState } from "../state-machine/state-machine.ts";
import type { DomainStateSnapshot } from "../state-machine/state-machine.ts";
import {
  normalizeIsavailRecord,
  normalizeRdapResult,
  normalizeWhoisRecord,
  type IsavailRecordLike,
  type NormalizedDomainInfo,
  type RdapResultLike,
  type WhoisRecordLike,
} from "../state-machine/normalize.ts";
import { computeNextCheckAt, derivePhase, type PhaseFrequency } from "./next-check-policy.ts";

/** Source identifiers the initial check can query. */
export type InitialCheckSource = "whois" | "rdap" | "isavail";

export type SourceStatus = "ok" | "error" | "skipped";

export interface InitialCheckProviders {
  whois?: (domain: string) => Promise<WhoisRecordLike>;
  rdap?: (domain: string) => Promise<RdapResultLike>;
  isavail?: (domain: string) => Promise<IsavailRecordLike>;
}

export interface InitialCheckServiceDeps {
  watches: DomainWatchRepository;
  events: DomainEventRepository;
  /** Clock for timestamps (defaults to now, ISO-8601 UTC). */
  clock?: () => string;
  /** Phase→frequency overrides (RNF-021); defaults from the plan §7. */
  frequencies?: Partial<Record<MonitoringPhase, PhaseFrequency>>;
  /** Pre-expiration window for phase B derivation (defaults to 45 days). */
  approachingWindowMs?: number;
}

export interface InitialCheckOutcome {
  /** Updated watch after the pass; null when the watch no longer exists. */
  watch: DomainWatch | null;
  /** Audit events persisted for this pass (AC10). */
  events: DomainEvent[];
  /** Per-source result (ok/error/skipped) for the diagnostic response. */
  sources: Record<InitialCheckSource, SourceStatus>;
  /** True when every configured source failed at transport level. */
  technicalFailure: boolean;
}

/** Map a `DomainWatch` row onto the machine snapshot. */
function snapshotFromWatch(watch: DomainWatch): DomainStateSnapshot {
  return {
    status: watch.status,
    rawLastStatus: watch.rawLastStatus,
    expirationAt: watch.expirationAt,
    lastKnownOwner: watch.lastKnownOwner,
    lastKnownOwnerId: watch.lastKnownOwnerId,
    availableSince: watch.availableSince,
    releaseStartAt: watch.releaseStartAt,
    releaseEndAt: watch.releaseEndAt,
    checkFailureCount: watch.checkFailureCount,
    lastCheckAt: watch.lastCheckAt,
    lastSuccessfulCheckAt: watch.lastSuccessfulCheckAt,
    lastWhoisCheckAt: watch.lastWhoisCheckAt,
    lastRdapCheckAt: watch.lastRdapCheckAt,
    lastIsavailCheckAt: watch.lastIsavailCheckAt,
  };
}

export function createInitialCheckService(deps: InitialCheckServiceDeps) {
  const clock = deps.clock ?? (() => new Date().toISOString());

  async function run(input: {
    watchId: string;
    providers: InitialCheckProviders;
  }): Promise<InitialCheckOutcome> {
    const watch = deps.watches.findById(input.watchId);
    if (!watch) {
      return {
        watch: null,
        events: [],
        sources: { whois: "skipped", rdap: "skipped", isavail: "skipped" },
        technicalFailure: true,
      };
    }

    const observations: NormalizedDomainInfo[] = [];
    const sources: Record<InitialCheckSource, SourceStatus> = {
      whois: "skipped",
      rdap: "skipped",
      isavail: "skipped",
    };
    const failures: string[] = [];

    async function collect(
      source: InitialCheckSource,
      query: () => Promise<WhoisRecordLike | RdapResultLike | IsavailRecordLike>,
    ): Promise<void> {
      sources[source] = "error";
      try {
        const record = await query();
        if (source === "whois") observations.push(normalizeWhoisRecord(record as WhoisRecordLike));
        else if (source === "rdap") observations.push(normalizeRdapResult(record as RdapResultLike));
        else observations.push(normalizeIsavailRecord(record as IsavailRecordLike));
        sources[source] = "ok";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${source}: ${message}`);
      }
    }

    if (input.providers.whois) await collect("whois", () => input.providers.whois!(watch.domain));
    if (input.providers.rdap) await collect("rdap", () => input.providers.rdap!(watch.domain));
    if (input.providers.isavail) await collect("isavail", () => input.providers.isavail!(watch.domain));

    const now = clock();
    const checkFailed = observations.length === 0;
    const result = transitionDomainState({
      current: snapshotFromWatch(watch),
      observations,
      now,
      ...(deps.approachingWindowMs != null ? { approachingWindowMs: deps.approachingWindowMs } : {}),
      checkFailed,
      ...(checkFailed
        ? { checkFailureMessage: failures.join("; ") || "no source responded" }
        : {}),
    });

    const events = result.events.map((event) =>
      deps.events.create({
        domainWatchId: watch.id,
        type: event.type,
        source: event.source,
        sourceVersion: event.sourceVersion,
        occurredAt: event.occurredAt,
        previousValue: event.previousValue,
        newValue: event.newValue,
        evidenceJson: event.evidenceJson,
        priority: event.priority,
      }),
    );

    const phase = derivePhase(result.next.status);
    const nextCheckAt = computeNextCheckAt(phase, now, deps.frequencies);
    const clientVersions: Record<string, string> = {};
    for (const observation of observations) {
      clientVersions[observation.source] = observation.sourceVersion;
    }

    const updated = deps.watches.update(watch.id, {
      status: result.next.status,
      rawLastStatus: result.next.rawLastStatus,
      priority: priorityForState(result.next.status),
      expirationAt: result.next.expirationAt,
      lastKnownOwner: result.next.lastKnownOwner,
      lastKnownOwnerId: result.next.lastKnownOwnerId,
      releaseStartAt: result.next.releaseStartAt,
      releaseEndAt: result.next.releaseEndAt,
      availableSince: result.next.availableSince,
      checkFailureCount: result.next.checkFailureCount,
      lastCheckAt: result.next.lastCheckAt,
      lastSuccessfulCheckAt: result.next.lastSuccessfulCheckAt,
      lastWhoisCheckAt: result.next.lastWhoisCheckAt,
      lastRdapCheckAt: result.next.lastRdapCheckAt,
      lastIsavailCheckAt: result.next.lastIsavailCheckAt,
      phase,
      nextCheckAt,
      clientVersions,
    });

    return {
      watch: updated,
      events,
      sources,
      technicalFailure: checkFailed,
    };
  }

  return { run };
}

export type InitialCheckService = ReturnType<typeof createInitialCheckService>;
