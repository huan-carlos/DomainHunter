import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createWhoisClientV1,
  WhoisError,
  WHOIS_CLIENT_VERSION,
  createRdapClientV1,
  RdapError,
  RDAP_CLIENT_VERSION,
} from "./index.ts";
import type {
  WhoisProvider,
  RdapProvider,
  IsavailProvider,
  CollectorProvider,
  WhoisRecord,
  RdapResult,
} from "./index.ts";

describe("provider contracts", () => {
  it("WHOIS contract is implementable with a stub", async () => {
    const whois: WhoisProvider = {
      query: async (domain: string): Promise<WhoisRecord> => ({
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
        raw: "",
        queriedAt: new Date().toISOString(),
      }),
    };
    const result = await whois.query("example.com.br");
    assert.equal(result.domain, "example.com.br");
    assert.equal(result.exists, false);
    assert.deepEqual(result.nameServers, []);
    assert.equal(result.raw, "");
  });

  it("the versioned WHOIS client satisfies the WhoisProvider contract", () => {
    const client = createWhoisClientV1();
    assert.equal(typeof client.query, "function");
    assert.equal(client.constructor.name, "Object");
  });

  it("WHOIS errors are identifiable by code and keep the domain", () => {
    const err = new WhoisError("WHOIS_TIMEOUT", "timed out", {
      domain: "example.com.br",
    });
    assert.ok(err instanceof Error);
    assert.equal(err.code, "WHOIS_TIMEOUT");
    assert.equal(err.domain, "example.com.br");
    assert.equal(WhoisError.isWhoisError(err), true);
    assert.equal(WhoisError.isWhoisError(new Error("other")), false);
  });

  it("the versioned RDAP client satisfies the RdapProvider contract", () => {
    const client = createRdapClientV1();
    assert.equal(typeof client.query, "function");
    assert.equal(client.constructor.name, "Object");
  });

  it("RDAP errors are identifiable by code and keep the domain", () => {
    const err = new RdapError("RDAP_TIMEOUT", "timed out", {
      domain: "example.com.br",
    });
    assert.ok(err instanceof Error);
    assert.equal(err.code, "RDAP_TIMEOUT");
    assert.equal(err.domain, "example.com.br");
    assert.equal(RdapError.isRdapError(err), true);
    assert.equal(RdapError.isRdapError(new Error("other")), false);
  });

  it("RDAP contract is implementable with a stub", async () => {
    const rdap: RdapProvider = {
      query: async (domain: string): Promise<RdapResult> => ({
        source: "rdap",
        sourceVersion: RDAP_CLIENT_VERSION,
        domain,
        exists: false,
        handle: null,
        ldhName: domain,
        status: [],
        nameServers: [],
        entities: [],
        events: [],
        createdAt: null,
        changedAt: null,
        expiresAt: null,
        raw: {},
        queriedAt: new Date().toISOString(),
      }),
    };
    const result = await rdap.query("example.com.br");
    assert.equal(result.ldhName, "example.com.br");
    assert.equal(result.source, "rdap");
    assert.equal(result.sourceVersion, RDAP_CLIENT_VERSION);
    assert.equal(result.exists, false);
    assert.deepEqual(result.nameServers, []);
  });

  it("ISAVAIL contract is implementable with a stub", async () => {
    const isavail: IsavailProvider = {
      check: async (domain: string) => ({
        source: "isavail",
        sourceVersion: "isavail-client@v1",
        domain,
        statusCode: 3,
        status: "UNAVAILABLE",
        available: false,
        fqdn: null,
        fqdnAce: null,
        expirationDate: null,
        publicationStatus: null,
        nameServers: [],
        tickets: [],
        releaseBeginAt: null,
        releaseEndAt: null,
        acceptingNewTicketsUntil: null,
        message: null,
        raw: "",
        checkedAt: new Date().toISOString(),
      }),
    };
    const result = await isavail.check("example.com.br");
    assert.equal(result.available, false);
    assert.equal(result.status, "UNAVAILABLE");
    assert.ok(result.checkedAt);
  });

  it("Collector contract is implementable with a stub", async () => {
    const collector: CollectorProvider = {
      collect: async (domain: string) => ({
        domain,
        sources: [],
        whois: null,
        rdap: null,
        availability: null,
        collectedAt: new Date().toISOString(),
      }),
    };
    const result = await collector.collect("example.com.br");
    assert.equal(result.sources.length, 0);
  });
});
