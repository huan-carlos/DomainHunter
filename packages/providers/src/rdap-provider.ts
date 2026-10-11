/**
 * RDAP source contract (RNF-015, RNF-022).
 *
 * RDAP is a structured complement to WHOIS (product brief §7.2): it shares
 * the same source-contract shape (source, sourceVersion, exists, dates,
 * status, name servers, raw, queriedAt) but only publishes fields the .br
 * RDAP service actually returns. Concrete, versioned clients (RNF-016,
 * RNF-023) implement `RdapProvider` and return a normalized `RdapResult`
 * while preserving the raw response for audit (RNF-007).
 */

export interface RdapEntity {
  handle: string | null;
  roles: string[];
  /** vCard array as published by the registry. */
  vcardArray: unknown[];
}

export interface RdapEvent {
  eventAction: string;
  eventDate: string;
}

export interface RdapResult {
  /** Fixed source identifier, usable as `domain_events.source`. */
  source: "rdap";
  /**
   * Identifiable client/parser version used to produce this result
   * (RNF-016), e.g. `rdap-client@v1`.
   */
  sourceVersion: string;
  /** Normalized query domain, e.g. `example.com.br`. */
  domain: string;
  /** Whether the registry returned a record for the domain. */
  exists: boolean;
  /** Registry handle for the domain object, when published. */
  handle: string | null;
  /** LDH name as published by the registry. */
  ldhName: string | null;
  /** Domain status codes as published (status). */
  status: string[];
  /** Name servers as published (nameservers[].ldhName). */
  nameServers: string[];
  /** Contact entities as published (entities). */
  entities: RdapEntity[];
  /** Lifecycle events as published (events). */
  events: RdapEvent[];
  /** Creation date, ISO-8601 UTC (registration event). */
  createdAt: string | null;
  /** Last change date, ISO-8601 UTC (last changed event). */
  changedAt: string | null;
  /** Expiration date, ISO-8601 UTC (expiration event), when published. */
  expiresAt: string | null;
  /** Raw RDAP response, preserved as audit evidence (RNF-007). */
  raw: unknown;
  /** Query timestamp, ISO-8601 UTC (RNF-018). */
  queriedAt: string;
}

export interface RdapProvider {
  query(domain: string): Promise<RdapResult>;
}
