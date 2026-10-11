/**
 * Pure ISAVAIL → internal state mapping (technical plan §308-328).
 *
 * The availability machine stores the raw ISAVAIL status in
 * `raw_last_status` and keeps the normalized evidence in the event. This
 * function is the only place that maps an authoritative ISAVAIL reply into
 * the internal `DomainWatchStatus`; it is versioned (RNF-016) and frozen by
 * contract tests against the official Protocolo-ISAVAILv2 status codes.
 *
 * Critical rules (RNF-001, RNF-020, AC05, AC06):
 * - `AVAILABLE` is produced only from a valid ISAVAIL reply that
 *   authoritatively confirms the name can be registered (status 0/1).
 * - Technical failures (timeout, rate limit, parsing, socket) never reach
 *   this function — they surface as `IsavailError` and the caller keeps the
 *   last confirmed domain state untouched.
 * - Unknown/unrecognized statuses map to `UNKNOWN`, never `AVAILABLE`.
 */
import type { DomainWatchStatus } from "../entities/domain-watch.ts";

/** Mapping version recorded alongside the domain state (RNF-016). */
export const ISAVAIL_MAPPING_VERSION = "isavail-map@v1";

/**
 * Map an official ISAVAIL status code to the internal watch state.
 *
 * @param statusCode Official Protocolo-ISAVAILv2 status code (0-9).
 * @returns The internal state; `AVAILABLE` only for statuses 0/1.
 */
export function mapIsavailStatusToDomainState(statusCode: number): DomainWatchStatus {
  switch (statusCode) {
    case 0: // AVAILABLE
    case 1: // AVAILABLE_WITH_TICKET
      return "AVAILABLE";
    case 2: // REGISTERED
      return "REGISTERED";
    case 3: // UNAVAILABLE (reserved names land here, e.g. "reserved CG")
      return "REGISTERED";
    case 5: // RELEASE_PROCESS_WAITING
      return "RELEASE_PENDING";
    case 6: // AVAILABLE_RELEASE_IN_PROGRESS
    case 7: // AVAILABLE_RELEASE_IN_PROGRESS_WITH_TICKETS
      return "RELEASE_PROCESS";
    case 9: // COMPETITIVE_RELEASE
      return "COMPETITIVE_RELEASE";
    case 4: // INVALID_QUERY (technical: our query was malformed)
    case 8: // ERROR (technical: service error)
      return "CHECK_FAILED";
    default:
      return "UNKNOWN";
  }
}
