/**
 * ISAVAIL source contract (RNF-015, RNF-022).
 *
 * The ISAVAIL service of the Registro.br registry is the only authorized
 * source of domain availability for this product (product brief §7.3,
 * RNF-020): a domain may reach the internal `AVAILABLE` state only through a
 * valid ISAVAIL response. This contract is the single typed interface every
 * ISAVAIL implementation must satisfy; concrete, versioned clients
 * (RNF-016, RNF-023) implement `IsavailProvider` and return a normalized
 * `IsavailRecord` while preserving the raw response for audit (RNF-007).
 */

/** Official ISAVAIL status codes (Protocolo-ISAVAILv2, statuses 0-9). */
export type IsavailStatusCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Human-readable name of each official ISAVAIL status code. */
export const ISAVAIL_STATUS_NAMES: Record<IsavailStatusCode, string> = {
  0: "AVAILABLE",
  1: "AVAILABLE_WITH_TICKET",
  2: "REGISTERED",
  3: "UNAVAILABLE",
  4: "INVALID_QUERY",
  5: "RELEASE_PROCESS_WAITING",
  6: "AVAILABLE_RELEASE_IN_PROGRESS",
  7: "AVAILABLE_RELEASE_IN_PROGRESS_WITH_TICKETS",
  8: "ERROR",
  9: "COMPETITIVE_RELEASE",
};

export interface IsavailRecord {
  /** Fixed source identifier, usable as `domain_events.source`. */
  source: "isavail";
  /**
   * Identifiable client/parser version used to produce this record
   * (RNF-016), e.g. `isavail-client@v1`.
   */
  sourceVersion: string;
  /** Normalized query domain, e.g. `example.com.br`. */
  domain: string;
  /** Raw status code as returned by the service (official codes 0-9). */
  statusCode: number;
  /** Canonical name of the raw status code (see `ISAVAIL_STATUS_NAMES`). */
  status: string;
  /**
   * True only when the service authoritatively confirmed the name is
   * available for registration (status 0/1). Errors, timeouts, and
   * rate-limited replies are never reported as available (RNF-020).
   */
  available: boolean;
  /** FQDN returned by the service (may carry the ACE/punycode form). */
  fqdn: string | null;
  /** ACE (punycode) form of the FQDN when the reply had two names. */
  fqdnAce: string | null;
  /** Expiration date (status 2), ISO-8601 UTC when parseable. */
  expirationDate: string | null;
  /** Publication status (status 2), e.g. `published`. */
  publicationStatus: string | null;
  /** Name servers (status 2), as returned. */
  nameServers: string[];
  /** Active tickets (statuses 1, 7, 9), as returned. */
  tickets: string[];
  /** Release/auction process begin date (statuses 6, 7, 9). */
  releaseBeginAt: string | null;
  /** Release/auction process end date (statuses 6, 7, 9). */
  releaseEndAt: string | null;
  /** New-ticket acceptance deadline (status 9), ISO-8601 UTC. */
  acceptingNewTicketsUntil: string | null;
  /** Reason/message line (statuses 3, 4, 8). */
  message: string | null;
  /** Raw ISAVAIL response, preserved as audit evidence (RNF-007). */
  raw: string;
  /** Query timestamp, ISO-8601 UTC (RNF-018). */
  checkedAt: string;
}

export interface IsavailProvider {
  check(domain: string): Promise<IsavailRecord>;
}
