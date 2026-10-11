/**
 * ISAVAIL protocol — pure query building and response parsing
 * (Protocolo-ISAVAILv2, Registro.br, https://registro.br/tecnologia/Protocolo-ISAVAILv2.txt).
 *
 * Kept free of I/O so the parser can be exercised against real captured
 * fixtures (RNF-017, RNF-022) and versioned independently of the transport
 * (RNF-023). Encoding is ISO-8859-1; responses are decoded as Latin-1.
 */
import { isavailParserError } from "./errors.ts";
import { ISAVAIL_STATUS_NAMES } from "../isavail-provider.ts";

/** Official ISAVAIL server and port (UDP). */
export const ISAVAIL_SERVER_HOST = "avail.registro.br";
export const ISAVAIL_SERVER_PORT = 43;

/** Cookie placeholder sent when the client has not yet received a cookie. */
export const DEFAULT_COOKIE = "00000000000000000000";

export interface IsavailQuery {
  /** Protocol version (spec: 0 or 1; the current official client sends 2). */
  version: number;
  /** 20 hex chars; use `DEFAULT_COOKIE` before the first handshake. */
  cookie: string;
  /** Requested language: 0 = EN, 1 = PT. */
  lang: 0 | 1;
  /** Query id — 1 to 10 byte numeric string chosen by the client. */
  qid: string;
  /** Fully qualified domain name being queried. */
  fqdn: string;
  /** Ask for TLD suggestions in the reply (version > 0). */
  suggest?: 0 | 1;
}

/** Build the wire query string from the structured query. */
export function formatIsavailQuery(query: IsavailQuery): string {
  const parts = [
    String(query.version),
    query.cookie,
    String(query.lang),
    query.qid,
    query.fqdn,
  ];
  if (query.version > 0 && query.suggest !== undefined) {
    parts.push(String(query.suggest));
  }
  return parts.join(" ");
}

export interface IsavailCookieReply {
  kind: "cookie";
  /** New cookie to use for subsequent queries (up to 20 hex chars). */
  cookie: string;
  qid: string | null;
}

export interface IsavailStatusReply {
  kind: "status";
  statusCode: number;
  status: string;
  qid: string | null;
  fqdn: string | null;
  fqdnAce: string | null;
  expirationDate: string | null;
  publicationStatus: string | null;
  nameServers: string[];
  tickets: string[];
  releaseBeginAt: string | null;
  releaseEndAt: string | null;
  acceptingNewTicketsUntil: string | null;
  message: string | null;
}

export type IsavailParsedReply = IsavailCookieReply | IsavailStatusReply;

const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})$/;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/;

/** Normalize registry dates (`YYYY-MM-DD` or `YYYY-MM-DD HH:MM:SS`) to ISO-8601 UTC. */
export function normalizeIsavailDate(value: string | undefined | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  const time = DATE_TIME.exec(trimmed);
  if (time) {
    const [, date, hms] = time;
    return `${date}T${hms}.000Z`;
  }
  const dateOnly = DATE_ONLY.exec(trimmed);
  if (dateOnly) {
    return `${dateOnly[1]}T00:00:00.000Z`;
  }
  return null;
}

/**
 * Parse an ISAVAIL wire reply into a typed structure.
 *
 * The parser is tolerant to missing trailing lines (uses null/empty) but
 * throws `PARSER_ERROR` when the reply has no recognizable `ST`/`CK` line
 * or an unparseable status code. A wrong-cookie reply (`CK <cookie> <qid>`)
 * is surfaced separately so the client can re-run the handshake.
 */
