/**
 * Identifiable technical errors for the release process collector
 * (product brief §23).
 *
 * These codes are deliberately distinct from domain states: a failed or
 * malformed release publication must never be interpreted as a release
 * verdict (RNF-001, RNF-020). Callers surface them as technical events /
 * job errors and keep the last confirmed domain state untouched — a source
 * going down or changing format must not break monitoring (LEX-25 AC10).
 */

export type ReleaseErrorCode =
  | "RELEASE_TIMEOUT"
  | "RATE_LIMIT"
  | "PARSER_ERROR"
  | "UNKNOWN_FORMAT"
  | "SOURCE_UNAVAILABLE";

export interface ReleaseErrorOptions {
  /** What was being collected when the error occurred (calendar or list). */
  kind: string;
  raw?: string | null;
  cause?: unknown;
}

export class ReleaseError extends Error {
  readonly code: ReleaseErrorCode;
  readonly kind: string;
  readonly raw: string | null;

  constructor(code: ReleaseErrorCode, message: string, options: ReleaseErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "ReleaseError";
    this.code = code;
    this.kind = options.kind;
    this.raw = options.raw ?? null;
  }

  /** Type guard to distinguish identifiable release errors in catch blocks. */
  static isReleaseError(err: unknown): err is ReleaseError {
    return err instanceof ReleaseError;
  }
}

export function releaseTimeout(kind: string, raw?: string | null): ReleaseError {
  return new ReleaseError("RELEASE_TIMEOUT", `Release ${kind} fetch timed out`, {
    kind,
    raw: raw ?? null,
  });
}

export function rateLimit(kind: string, raw?: string | null): ReleaseError {
  return new ReleaseError(
    "RATE_LIMIT",
    `Release ${kind} fetch rejected by rate limiting`,
    { kind, raw: raw ?? null },
  );
}

export function parserError(kind: string, detail: string, raw?: string | null): ReleaseError {
  return new ReleaseError(
    "PARSER_ERROR",
    `Release ${kind} payload could not be parsed: ${detail}`,
    { kind, raw: raw ?? null },
  );
}

export function unknownFormat(kind: string, detail: string, raw?: string | null): ReleaseError {
  return new ReleaseError(
    "UNKNOWN_FORMAT",
    `Release ${kind} payload is not the expected document: ${detail}`,
    { kind, raw: raw ?? null },
  );
}

export function sourceUnavailable(kind: string, cause: unknown, raw?: string | null): ReleaseError {
  return new ReleaseError("SOURCE_UNAVAILABLE", `Release ${kind} source is unavailable`, {
    kind,
    raw: raw ?? null,
    cause,
  });
}
