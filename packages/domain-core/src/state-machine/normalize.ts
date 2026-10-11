/**
 * Normalization of WHOIS/RDAP/ISAVAIL responses into a single, source-agnostic
 * domain model (technical plan §293-328).
 *
 * Pure functions: no I/O, no database, no side effects. The input shapes are
 * structural subsets of the provider contracts in `@domainhunter/providers`, so
 * domain-core stays dependency-free while remaining compatible with any
 * implementation of those contracts.
 *
 * Versioning (RNF-016): every normalized record keeps the client/parser
 * version that produced it, so decisions stay reproducible. The availability
 * verdict is authoritative only when it comes from the ISAVAIL mechanism
 * (RNF-020, AC05, AC06) — cadastral sources can never imply availability.
 */

/** Version of the normalization contract itself (RNF-016). */
export const DOMAIN_NORMALIZATION_VERSION = "domain-normalization@v1";

/** Sources whose responses can be normalized. */
export type DomainSource = "whois" | "rdap" | "isavail";

/**
 * Common, source-agnostic domain record produced by the normalization layer.
 *
 * - `expiresAt` is the single expiry date (WHOIS `expires`, RDAP expiration
 *   event, ISAVAIL status-2 date).
 * - `available` is authoritative only when the source is the availability
 *   mechanism (ISAVAIL); it is always `false` for cadastral sources, so
 *   `AVAILABLE` can never be derived from an expiration date alone (AC06).
 * - `rawLastStatus` carries the raw status returned by the source, preserved
 *   in `raw_last_status` for audit (RNF-007).
 */
export interface NormalizedDomainInfo {
  source: DomainSource;
  /** Identifiable client/parser version (RNF-016). */
  sourceVersion: string;
  /** Normalized query domain. */
  domain: string;
  /** Registry returned a record for the name. */
  exists: boolean;
  owner: string | null;
  ownerId: string | null;
  createdAt: string | null;
  changedAt: string | null;
  expiresAt: string | null;
  /** Domain status codes as published by the source. */
  status: string[];
  nameServers: string[];
  /**
   * Authoritative availability verdict. Only ever `true` for a valid ISAVAIL
   * reply (statuses 0/1); always `false` for cadastral sources.
   */
  available: boolean;
  /** Raw status as returned by the source (e.g. `AVAILABLE`, `REGISTERED`). */
  rawLastStatus: string | null;
  /** Raw ISAVAIL protocol code (0-9) when the source is isavail, else null. */
  isavailStatusCode: number | null;
  /** Release/auction process begin date (ISAVAIL statuses 6/7/9). */
  releaseBeginAt: string | null;
  /** Release/auction process end date (ISAVAIL statuses 6/7/9). */
  releaseEndAt: string | null;
  /** Active tickets published by the source (ISAVAIL statuses 1/7/9). */
  tickets: string[];
  /** Query timestamp, ISO-8601 UTC. */
  queriedAt: string;
}

/** Structural subset of `WhoisRecord` from `@domainhunter/providers`. */
export interface WhoisRecordLike {
  sourceVersion: string;
  domain: string;
  exists: boolean;
  owner: string | null;
  ownerId: string | null;
  createdAt: string | null;
  changedAt: string | null;
  expiresAt: string | null;
  status: string[];
  nameServers: string[];
  raw: string;
  queriedAt: string;
}

/** Structural subset of `RdapResult` from `@domainhunter/providers`. */
export interface RdapResultLike {
  sourceVersion: string;
  domain: string;
  exists: boolean;
  createdAt: string | null;
  changedAt: string | null;
  expiresAt: string | null;
  status: string[];
  nameServers: string[];
  raw: unknown;
  queriedAt: string;
}

/** Structural subset of `IsavailRecord` from `@domainhunter/providers`. */
export interface IsavailRecordLike {
  sourceVersion: string;
  domain: string;
  statusCode: number;
  status: string;
  available: boolean;
  expirationDate: string | null;
  nameServers: string[];
  tickets: string[];
  releaseBeginAt: string | null;
  releaseEndAt: string | null;
  acceptingNewTicketsUntil: string | null;
  message: string | null;
  raw: string;
  checkedAt: string;
}

function rawStatusFromCadastral(exists: boolean, status: string[]): string | null {
  if (!exists) return "NOT_FOUND";
  return status.length > 0 ? status.join(",") : "REGISTERED";
}

/** Normalize a WHOIS record into the common domain model. */
export function normalizeWhoisRecord(record: WhoisRecordLike): NormalizedDomainInfo {
  return {
    source: "whois",
    sourceVersion: record.sourceVersion,
    domain: record.domain,
    exists: record.exists,
    owner: record.owner,
    ownerId: record.ownerId,
    createdAt: record.createdAt,
    changedAt: record.changedAt,
    expiresAt: record.expiresAt,
    status: record.status,
    nameServers: record.nameServers,
    available: false,
    rawLastStatus: rawStatusFromCadastral(record.exists, record.status),
    isavailStatusCode: null,
    releaseBeginAt: null,
    releaseEndAt: null,
    tickets: [],
    queriedAt: record.queriedAt,
  };
}

/** Normalize an RDAP result into the common domain model. */
export function normalizeRdapResult(record: RdapResultLike): NormalizedDomainInfo {
  return {
    source: "rdap",
    sourceVersion: record.sourceVersion,
    domain: record.domain,
    exists: record.exists,
    owner: null,
    ownerId: null,
    createdAt: record.createdAt,
    changedAt: record.changedAt,
    expiresAt: record.expiresAt,
    status: record.status,
    nameServers: record.nameServers,
    available: false,
    rawLastStatus: rawStatusFromCadastral(record.exists, record.status),
    isavailStatusCode: null,
    releaseBeginAt: null,
    releaseEndAt: null,
    tickets: [],
    queriedAt: record.queriedAt,
  };
}

/**
 * Normalize an ISAVAIL record into the common domain model.
 *
 * `available` is carried straight from the client, which only sets it for a
 * valid, authoritative availability confirmation (statuses 0/1). Errors,
 * timeouts, and rate-limited replies never imply availability (RNF-020).
 */
export function normalizeIsavailRecord(record: IsavailRecordLike): NormalizedDomainInfo {
  return {
    source: "isavail",
    sourceVersion: record.sourceVersion,
    domain: record.domain,
    exists: record.statusCode === 2,
    owner: null,
    ownerId: null,
    createdAt: null,
    changedAt: null,
    expiresAt: record.expirationDate,
    status: record.status ? [record.status] : [],
    nameServers: record.nameServers,
    available: record.available,
    rawLastStatus: record.status,
    isavailStatusCode: record.statusCode,
    releaseBeginAt: record.releaseBeginAt,
    releaseEndAt: record.releaseEndAt,
    tickets: record.tickets,
    queriedAt: record.checkedAt,
  };
}
