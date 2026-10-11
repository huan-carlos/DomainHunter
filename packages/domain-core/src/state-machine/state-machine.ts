/**
 * Pure domain state machine (technical plan §293-348, product brief AC04/AC05/
 * AC06/AC10, RNF-001, RNF-002, RNF-007, RNF-020).
 *
 * This module is the single decision point that turns normalized observations
 * (see `normalize.ts`) into the next confirmed domain state and the audit
 * events that back it. It is intentionally free of I/O: repositories, workers
 * and the API call `transitionDomainState` and persist the returned snapshot
 * and events.
 *
 * Main chain: REGISTERED → EXPIRATION_APPROACHING → POST_EXPIRATION_MONITORING
 * → RELEASE_PENDING → RELEASE_PROCESS → AVAILABLE, with the alternative states
 * RENEWED, UNKNOWN, CHECK_FAILED, COMPETITIVE_RELEASE and MONITORING_STOPPED.
 *
 * Critical invariants:
 * - `AVAILABLE` is reached **only** through a valid ISAVAIL availability
 *   response (status 0/1). An expiration date, a NOT_FOUND whois reply or any
 *   failure never produces `AVAILABLE` (AC05, AC06, RNF-020).
 * - Technical failures (transport errors, unknown ISAVAIL codes, parser
 *   errors) never change the last confirmed domain state (RNF-001, RNF-007).
 * - A renewal is a **positive and confirmed** increase of the expiry date from
 *   a cadastral source; it signals `DOMAIN_RENEWED` (AC04).
 * - Every state change and every confirmed signal is emitted as an event with
 *   source, source version, timestamp and normalized evidence (AC10).
 */
import type {
  DomainWatchStatus,
  WatchPriority,
} from "../entities/domain-watch.ts";
import type { DomainEventSource, DomainEventType } from "../entities/domain-event.ts";
import {
  mapIsavailStatusToDomainState,
  ISAVAIL_MAPPING_VERSION,
} from "../mapping/isavail.ts";
import type { NormalizedDomainInfo } from "./normalize.ts";

/** Version of the state machine contract (RNF-016). */
export const DOMAIN_STATE_MACHINE_VERSION = "state-machine@v1";

/**
 * Default pre-expiration window: 45 days (technical plan §7, fase B).
 * Configurable per transition for tests and RNF-021 policy changes.
 */
export const DEFAULT_APPROACHING_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;

/**
 * Subset of `DomainWatch` the machine reasons about. It carries the last
 * confirmed state plus the confirmed cadastral facts the machine must
 * preserve on technical failure.
 */
export interface DomainStateSnapshot {
  status: DomainWatchStatus;
  /** Raw status last observed by the availability mechanism (RNF-007). */
  rawLastStatus: string | null;
  /** Last confirmed expiry date, ISO-8601 UTC. */
  expirationAt: string | null;
  lastKnownOwner: string | null;
  lastKnownOwnerId: string | null;
  /** First confirmation of availability (AC05, RNF-014). */
  availableSince: string | null;
  releaseStartAt: string | null;
  releaseEndAt: string | null;
  checkFailureCount: number;
  lastCheckAt: string | null;
  lastSuccessfulCheckAt: string | null;
  lastWhoisCheckAt: string | null;
  lastRdapCheckAt: string | null;
  lastIsavailCheckAt: string | null;
}

/** Audit event produced by a transition (persisted by the caller, AC10). */
export interface StateTransitionEvent {
  type: DomainEventType;
  source: DomainEventSource;
  sourceVersion: string;
  occurredAt: string;
  previousValue: string | null;
  newValue: string | null;
  /** Normalized evidence, JSON (raw response or summary, RNF-007). */
  evidenceJson: string;
  priority: WatchPriority | null;
}

export interface DomainStateTransition {
  /** Last confirmed snapshot before this check. */
  current: DomainStateSnapshot;
  /** Successful normalized responses gathered during this check pass. */
  observations: NormalizedDomainInfo[];
  /** Current instant, ISO-8601 UTC (RNF-018). */
  now: string;
  /** Pre-expiration window; defaults to 45 days. */
  approachingWindowMs?: number;
  /**
   * True when the whole check failed at the transport level (no valid
   * response from any source). Preserves the confirmed state (RNF-001).
   */
  checkFailed?: boolean;
  /** Reason attached to the CHECK_FAILED event when `checkFailed`. */
  checkFailureMessage?: string | null;
}

