/**
 * Adaptive monitoring frequency policy (technical plan §7, AC03, RNF-006,
 * RNF-021).
 *
 * Pure, configuration-driven: each phase A–E maps to a default check
 * frequency. `next_check_at` is recomputed after every check from the
 * current phase. Frequencies are overridable per-call (RNF-021) without
 * changing code; LEX-24 builds the full phase-transition logic on top of
 * this base policy.
 */
import type { DomainWatchStatus, MonitoringPhase } from "../entities/domain-watch.ts";

/** A phase's monitoring cadence. */
export interface PhaseFrequency {
  /** Human-readable cadence label (audit/display, RNF-021). */
  label: string;
  /** Interval between checks, milliseconds. */
  intervalMs: number;
}

/**
 * Default frequencies (technical plan §7):
 * - A — long term (expiry > 45 days): 1x/day
 * - B — pre-expiration (within 45 days): 4x/day
 * - C — post-expiration: 8x/day
 * - D — release process: 1x/hour
 * - E — available: hold (no hot re-check; LEX-24 stops scheduling entirely)
 */
export const DEFAULT_PHASE_FREQUENCIES: Record<MonitoringPhase, PhaseFrequency> = {
  A: { label: "1x/day", intervalMs: 24 * 60 * 60 * 1000 },
  B: { label: "4x/day", intervalMs: 6 * 60 * 60 * 1000 },
  C: { label: "8x/day", intervalMs: 3 * 60 * 60 * 1000 },
  D: { label: "1x/hour", intervalMs: 60 * 60 * 1000 },
  E: { label: "available (hold)", intervalMs: 24 * 60 * 60 * 1000 },
};

/**
 * Derive the adaptive phase from the confirmed domain state. The initial
 * check starts the watch in phase A; confirmed states refine the cadence.
 */
export function derivePhase(status: DomainWatchStatus): MonitoringPhase {
  switch (status) {
    case "AVAILABLE":
      return "E";
    case "RELEASE_PENDING":
    case "RELEASE_PROCESS":
    case "COMPETITIVE_RELEASE":
      return "D";
    case "POST_EXPIRATION_MONITORING":
      return "C";
    case "EXPIRATION_APPROACHING":
      return "B";
    default:
      return "A";
  }
}

/**
 * Compute the next check timestamp for a phase from `now` (ISO-8601 UTC).
 * Frequencies can be overridden per call (RNF-021). Always returns an
 * ISO-8601 string so the `next_check_at NOT NULL` schema constraint holds.
 */
export function computeNextCheckAt(
  phase: MonitoringPhase,
  now: string,
  frequencies: Partial<Record<MonitoringPhase, PhaseFrequency>> = {},
): string {
  const merged: Record<MonitoringPhase, PhaseFrequency> = {
    ...DEFAULT_PHASE_FREQUENCIES,
    ...frequencies,
  };
  const frequency = merged[phase] ?? DEFAULT_PHASE_FREQUENCIES[phase];
  return new Date(Date.parse(now) + frequency.intervalMs).toISOString();
}
