import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseWhoisResponseV1, normalizeRegistroDate } from "./parser.ts";
import { WhoisError } from "./errors.ts";
import { loadFixture } from "./fixtures/load.ts";

const QUERIED_AT = "2026-08-11T19:00:00.000Z";

describe("whois parser v1 (contract tests)", () => {
  it("parses a fully registered domain fixture", () => {
    const raw = loadFixture("registered");
    const record = parseWhoisResponseV1({
      domain: "domainhunter.com.br",
      raw,
      queriedAt: QUERIED_AT,
    });

    assert.equal(record.source, "whois");
    assert.equal(record.sourceVersion, "whois-client@v1");
    assert.equal(record.domain, "domainhunter.com.br");
    assert.equal(record.exists, true);
    assert.equal(record.owner, "DomainHunter Tecnologia Ltda");
    assert.equal(record.ownerId, "12.345.678/0001-90");
    assert.equal(record.responsible, "Lex Luthor");
    assert.equal(record.country, "BR");
    assert.equal(record.ownerContact, "LEX001");
    assert.equal(record.techContact, "TEC999");
    assert.equal(record.billingContact, "FAT123");
    assert.equal(record.createdAt, "2022-04-15T00:00:00.000Z");
    assert.equal(record.changedAt, "2026-08-01T00:00:00.000Z");
    assert.equal(record.expiresAt, "2028-09-10T00:00:00.000Z");
    assert.deepEqual(record.status, ["published"]);
    assert.deepEqual(record.nameServers, ["ns1.domainhunter.com.br", "ns2.domainhunter.com.br"]);
    assert.equal(record.queriedAt, QUERIED_AT);
    // Raw response is preserved byte-for-byte for audit (RNF-007).
    assert.equal(record.raw, raw);
  });

  it("parses a thin registered record and leaves missing fields null", () => {
    const record = parseWhoisResponseV1({
      domain: "registro.br",
      raw: loadFixture("registered-minimal"),
      queriedAt: QUERIED_AT,
    });

    assert.equal(record.exists, true);
    assert.equal(record.owner, "Nucleo de Inf. e Coord. do Ponto BR - NIC.BR");
    assert.equal(record.ownerId, null);
    assert.equal(record.responsible, null);
    assert.equal(record.billingContact, null);
    assert.equal(record.expiresAt, null);
    assert.equal(record.createdAt, "1999-02-21T00:00:00.000Z");
    assert.equal(record.changedAt, "2018-04-02T00:00:00.000Z");
    assert.deepEqual(record.nameServers, ["a.dns.br"]);
  });

  it("treats a 'no match' reply as non-existent with no field data", () => {
    const record = parseWhoisResponseV1({
      domain: "nao-existe-domainhunter-test.com.br",
      raw: loadFixture("not-found"),
      queriedAt: QUERIED_AT,
    });

    assert.equal(record.exists, false);
    assert.equal(record.owner, null);
    assert.equal(record.ownerId, null);
    assert.equal(record.createdAt, null);
    assert.equal(record.expiresAt, null);
    assert.deepEqual(record.status, []);
    assert.deepEqual(record.nameServers, []);
    assert.equal(record.raw, loadFixture("not-found"));
  });

  it("surfaces RATE_LIMIT as an identifiable error (never a verdict)", () => {
    assert.throws(
      () =>
        parseWhoisResponseV1({
          domain: "domainhunter.com.br",
          raw: loadFixture("rate-limit"),
          queriedAt: QUERIED_AT,
        }),
      (err: unknown) => {
        assert.ok(err instanceof WhoisError);
        assert.equal(err.code, "RATE_LIMIT");
        assert.equal(err.domain, "domainhunter.com.br");
        assert.equal(err.raw, loadFixture("rate-limit"));
        return true;
      },
    );
  });

  it("surfaces PARSER_ERROR for an unrecognizable response", () => {
    assert.throws(
      () =>
        parseWhoisResponseV1({
          domain: "domainhunter.com.br",
          raw: loadFixture("invalid"),
          queriedAt: QUERIED_AT,
        }),
      (err: unknown) => {
        assert.ok(err instanceof WhoisError);
        assert.equal(err.code, "PARSER_ERROR");
        return true;
      },
    );
  });

  it("normalizes Registro.br YYYYMMDD dates to ISO-8601 UTC", () => {
    assert.equal(normalizeRegistroDate("20220415"), "2022-04-15T00:00:00.000Z");
    assert.equal(normalizeRegistroDate("20220415 #90341"), "2022-04-15T00:00:00.000Z");
    assert.equal(normalizeRegistroDate(" 19990221 "), "1999-02-21T00:00:00.000Z");
    assert.equal(normalizeRegistroDate("not-a-date"), null);
    assert.equal(normalizeRegistroDate(""), null);
  });
});
