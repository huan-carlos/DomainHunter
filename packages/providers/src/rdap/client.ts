import type { RdapProvider, RdapResult } from "../rdap-provider.ts";
import { parseRdapResponseV1 } from "./parser.ts";
import { queryRdapRaw } from "./transport.ts";
import { RDAP_CLIENT_VERSION } from "./version.ts";

/**
 * Versioned Registro.br RDAP client — `rdap-client@v1` (RNF-016).
 *
 * Combines the HTTP transport with the v1 parser and returns a normalized,
 * typed `RdapResult` while preserving the raw response for audit (RNF-007).
 * Technical failures surface as identifiable `RdapError` codes
 * (`RDAP_TIMEOUT`, `RATE_LIMIT`, `PARSER_ERROR`, `SOURCE_UNAVAILABLE`) and
 * never mutate any domain state (product brief §23). A 404 (or RDAP error
 * body with `errorCode` 404) becomes a non-existent record, matching the
 * WHOIS "no match" semantics.
 */

export interface RdapClientV1Options {
  /** Base URL of the RDAP service (defaults to https://rdap.registro.br). */
  baseUrl?: string;
  /** Query timeout in milliseconds (defaults to 10s). */
  timeoutMs?: number;
  /** Injectable fetch implementation (tests). */
  fetch?: typeof fetch;
  /** Clock for the `queriedAt` timestamp (defaults to now, UTC ISO-8601). */
  clock?: () => string;
}

export function createRdapClientV1(options: RdapClientV1Options = {}): RdapProvider {
  const clock = options.clock ?? (() => new Date().toISOString());

  return {
    async query(domain: string): Promise<RdapResult> {
      const queriedAt = clock();
      const { status, body } = await queryRdapRaw(domain, options);
      return parseRdapResponseV1({ domain, raw: body, status, queriedAt });
    },
  };
}

export { RDAP_CLIENT_VERSION };
