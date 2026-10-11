/**
 * Versioned Registro.br ISAVAIL client — `isavail-client@v1` (RNF-016).
 *
 * Implements the ISAVAIL availability protocol (UDP/43) with the cookie
 * handshake required by the service: the first query is sent with a
 * placeholder cookie and, when the server replies `CK <cookie> <qid>`, the
 * client stores the cookie and re-sends the query once. The client returns
 * a normalized, typed `IsavailRecord` while preserving the raw response for
 * audit (RNF-007). Technical failures surface as identifiable
 * `IsavailError` codes (`ISAVAIL_TIMEOUT`, `RATE_LIMIT`, `PARSER_ERROR`,
 * `SOURCE_UNAVAILABLE`) and never imply availability (product brief §23,
 * RNF-001, RNF-020).
 */
import type { IsavailProvider, IsavailRecord } from "../isavail-provider.ts";
import { isavailParserError, isavailRateLimit } from "./errors.ts";
import {
  DEFAULT_COOKIE,
  formatIsavailQuery,
  parseIsavailReply,
  type IsavailQuery,
} from "./protocol.ts";
import { queryIsavailRaw } from "./transport.ts";
import { ISAVAIL_CLIENT_VERSION } from "./version.ts";

export interface IsavailClientV1Options {
  /** ISAVAIL server host (defaults to avail.registro.br). */
  host?: string;
  /** ISAVAIL server port (defaults to 43). */
  port?: number;
  /** Query timeout in milliseconds (defaults to 5s). */
  timeoutMs?: number;
  /** Max query attempts including the first send (defaults to 3). */
  maxAttempts?: number;
  /** Protocol version sent on the wire (spec: 0/1; official client sends 2). */
  version?: number;
  /** Requested language in the reply (0 = EN, 1 = PT). Defaults to EN. */
  lang?: 0 | 1;
  /** Ask for TLD suggestions in the reply (version > 0). Defaults to off. */
  suggest?: 0 | 1;
  /** Injectable transport (tests). */
  transport?: (domain: string, query: string) => Promise<string>;
  /** Clock for the `checkedAt` timestamp (defaults to now, UTC ISO-8601). */
  clock?: () => string;
  /** Random query-id generator (tests); returns a 1-10 byte numeric string. */
  nextQid?: () => string;
}

/**
 * Create a versioned ISAVAIL client.
 *
 * A single client instance keeps the service cookie across `check` calls;
 * create one instance per automation worker / domain monitor process.
 */
export function createIsavailClientV1(options: IsavailClientV1Options = {}): IsavailProvider {
  const clock = options.clock ?? (() => new Date().toISOString());
  const transport = options.transport ?? defaultTransport(options);
  const version = options.version ?? 2;
  const lang = options.lang ?? 0;
  const suggest = options.suggest ?? 0;
  const nextQid = options.nextQid ?? defaultNextQid;

  let cookie: string = DEFAULT_COOKIE;
  /** Monotonic cookie handshake attempts so a server loop cannot spin forever. */
  let cookieAttempts = 0;

  async function check(domain: string): Promise<IsavailRecord> {
    const checkedAt = clock();
    const qid = nextQid();
    const query: IsavailQuery = {
      version,
      cookie,
      lang,
      qid,
      fqdn: domain,
      suggest,
    };

    const raw = await transport(domain, formatIsavailQuery(query));
    const parsed = parseIsavailReply(domain, raw);

    if (parsed.kind === "cookie") {
      if (cookieAttempts >= 2) {
        throw isavailParserError(domain, "cookie handshake did not converge", raw);
      }
      cookieAttempts += 1;
      cookie = parsed.cookie || DEFAULT_COOKIE;
      const retryQuery: IsavailQuery = { ...query, cookie, qid: nextQid() };
      const retryRaw = await transport(domain, formatIsavailQuery(retryQuery));
      const retried = parseIsavailReply(domain, retryRaw);
      if (retried.kind === "cookie") {
        throw isavailParserError(domain, "cookie handshake did not converge", retryRaw);
      }
      return buildRecord(domain, checkedAt, retryRaw, retried);
    }

    return buildRecord(domain, checkedAt, raw, parsed);
  }

  function buildRecord(
    domain: string,
    checkedAt: string,
    raw: string,
    parsed: Extract<ReturnType<typeof parseIsavailReply>, { kind: "status" }>,
  ): IsavailRecord {
    // Rate limiting must surface as an identifiable technical error, never
    // as a domain verdict (product brief §23, RNF-001).
    if (parsed.statusCode === 8 && /rate limit/i.test(parsed.message ?? "")) {
      throw isavailRateLimit(domain, raw);
    }

    return {
      source: "isavail",
      sourceVersion: ISAVAIL_CLIENT_VERSION,
      domain,
      statusCode: parsed.statusCode,
      status: parsed.status,
      available: parsed.statusCode === 0 || parsed.statusCode === 1,
      fqdn: parsed.fqdn,
      fqdnAce: parsed.fqdnAce,
      expirationDate: parsed.expirationDate,
      publicationStatus: parsed.publicationStatus,
      nameServers: parsed.nameServers,
      tickets: parsed.tickets,
      releaseBeginAt: parsed.releaseBeginAt,
      releaseEndAt: parsed.releaseEndAt,
      acceptingNewTicketsUntil: parsed.acceptingNewTicketsUntil,
      message: parsed.message,
      raw,
      checkedAt,
    };
  }

  return { check };
}

function defaultTransport(options: IsavailClientV1Options) {
  return (domain: string, query: string): Promise<string> =>
    queryIsavailRaw(domain, query, {
      host: options.host ?? "avail.registro.br",
      port: options.port ?? 43,
      timeoutMs: options.timeoutMs ?? 5_000,
      maxAttempts: options.maxAttempts ?? 3,
    });
}

function defaultNextQid(): string {
  return String(Math.floor(Math.random() * 4_294_967_296));
}

export { ISAVAIL_CLIENT_VERSION };