export interface DomainTransitionResult {
  next: DomainStateSnapshot;
  events: StateTransitionEvent[];
  stateChanged: boolean;
}

/** States that can be re-derived from the cadastral expiry date. */
const EXPIRATION_DERIVABLE: ReadonlySet<DomainWatchStatus> = new Set([
  "UNKNOWN",
  "CHECK_FAILED",
  "REGISTERED",
  "EXPIRATION_APPROACHING",
  "POST_EXPIRATION_MONITORING",
  "RENEWED",
]);

function epochMs(iso: string | null): number {
  if (iso == null) return Number.NaN;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NaN : ms;
}

function isPastOrNow(iso: string, now: string): boolean {
  return epochMs(iso) <= epochMs(now);
}

/** Apply the monitoring derivation to a derivable state from the expiry date. */
function deriveFromExpiration(
  status: DomainWatchStatus,
  expirationAt: string | null,
  now: string,
  approachingWindowMs: number,
): DomainWatchStatus {
  if (expirationAt == null) return status;
  if (isPastOrNow(expirationAt, now)) return "POST_EXPIRATION_MONITORING";
  const remainingMs = epochMs(expirationAt) - epochMs(now);
  if (remainingMs <= approachingWindowMs) return "EXPIRATION_APPROACHING";
  return "REGISTERED";
}

function evidenceFor(observations: NormalizedDomainInfo[]): string {
  return JSON.stringify(
    observations.map((o) => ({
      source: o.source,
      sourceVersion: o.sourceVersion,
      domain: o.domain,
      exists: o.exists,
      status: o.status,
      expiresAt: o.expiresAt,
      available: o.available,
      rawLastStatus: o.rawLastStatus,
      queriedAt: o.queriedAt,
    })),
  );
}

function makeEvent(
  type: DomainEventType,
  source: DomainEventSource,
  sourceVersion: string,
  occurredAt: string,
  previousValue: string | null,
  newValue: string | null,
  evidenceJson: string,
  priority: WatchPriority | null,
): StateTransitionEvent {
  return { type, source, sourceVersion, occurredAt, previousValue, newValue, evidenceJson, priority };
}

/**
 * Transition the domain to its next confirmed state from a check pass.
 *
 * @returns the next snapshot and the events that must be persisted (AC10).
 */
