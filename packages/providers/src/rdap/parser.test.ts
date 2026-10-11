import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRdapResponseV1 } from "./parser.ts";
import { RdapError } from "./errors.ts";
import { loadFixture } from "./fixtures/load.ts";

const QUERIED_AT = "2026-08-11T19:00:00.000Z";

describe("rdap parser v1 (contract tests)", () => {
  it("parses a fully registered domain fixture", () => {
    const raw = loadFixture("registered");
    const result = parseRdapResponseV1({
      domain: "domainhunter.com.br",
      raw,
      queriedAt: QUERIED_AT,
    });

    assert.equal(result.source, "rdap");
    assert.equal(result.sourceVersion, "rdap-client@v1");
    assert.equal(result.domain, "domainhunter.com.br");
    assert.equal(result.exists, true);
    assert.equal(result.handle, "domainhunter.com.br");
    assert.equal(result.ldhName, "domainhunter.com.br");
    assert.deepEqual(result.status, ["active"]);
    assert.deepEqual(result.nameServers, ["ns1.domainhunter.com.br", "ns2.domainhunter.com.br"]);
    assert.equal(result.entities.length, 2);
    assert.equal(result.entities[0]?.handle, "05506560000136");
    assert.deepEqual(result.entities[0]?.roles, ["registrant"]);
    assert.equal(result.entities[1]?.handle, "TEC999");
    assert.equal(result.createdAt, "2022-04-15T12:00:00Z");
    assert.equal(result.expiresAt, "2028-09-10T12:00:00Z");
    assert.equal(result.changedAt, "2026-08-01T12:19:10Z");
    assert.equal(result.events.length, 3);
    assert.equal(result.queriedAt, QUERIED_AT);
    // Raw response is preserved for audit (RNF-007).
    assert.equal(result.raw, raw);
  });

  it("parses a thin registered record and leaves missing fields null", () => {
    const result = parseRdapResponseV1({
      domain: "registro.br",
      raw: loadFixture("registered-minimal"),
      queriedAt: QUERIED_AT,
    });

    assert.equal(result.exists, true);
    assert.equal(result.handle, null);
    assert.equal(result.expiresAt, null);
    assert.equal(result.createdAt, "1999-02-21T12:00:00Z");
    assert.equal(result.changedAt, "2018-04-02T12:19:10Z");
    assert.deepEqual(result.entities, []);
    assert.deepEqual(result.nameServers, ["a.dns.br"]);
  });

  it("treats a 404 status as non-existent with no field data", () => {
    const result = parseRdapResponseV1({
      domain: "nao-existe-domainhunter-test.com.br",
      raw: "",
      status: 404,
      queriedAt: QUERIED_AT,
    });

    assert.equal(result.exists, false);
    assert.equal(result.handle, null);
    assert.equal(result.ldhName, null);
    assert.equal(result.createdAt, null);
    assert.equal(result.expiresAt, null);
    assert.deepEqual(result.status, []);
    assert.deepEqual(result.nameServers, []);
    assert.equal(result.raw, "");
  });

  it("treats an RDAP error body with errorCode 404 as non-existent", () => {
    const raw = loadFixture("not-found");
    const result = parseRdapResponseV1({
      domain: "nao-existe-domainhunter-test.com.br",
      raw,
      queriedAt: QUERIED_AT,
    });

    assert.equal(result.exists, false);
    assert.deepEqual(result.status, []);
    assert.equal(result.raw, raw);
  });

  it("is tolerant of absent/odd optional sections (no WHOIS assumption)", () => {
    const result = parseRdapResponseV1({
      domain: "broken.domainhunter.com.br",
      raw: loadFixture("malformed"),
      queriedAt: QUERIED_AT,
    });

    assert.equal(result.exists, true);
    assert.deepEqual(result.events, []);
    assert.deepEqual(result.nameServers, []);
    assert.deepEqual(result.entities, []);
    assert.equal(result.createdAt, null);
  });

  it("surfaces PARSER_ERROR for an unrecognizable response", () => {
    assert.throws(
      () =>
        parseRdapResponseV1({
          domain: "domainhunter.com.br",
          raw: "{ this is not json",
          queriedAt: QUERIED_AT,
        }),
      (err: unknown) => {
        assert.ok(err instanceof RdapError);
        assert.equal(err.code, "PARSER_ERROR");
        assert.equal(err.domain, "domainhunter.com.br");
        return true;
      },
    );
  });

  it("surfaces PARSER_ERROR when the object is not a domain object", () => {
    assert.throws(
      () =>
        parseRdapResponseV1({
          domain: "domainhunter.com.br",
          raw: JSON.stringify({ objectClassName: "ip_network" }),
          queriedAt: QUERIED_AT,
        }),
      (err: unknown) => {
        assert.ok(err instanceof RdapError);
        assert.equal(err.code, "PARSER_ERROR");
        return true;
      },
    );
  });
});
