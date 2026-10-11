/**
 * `.br` domain normalization and validation (LEX-20, technical plan §10
 * AC01, product brief §12).
 *
 * Pure functions used by `POST /domains` before a `DomainWatch` is created:
 * the user input is normalized to the canonical registrable domain
 * (lowercase, `www.` stripped, no protocol/path/trailing dot) and validated
 * against the supported Registro.br second-level domains.
 */

/** Validation failure code, used to shape the API error response. */
export type BrDomainErrorCode = "EMPTY_DOMAIN" | "INVALID_SYNTAX" | "UNSUPPORTED_TLD";

export class BrDomainError extends Error {
  readonly code: BrDomainErrorCode;
  readonly input: string;

  constructor(code: BrDomainErrorCode, message: string, input: string) {
    super(message);
    this.name = "BrDomainError";
    this.code = code;
    this.input = input;
  }
}

/**
 * Registro.br generic/category second-level domains (official list, plan
 * §10). Extendable; the set is the source of truth for accepted `.br`
 * suffixes.
 */
const BR_CATEGORY_SUFFIXES: ReadonlySet<string> = new Set([
  "adv", "agr", "am", "arq", "art", "at", "b", "bio", "blog", "bmd", "cim",
  "cng", "cnt", "com", "coop", "ecn", "edu", "eng", "esp", "eti", "far",
  "flog", "fm", "fnd", "fot", "fst", "g12", "ggf", "gov", "imb", "ind",
  "inf", "jor", "jus", "leg", "lel", "log", "mat", "med", "mil", "mus",
  "net", "nom", "not", "ntr", "odo", "org", "ppg", "pro", "psi", "rec",
  "slg", "srv", "tec", "tmp", "tur", "tv", "vet", "vlog", "wiki", "zip",
]);

/** Registro.br geographic (state) second-level domains. */
const BR_STATE_SUFFIXES: ReadonlySet<string> = new Set([
  "ac", "al", "ap", "ba", "ce", "df", "es", "go", "ma", "mg", "ms", "mt",
  "pa", "pb", "pe", "pi", "pr", "rj", "rn", "ro", "rr", "rs", "sc", "se",
  "sp", "to",
]);

const BR_SECOND_LEVEL: ReadonlySet<string> = new Set([
  ...BR_CATEGORY_SUFFIXES,
  ...BR_STATE_SUFFIXES,
]);

const LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Strip scheme, path, query, fragment, userinfo and port from user input. */
function extractHost(raw: string): string {
  let host = raw.trim().toLowerCase();
  // Remove the scheme, if any.
  const schemeMatch = host.match(/^[a-z][a-z0-9+.-]*:\/\//);
  if (schemeMatch) host = host.slice(schemeMatch[0].length);
  // Cut at the first path/query/fragment separator.
  const end = host.search(/[/?#]/);
  if (end !== -1) host = host.slice(0, end);
  // Cut userinfo and port.
  const atIndex = host.lastIndexOf("@");
  if (atIndex !== -1) host = host.slice(atIndex + 1);
  const portIndex = host.lastIndexOf(":");
  if (portIndex !== -1) host = host.slice(0, portIndex);
  // Drop a single trailing dot (fully-qualified form).
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host.trim();
}

/**
 * Normalize and validate a `.br` domain.
 *
 * Accepts URLs (`https://www.Exemplo.COM.BR/path`), bare names, and returns
 * the canonical registrable domain (`exemplo.com.br`). A leading `www.` is
 * stripped. Throws `BrDomainError` for empty input, invalid syntax, or an
 * unsupported TLD (only `.br` and its second-level domains are accepted).
 */
export function normalizeBrDomain(input: string): string {
  const host = extractHost(input);
  if (host.length === 0) {
    throw new BrDomainError("EMPTY_DOMAIN", "domain is required", input);
  }

  // Strip a single leading `www.` so we watch the registrable domain.
  const withoutWww = host.startsWith("www.") ? host.slice(4) : host;
  const labels = withoutWww.split(".");

  for (const label of labels) {
    if (!LABEL_PATTERN.test(label)) {
      throw new BrDomainError(
        "INVALID_SYNTAX",
        `invalid label "${label}" — letters, digits and hyphens only`,
        input,
      );
    }
  }

  const last = labels[labels.length - 1];
  if (last !== "br") {
    throw new BrDomainError(
      "UNSUPPORTED_TLD",
      `only .br domains are supported (got ".${last ?? ""}")`,
      input,
    );
  }

  // A bare `x.br` is a valid registrable name; for 3+ labels the
  // second-level must be a supported Registro.br category/state.
  if (labels.length >= 3) {
    const secondLevel = labels[labels.length - 2];
    if (secondLevel !== undefined && !BR_SECOND_LEVEL.has(secondLevel)) {
      throw new BrDomainError(
        "UNSUPPORTED_TLD",
        `unsupported .br second-level ".${secondLevel}.br"`,
        input,
      );
    }
  }

  return withoutWww;
}

/** True when the input is a valid, supported `.br` domain. */
export function isValidBrDomain(input: string): boolean {
  try {
    normalizeBrDomain(input);
    return true;
  } catch {
    return false;
  }
}
