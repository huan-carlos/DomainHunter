import type { Socket } from "node:net";
import type { WhoisProvider, WhoisRecord } from "../whois-provider.ts";
import { parseWhoisResponseV1 } from "./parser.ts";
import { queryWhoisRaw } from "./transport.ts";
import { WHOIS_CLIENT_VERSION } from "./version.ts";

/**
 * Versioned Registro.br WHOIS client — `whois-client@v1` (RNF-016).
 *
 * Combines the TCP transport (port 43) with the v1 parser and returns a
 * normalized, typed `WhoisRecord` while preserving the raw response for
 * audit (RNF-007). Technical failures surface as identifiable `WhoisError`
 * codes (`WHOIS_TIMEOUT`, `RATE_LIMIT`, `PARSER_ERROR`, `SOURCE_UNAVAILABLE`)
 * and never mutate any domain state (product brief §23).
 */

export interface WhoisClientV1Options {
  /** WHOIS server host (defaults to whois.registro.br). */
  host?: string;
  /** WHOIS server port (defaults to 43). */
  port?: number;
  /** Query timeout in milliseconds (defaults to 10s). */
  timeoutMs?: number;
  /** Injectable socket factory (tests). */
  connect?: (host: string, port: number) => Socket;
  /** Clock for the `queriedAt` timestamp (defaults to now, UTC ISO-8601). */
  clock?: () => string;
}

export function createWhoisClientV1(options: WhoisClientV1Options = {}): WhoisProvider {
  const clock = options.clock ?? (() => new Date().toISOString());

  return {
    async query(domain: string): Promise<WhoisRecord> {
      const queriedAt = clock();
      const raw = await queryWhoisRaw(domain, options);
      return parseWhoisResponseV1({ domain, raw, queriedAt });
    },
  };
}

export { WHOIS_CLIENT_VERSION };
