/**
 * Identifiable technical errors for the WHOIS client (product brief §23).
 *
 * These codes are deliberately distinct from domain states: a failed or
 * rate-limited query must never be interpreted as a domain verdict
 * (RNF-001, RNF-020). Callers surface them as technical events and keep
 * the last confirmed domain state untouched.
 */

export type WhoisErrorCode =
  | "WHOIS_TIMEOUT"
  | "RATE_LIMIT"
  | "PARSER_ERROR"
  | "SOURCE_UNAVAILABLE";

export interface WhoisErrorOptions {
  /** Domain being queried when the error occurred. */
  domain: string;
  /** Raw response (when available) preserved as audit evidence. */
  raw?: string | null;
  cause?: unknown;
}

export class WhoisError extends Error {
  readonly code: WhoisErrorCode;
  readonly domain: string;
  readonly raw: string | null;

  constructor(code: WhoisErrorCode, message: string, options: WhoisErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "WhoisError";
    this.code = code;
    this.domain = options.domain;
    this.raw = options.raw ?? null;
  }

  /** Type guard to distinguish identifiable WHOIS errors in catch blocks. */
  static isWhoisError(err: unknown): err is WhoisError {
    return err instanceof WhoisError;
  }
}

export function whoisTimeout(domain: string, raw?: string | null): WhoisError {
  return new WhoisError("WHOIS_TIMEOUT", `WHOIS query for "${domain}" timed out`, {
    domain,
    raw: raw ?? null,
  });
}

export function rateLimit(domain: string, raw?: string | null): WhoisError {
  return new WhoisError(
    "RATE_LIMIT",
    `WHOIS query for "${domain}" rejected by rate limiting`,
    { domain, raw: raw ?? null },
  );
}

export function parserError(domain: string, detail: string, raw?: string | null): WhoisError {
  return new WhoisError("PARSER_ERROR", `WHOIS response for "${domain}" could not be parsed: ${detail}`, {
    domain,
    raw: raw ?? null,
  });
}

export function sourceUnavailable(
  domain: string,
  cause: unknown,
  raw?: string | null,
): WhoisError {
  return new WhoisError(
    "SOURCE_UNAVAILABLE",
    `WHOIS source is unavailable for "${domain}"`,
    { domain, raw: raw ?? null, cause },
  );
}
