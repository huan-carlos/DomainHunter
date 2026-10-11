import { rdapParserError } from "./errors.ts";
import { RDAP_CLIENT_VERSION } from "./version.ts";
import type { RdapEntity, RdapResult } from "../rdap-provider.ts";

/**
 * v1 parser for the Registro.br RDAP JSON response
 * (https://rdap.registro.br/domain/{domain}).
 *
 * The parser is pure and side-effect free so it can be exercised against
 * real captured fixtures (RNF-017, RNF-022) and versioned independently of
 * the transport (RNF-023). Only the query time is injected so normalized
 * results stay reproducible in tests.
 *
 * RDAP is a structured complement to WHOIS: this parser extracts the fields
 * the .br RDAP service actually publishes (dates, status, entities, name
 * servers) and never assumes that fields present in WHOIS also exist here
 * (product brief §7.2). Missing fields become null/[].
 */

export interface ParseRdapInput {
  domain: string;
  /** Raw response body as received over HTTP. */
  raw: string;
  /** HTTP status code (defaults to 200). */
  status?: number;
  queriedAt: string;
}

interface RdapDomainObject {
  objectClassName?: unknown;
  handle?: unknown;
  ldhName?: unknown;
  status?: unknown;
  nameservers?: unknown;
  entities?: unknown;
  events?: unknown;
  errorCode?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function parseEntities(value: unknown): RdapEntity[] {
  if (!Array.isArray(value)) return [];
  const entities: RdapEntity[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    entities.push({
      handle: asString(item.handle),
      roles: asStringArray(item.roles),
      vcardArray: Array.isArray(item.vcardArray) ? item.vcardArray : [],
    });
  }
  return entities;
}

function parseEvents(
  value: unknown,
): { eventAction: string; eventDate: string }[] {
  if (!Array.isArray(value)) return [];
  const events: { eventAction: string; eventDate: string }[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const eventAction = asString(item.eventAction);
    const eventDate = asString(item.eventDate);
    if (eventAction !== null && eventDate !== null) {
      events.push({ eventAction, eventDate });
    }
  }
  return events;
}

/**
 * Find the first published event date for an action (e.g. `registration`,
 * `expiration`, `last changed`). Returns null when absent — the brief
 * (§7.2) forbids assuming every WHOIS date exists in RDAP.
 */
function eventDateFor(events: { eventAction: string; eventDate: string }[], action: string): string | null {
  const event = events.find((e) => e.eventAction === action);
  return event?.eventDate ?? null;
}

function parseNameServers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    if (isRecord(item)) {
      const ldhName = asString(item.ldhName);
      if (ldhName !== null) names.push(ldhName);
    }
  }
  return names;
}

export function parseRdapResponseV1(input: ParseRdapInput): RdapResult {
  const { domain, raw, queriedAt } = input;
  const status = input.status ?? 200;

  // An empty 404 body (or any 404) means the registry has no record for the
  // name — existence is false, nothing else is known about it.
  if (status === 404) {
    return {
      source: "rdap",
      sourceVersion: RDAP_CLIENT_VERSION,
      domain,
      exists: false,
      handle: null,
      ldhName: null,
      status: [],
      nameServers: [],
      entities: [],
      events: [],
      createdAt: null,
      changedAt: null,
      expiresAt: null,
      raw,
      queriedAt,
    };
  }

  let body: unknown;
  try {
    body = raw.length === 0 ? {} : JSON.parse(raw);
  } catch (err) {
    throw rdapParserError(domain, `invalid JSON: ${(err as Error).message}`, raw);
  }

  if (!isRecord(body)) {
    throw rdapParserError(domain, "expected a JSON object", raw);
  }

  const object = body as RdapDomainObject;

  // RDAP error responses carry `errorCode`. A 404 error code with a 200
  // transport status still means "no record"; any other error object is
  // malformed for this parser.
  const errorCode = typeof object.errorCode === "number" ? object.errorCode : null;
  if (errorCode !== null) {
    if (errorCode === 404) {
      return {
        source: "rdap",
        sourceVersion: RDAP_CLIENT_VERSION,
        domain,
        exists: false,
        handle: null,
        ldhName: null,
        status: [],
        nameServers: [],
        entities: [],
        events: [],
        createdAt: null,
        changedAt: null,
        expiresAt: null,
        raw,
        queriedAt,
      };
    }
    throw rdapParserError(domain, `unexpected RDAP error object (errorCode ${errorCode})`, raw);
  }

  // A registration record is recognized by a domain object. Absent that, we
  // cannot tell a "registered" from a "not found" reply, so the response is
  // malformed for this parser (PARSER_ERROR).
  if (object.objectClassName !== "domain") {
    throw rdapParserError(domain, "missing domain object (objectClassName)", raw);
  }

  const events = parseEvents(object.events);

  return {
    source: "rdap",
    sourceVersion: RDAP_CLIENT_VERSION,
    domain,
    exists: true,
    handle: asString(object.handle),
    ldhName: asString(object.ldhName),
    status: asStringArray(object.status),
    nameServers: parseNameServers(object.nameservers),
    entities: parseEntities(object.entities),
    events,
    createdAt: eventDateFor(events, "registration"),
    changedAt: eventDateFor(events, "last changed"),
    expiresAt: eventDateFor(events, "expiration"),
    raw,
    queriedAt,
  };
}

/**
 * Convenience wrapper used by the transport layer so the parser version is
 * always the one paired with the client version.
 */
export function parseRdapResponseForVersion(
  input: ParseRdapInput,
): RdapResult {
  return parseRdapResponseV1(input);
}
