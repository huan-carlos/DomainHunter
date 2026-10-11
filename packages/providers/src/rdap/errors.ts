/**
 * Identifiable technical errors for the RDAP client (product brief §23).
 *
 * These codes are deliberately distinct from domain states: a failed or
 * rate-limited query must never be interpreted as a domain verdict
 * (RNF-001, RNF-020). Callers surface them as technical events and keep
 * the last confirmed domain state untouched.
 */

export type RdapErrorCode =
  | "RDAP_TIMEOUT"
  | "RATE_LIMIT"
  | "PARSER_ERROR"
  | "SOURCE_UNAVAILABLE";

export interface RdapErrorOptions {
  /** Domain being queried when the error occurred. */
  domain: string;
  /** HTTP status returned by the server, when available. */
  status?: number | null;
  /** Raw response (when available) preserved as audit evidence. */
  raw?: unknown;
  cause?: unknown;
}

export class RdapError extends Error {
  readonly code: RdapErrorCode;
  readonly domain: string;
  readonly status: number | null;
  readonly raw: unknown;

  constructor(code: RdapErrorCode, message: string, options: RdapErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "RdapError";
    this.code = code;
    this.domain = options.domain;
    this.status = options.status ?? null;
    this.raw = options.raw ?? null;
  }

  /** Type guard to distinguish identifiable RDAP errors in catch blocks. */
  static isRdapError(err: unknown): err is RdapError {
    return err instanceof RdapError;
  }
}

export function rdapTimeout(domain: string, raw?: unknown): RdapError {
  return new RdapError("RDAP_TIMEOUT", `RDAP query for "${domain}" timed out`, {
    domain,
    raw: raw ?? null,
  });
}

export function rdapRateLimit(domain: string, status: number, raw?: unknown): RdapError {
  return new RdapError(
    "RATE_LIMIT",
    `RDAP query for "${domain}" rejected by rate limiting (HTTP ${status})`,
    { domain, status, raw: raw ?? null },
  );
}

export function rdapParserError(domain: string, detail: string, raw?: unknown): RdapError {
  return new RdapError("PARSER_ERROR", `RDAP response for "${domain}" could not be parsed: ${detail}`, {
    domain,
    raw: raw ?? null,
  });
}

export function rdapSourceUnavailable(
  domain: string,
  cause: unknown,
  raw?: unknown,
  status?: number,
): RdapError {
  return new RdapError(
    "SOURCE_UNAVAILABLE",
    `RDAP source is unavailable for "${domain}"`,
    { domain, status: status ?? null, raw: raw ?? null, cause },
  );
}
