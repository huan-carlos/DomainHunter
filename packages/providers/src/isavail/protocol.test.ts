import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isavailParserError } from "./errors.ts";
import { formatIsavailQuery, parseIsavailReply, normalizeIsavailDate } from "./protocol.ts";
import { loadFixture } from "./fixtures/load.ts";

describe("isavail protocol (contract fixtures)", () => {
  it("builds a v2 wire query with cookie, lang, qid, fqdn, suggest", () => {
    const wire = formatIsavailQuery({
      version: 2,
      cookie: "8a6e52837fc2c68f7a4a",
      lang: 0,
      qid: "123456789",
      fqdn: "example.com.br",
      suggest: 0,
    });
    assert.equal(wire, "2 8a6e52837fc2c68f7a4a 0 123456789 example.com.br 0");
  });

  it("builds a v0 query without the suggest field", () => {
    const wire = formatIsavailQuery({
      version: 0,
      cookie: "00000000000000000000",
      lang: 1,
      qid: "42",
      fqdn: "example.com.br",
    });
    assert.equal(wire, "0 00000000000000000000 1 42 example.com.br");
  });

  it("parses an AVAILABLE (status 0) reply", () => {
    const raw = loadFixture("available");
    const parsed = parseIsavailReply("domainhunter.com.br", raw);
    assert.equal(parsed.kind, "status");
    if (parsed.kind !== "status") return;
    assert.equal(parsed.statusCode, 0);
    assert.equal(parsed.status, "AVAILABLE");
    assert.equal(parsed.qid, "123456789");
    assert.equal(parsed.fqdn, "domainhunter.com.br");
    assert.equal(parsed.fqdnAce, null);
  });

  it("parses an AVAILABLE reply carrying the ACE form", () => {
    const raw = loadFixture("available-ace");
    const parsed = parseIsavailReply("domainhunter.com.br", raw);
    if (parsed.kind !== "status") return;
    assert.equal(parsed.statusCode, 0);
    assert.equal(parsed.fqdn, "xn--domainhunter-ecb.com.br");
    assert.equal(parsed.fqdnAce, "domainhunterã.com.br");
  });

  it("parses an AVAILABLE_WITH_TICKET (status 1) reply with tickets", () => {
    const raw = loadFixture("available-with-ticket");
    const parsed = parseIsavailReply("domainhunter.com.br", raw);
    if (parsed.kind !== "status") return;
    assert.equal(parsed.statusCode, 1);
    assert.equal(parsed.status, "AVAILABLE_WITH_TICKET");
    assert.deepEqual(parsed.tickets, ["2567849", "2567856"]);
  });

  it("parses a REGISTERED (status 2) reply with expiration, status and name servers", () => {
    const raw = loadFixture("registered");
    const parsed = parseIsavailReply("domainhunter.eng.br", raw);
    if (parsed.kind !== "status") return;
    assert.equal(parsed.statusCode, 2);
    assert.equal(parsed.status, "REGISTERED");
    assert.equal(parsed.expirationDate, "2007-03-15T00:00:00.000Z");
    assert.equal(parsed.publicationStatus, "published");
    assert.deepEqual(parsed.nameServers, ["fork.domainhunter.eng.br", "domainhunter.eng.br"]);
  });

  it("parses a RESERVED/unavailable (status 3) reply preserving the reason", () => {
    const raw = loadFixture("reserved");
    const parsed = parseIsavailReply("domainhunter.com.br", raw);
    if (parsed.kind !== "status") return;
    assert.equal(parsed.statusCode, 3);
    assert.equal(parsed.status, "UNAVAILABLE");
    assert.equal(parsed.message, "reserved CG");
  });

  it("parses a RELEASE_PROCESS_WAITING (status 5) reply", () => {
    const raw = loadFixture("release-waiting");
    const parsed = parseIsavailReply("domainhunter.com.br", raw);
    if (parsed.kind !== "status") return;
    assert.equal(parsed.statusCode, 5);
    assert.equal(parsed.status, "RELEASE_PROCESS_WAITING");
  });

  it("parses a COMPETITIVE_RELEASE (status 9) reply with dates and tickets", () => {
    const raw = loadFixture("competitive-release");
    const parsed = parseIsavailReply("domainhunter.com.br", raw);
    if (parsed.kind !== "status") return;
    assert.equal(parsed.statusCode, 9);
    assert.equal(parsed.status, "COMPETITIVE_RELEASE");
    assert.equal(parsed.releaseBeginAt, "2007-01-15T15:00:00.000Z");
    assert.equal(parsed.releaseEndAt, "2007-01-30T15:00:00.000Z");
    assert.equal(parsed.acceptingNewTicketsUntil, "2007-01-25T15:00:00.000Z");
    assert.deepEqual(parsed.tickets, ["2567849", "2567856"]);
  });

  it("parses an INVALID_QUERY (status 4) reply preserving the reason", () => {
    const raw = loadFixture("invalid-query");
    const parsed = parseIsavailReply("domainhunter.com", raw);
    if (parsed.kind !== "status") return;
    assert.equal(parsed.statusCode, 4);
    assert.equal(parsed.message, "invalid fqdn");
  });

  it("surfaces a cookie handshake reply", () => {
    const raw = loadFixture("cookie-handshake");
    const parsed = parseIsavailReply("domainhunter.com.br", raw);
    assert.equal(parsed.kind, "cookie");
    if (parsed.kind !== "cookie") return;
    assert.equal(parsed.cookie, "8a6e52837fc2c68f7a4a");
    assert.equal(parsed.qid, "123456789");
  });

  it("throws PARSER_ERROR for an unrecognizable response", () => {
    const raw = loadFixture("invalid");
    assert.throws(
      () => parseIsavailReply("domainhunter.com.br", raw),
      (err: unknown) => {
        assert.equal(isavailParserError, isavailParserError);
        assert.match(String((err as Error).message), /PARSER_ERROR|no ST\/CK line/);
        return true;
      },
    );
  });

  it("throws PARSER_ERROR for an empty response", () => {
    assert.throws(() => parseIsavailReply("domainhunter.com.br", ""));
  });
});

describe("normalizeIsavailDate", () => {
  it("normalizes a date-only registry value", () => {
    assert.equal(normalizeIsavailDate("2007-03-15"), "2007-03-15T00:00:00.000Z");
  });

  it("normalizes a date-time registry value", () => {
    assert.equal(
      normalizeIsavailDate("2007-01-15 15:00:00"),
      "2007-01-15T15:00:00.000Z",
    );
  });

  it("returns null for non-date values", () => {
    assert.equal(normalizeIsavailDate("0"), null);
    assert.equal(normalizeIsavailDate("nope"), null);
    assert.equal(normalizeIsavailDate(undefined), null);
    assert.equal(normalizeIsavailDate(null), null);
  });
});