export function parseIsavailReply(domain: string, raw: string): IsavailParsedReply {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("%"));

  if (lines.length === 0) {
    throw isavailParserError(domain, "empty response", raw);
  }

  const first = lines[0];
  if (!first) {
    throw isavailParserError(domain, "empty response", raw);
  }

  const ckMatch = /^CK\s+([0-9a-f]+)\s*(\S*)/i.exec(first);
  if (ckMatch) {
    return {
      kind: "cookie",
      cookie: (ckMatch[1] ?? "").slice(0, 20),
      qid: ckMatch[2] ? (ckMatch[2] ?? null) : null,
    };
  }

  const stMatch = /^ST\s+(\d+)\s*(\S*)/.exec(first);
  if (!stMatch) {
    throw isavailParserError(domain, "no ST/CK line in response", raw);
  }

  const statusCode = Number(stMatch[1]);
  if (!Number.isInteger(statusCode) || statusCode < 0 || statusCode > 9) {
    throw isavailParserError(domain, `unrecognized status code "${stMatch[1]}"`, raw);
  }

  const qid = stMatch[2] ? (stMatch[2] ?? null) : null;
  const rest = lines.slice(1);

  // Status 8 (error): the extra info is a single message line, no fqdn.
  if (statusCode === 8) {
    return {
      kind: "status",
      statusCode,
      status: ISAVAIL_STATUS_NAMES[statusCode as keyof typeof ISAVAIL_STATUS_NAMES],
      qid: null,
      fqdn: null,
      fqdnAce: null,
      expirationDate: null,
      publicationStatus: null,
      nameServers: [],
      tickets: [],
      releaseBeginAt: null,
      releaseEndAt: null,
      acceptingNewTicketsUntil: null,
      message: rest.join(" ") || null,
    };
  }

  // First data line: the fqdn, possibly `fqdn|fqdn-ace`.
  const fqdnLine = rest.shift() ?? "";
  const fqdnParts = fqdnLine.split("|");
  const fqdn = fqdnParts[0]?.trim() ?? null;
  const fqdnAce = fqdnParts[1]?.trim() ?? null;

  let expirationDate: string | null = null;
  let publicationStatus: string | null = null;
  let nameServers: string[] = [];
  let tickets: string[] = [];
  let releaseBeginAt: string | null = null;
  let releaseEndAt: string | null = null;
  let acceptingNewTicketsUntil: string | null = null;
  let message: string | null = null;

  if (statusCode === 1) {
    // Available with ticket: `ticket1|ticket2|...`
    const ticketLine = rest.shift() ?? "";
    tickets = ticketLine.split("|").map((t) => t.trim()).filter((t) => t !== "");
  } else if (statusCode === 2) {
    // Registered: `expiration-date|status|ns1|...|ns5` then optional suggestions.
    const info = rest.shift() ?? "";
    const infoParts = info.split("|");
    expirationDate = normalizeIsavailDate(infoParts[0]);
    publicationStatus = infoParts[1]?.trim() ?? null;
    nameServers = infoParts.slice(2).map((ns) => ns.trim()).filter((ns) => ns !== "");
  } else if (statusCode === 3 || statusCode === 4) {
    // Unavailable / invalid query: `<string-reason>`.
    message = rest.shift()?.trim() ?? null;
  } else if (statusCode === 6 || statusCode === 7) {
    // Release in progress: `begin-date|end-date`, then tickets for status 7.
    const info = rest.shift() ?? "";
    const infoParts = info.split("|");
    releaseBeginAt = normalizeIsavailDate(infoParts[0]);
    releaseEndAt = normalizeIsavailDate(infoParts[1]);
    if (statusCode === 7) {
      const ticketLine = rest.shift() ?? "";
      tickets = ticketLine.split("|").map((t) => t.trim()).filter((t) => t !== "");
    }
  } else if (statusCode === 9) {
    // Competitive release: `begin|end|accepting-until`, then tickets.
    const info = rest.shift() ?? "";
    const infoParts = info.split("|");
    releaseBeginAt = normalizeIsavailDate(infoParts[0]);
    releaseEndAt = normalizeIsavailDate(infoParts[1]);
    acceptingNewTicketsUntil = normalizeIsavailDate(infoParts[2]);
    const ticketLine = rest.shift() ?? "";
    tickets = ticketLine.split("|").map((t) => t.trim()).filter((t) => t !== "");
  }
  // Status 0 (available) and 5 (release waiting) carry only the fqdn.

  return {
    kind: "status",
    statusCode,
    status: ISAVAIL_STATUS_NAMES[statusCode as keyof typeof ISAVAIL_STATUS_NAMES],
    qid,
    fqdn,
    fqdnAce,
    expirationDate,
    publicationStatus,
    nameServers,
    tickets,
    releaseBeginAt,
    releaseEndAt,
    acceptingNewTicketsUntil,
    message,
  };
}
