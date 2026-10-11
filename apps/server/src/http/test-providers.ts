/**
 * Test-only provider stubs backed by the real Registro.br contract fixtures
 * (RNF-017). They let the API route tests exercise the full cadastro flow
 * (WHOIS/RDAP/ISAVAIL) without network access.
 */
import { readFileSync } from "node:fs";
import {
  createIsavailClientV1,
  parseRdapResponseV1,
  parseWhoisResponseV1,
  type IsavailProvider,
  type RdapProvider,
  type WhoisProvider,
} from "@domainhunter/providers";

const WHOIS_DIR = "../../../../packages/providers/src/whois/fixtures";
const RDAP_DIR = "../../../../packages/providers/src/rdap/fixtures";
const ISAVAIL_DIR = "../../../../packages/providers/src/isavail/fixtures";

const EXT: Record<"whois" | "rdap" | "isavail", string> = {
  whois: "txt",
  rdap: "json",
  isavail: "txt",
};

function fixture(dir: string, ext: string, name: string): string {
  return readFileSync(new URL(`${dir}/${name}.${ext}`, import.meta.url), "utf8");
}

export function whoisProviderFixture(name: string, queriedAt: string): WhoisProvider {
  return {
    async query(domain: string) {
      return parseWhoisResponseV1({
        domain,
        raw: fixture(WHOIS_DIR, EXT.whois, name),
        queriedAt,
      });
    },
  };
}

export function rdapProviderFixture(name: string, queriedAt: string): RdapProvider {
  return {
    async query(domain: string) {
      return parseRdapResponseV1({
        domain,
        raw: fixture(RDAP_DIR, EXT.rdap, name),
        status: 200,
        queriedAt,
      });
    },
  };
}

export function isavailProviderFixture(name: string, checkedAt: string): IsavailProvider {
  return createIsavailClientV1({
    transport: async () => fixture(ISAVAIL_DIR, EXT.isavail, name),
    clock: () => checkedAt,
  });
}

export function failingProvider(message: string): { whois: WhoisProvider; rdap: RdapProvider; isavail: IsavailProvider } {
  return {
    whois: { query: async () => Promise.reject(new Error(message)) },
    rdap: { query: async () => Promise.reject(new Error(message)) },
    isavail: { check: async () => Promise.reject(new Error(message)) },
  };
}

export function providers(
  overrides: Partial<{ whois: WhoisProvider; rdap: RdapProvider; isavail: IsavailProvider }> = {},
  queriedAt = "2026-08-11T12:00:00.000Z",
): { whois: WhoisProvider; rdap: RdapProvider; isavail: IsavailProvider } {
  return {
    whois: whoisProviderFixture("registered", queriedAt),
    rdap: rdapProviderFixture("registered", queriedAt),
    isavail: isavailProviderFixture("registered", queriedAt),
    ...overrides,
  };
}