export function transitionDomainState(
  input: DomainStateTransition,
): DomainTransitionResult {
  const { current, observations, now } = input;
  const approachingWindowMs = input.approachingWindowMs ?? DEFAULT_APPROACHING_WINDOW_MS;
  const checkFailed = input.checkFailed ?? false;
  const events: StateTransitionEvent[] = [];
  const next: DomainStateSnapshot = { ...current };

  const whoisObs = observations.find((o) => o.source === "whois");
  const rdapObs = observations.find((o) => o.source === "rdap");
  const isavailObs = observations.find((o) => o.source === "isavail");
  const cadastral = whoisObs ?? rdapObs;

  // ---- Technical failure: no valid response from any source ----
  // Preserve the last confirmed state untouched (RNF-001, RNF-007, AC09).
  if (checkFailed && observations.length === 0) {
    next.lastCheckAt = now;
    next.checkFailureCount = next.checkFailureCount + 1;
    events.push(
      makeEvent(
        "CHECK_FAILED",
        "system",
        DOMAIN_STATE_MACHINE_VERSION,
        now,
        null,
        input.checkFailureMessage ?? null,
        evidenceFor(observations),
        null,
      ),
    );
    return { next, events, stateChanged: false };
  }

  // ---- Successful check: reset failure bookkeeping ----
  next.lastCheckAt = now;
  next.checkFailureCount = 0;
  next.lastSuccessfulCheckAt = now;
  if (whoisObs) next.lastWhoisCheckAt = now;
  if (rdapObs) next.lastRdapCheckAt = now;
  if (isavailObs) next.lastIsavailCheckAt = now;

  // ---- Confirmed cadastral facts (owner, raw status) ----
  if (cadastral) {
    if (cadastral.owner != null) next.lastKnownOwner = cadastral.owner;
    if (cadastral.ownerId != null) next.lastKnownOwnerId = cadastral.ownerId;
  }
  next.rawLastStatus = isavailObs?.rawLastStatus ?? cadastral?.rawLastStatus ?? current.rawLastStatus;

  // ---- Expiry date + renewal detection (AC04) ----
  let renewalThisPass = false;
  if (cadastral && cadastral.expiresAt != null) {
    const prevExp = current.expirationAt;
    const newExp = cadastral.expiresAt;
    if (prevExp != null && newExp !== prevExp) {
      const renewed = epochMs(newExp) > epochMs(prevExp);
      renewalThisPass = renewed;
      events.push(
        makeEvent(
          "DOMAIN_EXPIRATION_CHANGED",
          cadastral.source,
          cadastral.sourceVersion,
          now,
          prevExp,
          newExp,
          evidenceFor(observations),
          renewed ? "HIGH" : "MEDIUM",
        ),
      );
      if (renewed) {
        events.push(
          makeEvent(
            "DOMAIN_RENEWED",
            cadastral.source,
            cadastral.sourceVersion,
            now,
            prevExp,
            newExp,
            evidenceFor(observations),
            "HIGH",
          ),
        );
        next.status = "RENEWED";
        next.availableSince = null;
      }
    }
    next.expirationAt = newExp;
  } else if (isavailObs && isavailObs.expiresAt != null) {
    // ISAVAIL status 2 also publishes an expiry date; fall back to it.
    next.expirationAt = isavailObs.expiresAt;
  }

  // ---- Availability verdict (only the availability mechanism decides) ----
  let verdict: "available" | "unavailable" | "unknown" = "unknown";
  if (isavailObs) {
    const mapped = mapIsavailStatusToDomainState(isavailObs.isavailStatusCode ?? -1);
    if (isavailObs.available && mapped === "AVAILABLE") {
      verdict = "available";
    } else if (mapped === "UNKNOWN" || mapped === "CHECK_FAILED") {
      verdict = "unknown";
    } else {
      verdict = "unavailable";
    }
  }

  const previousStatus = next.status;

  if (verdict === "available") {
    // ---- Confirmed AVAILABLE (AC05, RNF-020) — the only path here. ----
    if (next.status !== "AVAILABLE") {
      events.push(
        makeEvent(
          "DOMAIN_STATUS_CHANGED",
          isavailObs!.source,
          isavailObs!.sourceVersion,
          now,
          previousStatus,
          "AVAILABLE",
          evidenceFor(observations),
          null,
        ),
      );
      events.push(
        makeEvent(
          "DOMAIN_AVAILABLE",
          isavailObs!.source,
          isavailObs!.sourceVersion,
          now,
          previousStatus,
          "AVAILABLE",
          evidenceFor(observations),
          "CRITICAL",
        ),
      );
    }
    next.status = "AVAILABLE";
    if (next.availableSince == null) next.availableSince = now;
    next.releaseStartAt = null;
    next.releaseEndAt = null;
  } else if (verdict === "unavailable") {
    // ---- ISAVAIL confirmed the name is NOT available for registration. ----
    const mapped = mapIsavailStatusToDomainState(isavailObs!.isavailStatusCode ?? -1);
    if (mapped === "RELEASE_PENDING" || mapped === "RELEASE_PROCESS" || mapped === "COMPETITIVE_RELEASE") {
      if (next.status !== mapped) {
        events.push(
          makeEvent(
            "DOMAIN_STATUS_CHANGED",
            isavailObs!.source,
            isavailObs!.sourceVersion,
            now,
            previousStatus,
            mapped,
            evidenceFor(observations),
            null,
          ),
        );
        const releaseEvent: DomainEventType =
          mapped === "RELEASE_PENDING"
            ? "DOMAIN_RELEASE_DETECTED"
            : mapped === "RELEASE_PROCESS"
              ? "DOMAIN_ENTERED_RELEASE"
              : "COMPETITIVE_PROCESS_DETECTED";
        events.push(
          makeEvent(
            releaseEvent,
            isavailObs!.source,
            isavailObs!.sourceVersion,
            now,
            previousStatus,
            mapped,
            evidenceFor(observations),
            "HIGH",
          ),
        );
      }
      next.status = mapped;
      if (isavailObs!.releaseBeginAt != null) next.releaseStartAt = isavailObs!.releaseBeginAt;
      if (isavailObs!.releaseEndAt != null) next.releaseEndAt = isavailObs!.releaseEndAt;
      next.availableSince = null;
    } else {
      // Registered / reserved (ISAVAIL statuses 2/3): derive from the expiry
      // date. Expiry without availability never produces AVAILABLE (AC06).
      if (next.status === "AVAILABLE") {
        events.push(
          makeEvent(
            "DOMAIN_UNAVAILABLE",
            isavailObs!.source,
            isavailObs!.sourceVersion,
            now,
            "AVAILABLE",
            "REGISTERED",
            evidenceFor(observations),
            "MEDIUM",
          ),
        );
      }
      const derived = deriveFromExpiration(next.status, next.expirationAt, now, approachingWindowMs);
      if (derived !== next.status) {
        events.push(
          makeEvent(
            "DOMAIN_STATUS_CHANGED",
            isavailObs!.source,
            isavailObs!.sourceVersion,
            now,
            next.status,
            derived,
            evidenceFor(observations),
            null,
          ),
        );
        if (derived === "EXPIRATION_APPROACHING") {
          events.push(
            makeEvent(
              "DOMAIN_APPROACHING_EXPIRATION",
              isavailObs!.source,
              isavailObs!.sourceVersion,
              now,
              next.status,
              derived,
              evidenceFor(observations),
              "MEDIUM",
            ),
          );
        } else if (derived === "POST_EXPIRATION_MONITORING") {
          events.push(
            makeEvent(
              "DOMAIN_POST_EXPIRATION",
              isavailObs!.source,
              isavailObs!.sourceVersion,
              now,
              next.status,
              derived,
              evidenceFor(observations),
              "HIGH",
            ),
          );
        }
      }
      next.status = derived;
      next.availableSince = null;
      if (derived !== "RELEASE_PENDING" && derived !== "RELEASE_PROCESS" && derived !== "COMPETITIVE_RELEASE") {
        next.releaseStartAt = null;
        next.releaseEndAt = null;
      }
    }
  } else {
    // ---- Availability inconclusive (no ISAVAIL or technical reply). ----
    // Preserve the last confirmed state. We only derive monitoring states from
    // the cadastral expiry date when the current status was not itself a
    // confirmed verdict (UNKNOWN/CHECK_FAILED), so a failed availability check
    // never disturbs a confirmed state (RNF-001). A renewal detected this pass
    // keeps the transient RENEWED status until a later pass resolves it.
    if (renewalThisPass) {
      // RENEWED set above; a non-renewal pass derives it back to monitoring.
    } else if (EXPIRATION_DERIVABLE.has(next.status)) {
      const derived = deriveFromExpiration(next.status, next.expirationAt, now, approachingWindowMs);
      if (derived !== next.status) {
        events.push(
          makeEvent(
            "DOMAIN_STATUS_CHANGED",
            cadastral?.source ?? "system",
            cadastral?.sourceVersion ?? DOMAIN_STATE_MACHINE_VERSION,
            now,
            next.status,
            derived,
            evidenceFor(observations),
            null,
          ),
        );
        if (derived === "EXPIRATION_APPROACHING") {
          events.push(
            makeEvent(
              "DOMAIN_APPROACHING_EXPIRATION",
              cadastral?.source ?? "system",
              cadastral?.sourceVersion ?? DOMAIN_STATE_MACHINE_VERSION,
              now,
              next.status,
              derived,
              evidenceFor(observations),
              "MEDIUM",
            ),
          );
        } else if (derived === "POST_EXPIRATION_MONITORING") {
          events.push(
            makeEvent(
              "DOMAIN_POST_EXPIRATION",
              cadastral?.source ?? "system",
              cadastral?.sourceVersion ?? DOMAIN_STATE_MACHINE_VERSION,
              now,
              next.status,
              derived,
              evidenceFor(observations),
              "HIGH",
            ),
          );
        }
      }
      next.status = derived;
    }
  }

  const stateChanged = next.status !== current.status;

  return { next, events, stateChanged };
}

/** Map a state to its notification priority (product brief §18). */
export function priorityForState(status: DomainWatchStatus): WatchPriority {
  switch (status) {
    case "AVAILABLE":
      return "CRITICAL";
    case "RELEASE_PENDING":
    case "RELEASE_PROCESS":
    case "COMPETITIVE_RELEASE":
    case "POST_EXPIRATION_MONITORING":
    case "RENEWED":
      return "HIGH";
    case "EXPIRATION_APPROACHING":
      return "MEDIUM";
    default:
      return "LOW";
  }
}

export { ISAVAIL_MAPPING_VERSION };
