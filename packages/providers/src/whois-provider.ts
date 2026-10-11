/**
 * WHOIS source contract (RNF-015, RNF-022).
 *
 * The contract is the single typed interface every WHOIS source
 * implementation must satisfy. Concrete, versioned clients (RNF-016,
 * RNF-023) implement `WhoisProvider` and return a normalized `WhoisRecord`
 * while preserving the raw response for audit (RNF-007).
 */

export interface WhoisRecord {
  /** Fixed source identifier, usable as `domain_events.source`. */
  source: "whois";
  /**
   * Identifiable client/parser version used to produce this record
   * (RNF-016), e.g. `whois-client@v1`.
   */
  sourceVersion: string;
  /** Normalized query domain, e.g. `example.com.br`. */
  domain: string;
  /** Whether the registry returned a registration record for the domain. */
  exists: boolean;
  /** Registrant / titular (owner). */
  owner: string | null;
  /** Registrant identifier (ownerid), CPF/CNPJ when published. */
  ownerId: string | null;
  /** Responsible party (responsible), when published. */
  responsible: string | null;
  /** Registrant country (country), when published. */
  country: string | null;
  /** Registrant contact handle (owner-c). */
  ownerContact: string | null;
  /** Technical contact handle (tech-c). */
  techContact: string | null;
  /** Billing contact handle (billing-c), when published. */
  billingContact: string | null;
  /** Creation date, ISO-8601 UTC (created). */
  createdAt: string | null;
  /** Last change date, ISO-8601 UTC (changed). */
  changedAt: string | null;
  /** Expiration date, ISO-8601 UTC (expires). */
  expiresAt: string | null;
  /** Domain status codes as published (status). */
  status: string[];
  /** Name servers as published (nserver). */
  nameServers: string[];
  /** Raw WHOIS response, preserved as audit evidence (RNF-007). */
  raw: string;
  /** Query timestamp, ISO-8601 UTC (RNF-018). */
  queriedAt: string;
}

export interface WhoisProvider {
  query(domain: string): Promise<WhoisRecord>;
}
