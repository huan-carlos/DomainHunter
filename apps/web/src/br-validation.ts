/**
 * Client-side `.br` domain validation (LEX-23, technical plan §11, product
 * brief §12).
 *
 * Mirrors the server-side rules in `apps/server/src/domain/br-domain.ts` so
 * the registration form gives immediate feedback before the `POST /domains`
 * round trip: empty input, label syntax, `.br` TLD and supported Registro.br
 * second-level domains. The server remains authoritative; this module is a
 * pure, testable UX helper.
 */

/** Validation failure code, aligned with `BrDomainErrorCode` on the server. */
export type BrValidationCode = "EMPTY_DOMAIN" | "INVALID_SYNTAX" | "UNSUPPORTED_TLD";

export type BrValidationResult =
  | { valid: true; normalized: string }
  | { valid: false; code: BrValidationCode; message: string };

/**
 * Registro.br generic/category second-level domains (official list, plan §10).
 * Kept in sync with `apps/server/src/domain/br-domain.ts`.
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
  const schemeMatch = host.match(/^[a-z][a-z0-9+.-]*:\/\//);
  if (schemeMatch) host = host.slice(schemeMatch[0].length);
  const end = host.search(/[/?#]/);
  if (end !== -1) host = host.slice(0, end);
  const atIndex = host.lastIndexOf("@");
  if (atIndex !== -1) host = host.slice(atIndex + 1);
  const portIndex = host.lastIndexOf(":");
  if (portIndex !== -1) host = host.slice(0, portIndex);
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host.trim();
}

/** True when the input is a valid, supported `.br` domain. */
export function isValidBrDomain(input: string): boolean {
  return validateBrDomain(input).valid;
}

/**
 * Validate a `.br` domain for the registration form. Returns the canonical
 * registrable domain (`exemplo.com.br`) on success.
 */
export function validateBrDomain(input: string): BrValidationResult {
  const host = extractHost(input);
  if (host.length === 0) {
    return { valid: false, code: "EMPTY_DOMAIN", message: "Informe um domínio." };
  }

  const withoutWww = host.startsWith("www.") ? host.slice(4) : host;
  const labels = withoutWww.split(".");

  for (const label of labels) {
    if (!LABEL_PATTERN.test(label)) {
      return {
        valid: false,
        code: "INVALID_SYNTAX",
        message: `"${label}" não é um rótulo válido — use letras, dígitos e hífens.`,
      };
    }
  }

  const last = labels[labels.length - 1];
  if (last !== "br") {
    return {
      valid: false,
      code: "UNSUPPORTED_TLD",
      message: `Apenas domínios .br são suportados (recebido ".${last ?? ""}").`,
    };
  }

  if (labels.length >= 3) {
    const secondLevel = labels[labels.length - 2];
    if (secondLevel !== undefined && !BR_SECOND_LEVEL.has(secondLevel)) {
      return {
        valid: false,
        code: "UNSUPPORTED_TLD",
        message: `Subdomínio ".${secondLevel}.br" não suportado.`,
      };
    }
  }

  return { valid: true, normalized: withoutWww };
}
