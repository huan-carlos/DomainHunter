/**
 * Identifiable technical errors for the ISAVAIL client (product brief §23).
 *
 * These codes are deliberately distinct from domain states: a failed,
 * timed-out, or rate-limited query must never be interpreted as a domain
 * verdict (RNF-001, RNF-020). Callers surface them as technical events and
 * keep the last confirmed domain state untouched.
 */

export type IsavailErrorCode =
  | "ISAVAIL_TIMEOUT"
  | "RATE_LIMIT"
  | "PARSER_ERROR"
  | "SOURCE_UNAVAILABLE";

export interface IsavailErrorOptions {
  /** Domain being queried when the error occurred. */
  domain: string;
  /** Raw response (when available) preserved as audit evidence. */
  raw?: string | null;
  cause?: unknown;
}

export class IsavailError extends Error {
  readonly code: IsavailErrorCode;
  readonly domain: string;
  readonly raw: string | null;

  constructor(code: IsavailErrorCode, message: string, options: IsavailErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "IsavailError";
    this.code = code;
    this.domain = options.domain;
    this.raw = options.raw ?? null;
  }

  /** Type guard to distinguish identifiable ISAVAIL errors in catch blocks. */
  static isIsavailError(err: unknown): err is IsavailError {
    return err instanceof IsavailError;
  }
}

export function isavailTimeout(domain: string, raw?: string | null): IsavailError {
  return new IsavailError("ISAVAIL_TIMEOUT", `ISAVAIL query for "${domain}" timed out`, {
    domain,
    raw: raw ?? null,
  });
}

export function isavailRateLimit(domain: string, raw?: string | null): IsavailError {
  return new IsavailError(
    "RATE_LIMIT",
    `ISAVAIL query for "${domain}" rejected by rate limiting`,
    { domain, raw: raw ?? null },
  );
}

export function isavailParserError(
  domain: string,
  detail: string,
  raw?: string | null,
): IsavailError {
  return new IsavailError(
    "PARSER_ERROR",
    `ISAVAIL response for "${domain}" could not be parsed: ${detail}`,
    { domain, raw: raw ?? null },
  );
}

export function isavailSourceUnavailable(
  domain: string,
  cause: unknown,
  raw?: string | null,
): IsavailError {
  return new IsavailError(
    "SOURCE_UNAVAILABLE",
    `ISAVAIL source is unavailable for "${domain}"`,
    { domain, raw: raw ?? null, cause },
  );
}
