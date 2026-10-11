import { parserError, rateLimit } from "./errors.ts";
import { WHOIS_CLIENT_VERSION } from "./version.ts";
import type { WhoisRecord } from "../whois-provider.ts";

/**
 * v1 parser for the Registro.br WHOIS text format
 * (https://whois.registro.br, port 43).
 *
 * The parser is pure and side-effect free so it can be exercised against
 * real captured fixtures (RNF-017, RNF-022) and versioned independently of
 * the transport (RNF-023). Only the query time is injected so normalized
 * records stay reproducible in tests.
 */

export interface ParseWhoisInput {
  domain: string;
  raw: string;
  queriedAt: string;
}

const FIELD_LINE = /^([a-z0-9-]+):\s*(.*)$/;
const DATE_PREFIX = /^(\d{4})(\d{2})(\d{2})/;

/**
 * Normalize a Registro.br `YYYYMMDD` date (optionally followed by a ticket
 * suffix such as `#142485`) to ISO-8601 UTC. Returns null when the value is
 * not a valid registry date.
 */
export function normalizeRegistroDate(value: string): string | null {
  const match = DATE_PREFIX.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month}-${day}T00:00:00.000Z`;
}

export function parseWhoisResponseV1(input: ParseWhoisInput): WhoisRecord {
  const { domain, raw, queriedAt } = input;
  const body = raw.replace(/\r/g, "");

  // Rate limiting must surface as an identifiable technical error, never as
  // a domain verdict (product brief §23, RNF-001).
  if (/rate limit/i.test(body)) {
    throw rateLimit(domain, raw);
  }

  // Registro.br replies `No match for domain "<domain>"` for unregistered
  // names (or queries with no record). Existence is false, nothing else is
  // known about the name.
  if (/no match for/i.test(body)) {
    return {
      source: "whois",
      sourceVersion: WHOIS_CLIENT_VERSION,
      domain,
      exists: false,
      owner: null,
      ownerId: null,
      responsible: null,
      country: null,
      ownerContact: null,
      techContact: null,
      billingContact: null,
      createdAt: null,
      changedAt: null,
      expiresAt: null,
      status: [],
      nameServers: [],
      raw,
      queriedAt,
    };
  }

  const fields = new Map<string, string[]>();
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("%")) continue;
    const match = FIELD_LINE.exec(trimmed);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (key === undefined || value === undefined) continue;
    const list = fields.get(key);
    if (list) {
      list.push(value);
    } else {
      fields.set(key, [value]);
    }
  }

  const first = (key: string): string | null => fields.get(key)?.[0]?.trim() ?? null;
  const all = (key: string): string[] => (fields.get(key) ?? []).map((v) => v.trim());
  const date = (key: string): string | null => {
    const value = first(key);
    return value === null ? null : normalizeRegistroDate(value);
  };

  // A registration record is recognized by the presence of the `domain:`
  // field. Absent that, we cannot tell a "registered" from a "not found"
  // reply, so the response is malformed for this parser (PARSER_ERROR).
  if (first("domain") === null) {
    throw parserError(domain, "missing `domain:` field", raw);
  }

  return {
    source: "whois",
    sourceVersion: WHOIS_CLIENT_VERSION,
    domain,
    exists: true,
    owner: first("owner"),
    ownerId: first("ownerid"),
    responsible: first("responsible"),
    country: first("country"),
    ownerContact: first("owner-c"),
    techContact: first("tech-c"),
    billingContact: first("billing-c"),
    createdAt: date("created"),
    changedAt: date("changed"),
    expiresAt: date("expires"),
    status: all("status"),
    nameServers: all("nserver"),
    raw,
    queriedAt,
  };
}

/**
 * Convenience wrapper used by the transport layer so the parser version is
 * always the one paired with the client version.
 */
export function parseWhoisResponseForVersion(
  input: ParseWhoisInput,
): WhoisRecord {
  return parseWhoisResponseV1(input);
}
