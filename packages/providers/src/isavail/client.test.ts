import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createIsavailClientV1 } from "./client.ts";
import { IsavailError } from "./errors.ts";
import { ISAVAIL_CLIENT_VERSION } from "./version.ts";
import { loadFixture } from "./fixtures/load.ts";

/** Fake transport that answers every query with the given fixture. */
function fakeTransport(fixture: string) {
  return async () => fixture;
}

describe("isavail client v1", () => {
  it("reports an AVAILABLE domain with audit fields (RNF-007, RNF-018)", async () => {
    const client = createIsavailClientV1({
      transport: fakeTransport(loadFixture("available")),
      clock: () => "2026-08-11T12:00:00.000Z",
    });
    const record = await client.check("domainhunter.com.br");
    assert.equal(record.source, "isavail");
    assert.equal(record.sourceVersion, ISAVAIL_CLIENT_VERSION);
    assert.equal(record.available, true);
    assert.equal(record.statusCode, 0);
    assert.equal(record.checkedAt, "2026-08-11T12:00:00.000Z");
    assert.equal(record.raw, loadFixture("available"));
  });

  it("reports status 1 (available with ticket) as available", async () => {
    const client = createIsavailClientV1({
      transport: fakeTransport(loadFixture("available-with-ticket")),
    });
    const record = await client.check("domainhunter.com.br");
    assert.equal(record.available, true);
    assert.equal(record.statusCode, 1);
    assert.deepEqual(record.tickets, ["2567849", "2567856"]);
  });

  it("reports a REGISTERED domain as not available, preserving raw data", async () => {
    const client = createIsavailClientV1({
      transport: fakeTransport(loadFixture("registered")),
      clock: () => "2026-08-11T12:00:00.000Z",
    });
    const record = await client.check("domainhunter.eng.br");
    assert.equal(record.available, false);
    assert.equal(record.statusCode, 2);
    assert.equal(record.expirationDate, "2007-03-15T00:00:00.000Z");
    assert.deepEqual(record.nameServers, ["fork.domainhunter.eng.br", "domainhunter.eng.br"]);
  });

  it("reports a RESERVED/unavailable domain as not available, preserving the reason", async () => {
    const client = createIsavailClientV1({
      transport: fakeTransport(loadFixture("reserved")),
    });
    const record = await client.check("domainhunter.com.br");
    assert.equal(record.available, false);
    assert.equal(record.statusCode, 3);
    assert.equal(record.message, "reserved CG");
  });

  it("performs the cookie handshake and re-queries once with the issued cookie", async () => {
    const handshake = loadFixture("cookie-handshake");
    const available = loadFixture("available");
    const queries: string[] = [];
    const transport = async (_domain: string, query: string) => {
      queries.push(query);
      return queries.length === 1 ? handshake : available;
    };
    const client = createIsavailClientV1({ transport });
    const record = await client.check("domainhunter.com.br");
    assert.equal(record.available, true);
    assert.equal(queries.length, 2);
    assert.match(queries[0]!, / 00000000000000000000 /);
    assert.match(queries[1]!, / 8a6e52837fc2c68f7a4a /);
  });

  it("throws RATE_LIMIT when the service reports a rate-limited error (RNF-020)", async () => {
    const client = createIsavailClientV1({
      transport: fakeTransport(loadFixture("rate-limit")),
    });
    await assert.rejects(
      () => client.check("domainhunter.com.br"),
      (err: unknown) => {
        assert.equal(IsavailError.isIsavailError(err), true);
        if (IsavailError.isIsavailError(err)) {
          assert.equal(err.code, "RATE_LIMIT");
          assert.equal(err.domain, "domainhunter.com.br");
        }
        return true;
      },
    );
  });

  it("throws PARSER_ERROR for an unrecognizable reply", async () => {
    const client = createIsavailClientV1({
      transport: fakeTransport(loadFixture("invalid")),
    });
    await assert.rejects(() => client.check("domainhunter.com.br"));
  });

  it("throws PARSER_ERROR when the cookie handshake does not converge", async () => {
    const handshake = loadFixture("cookie-handshake");
    const client = createIsavailClientV1({
      transport: fakeTransport(handshake),
    });
    await assert.rejects(() => client.check("domainhunter.com.br"));
  });

  it("uses a stable clock for checkedAt", async () => {
    const client = createIsavailClientV1({
      transport: fakeTransport(loadFixture("available")),
      clock: () => "2026-01-01T00:00:00.000Z",
    });
    const record = await client.check("domainhunter.com.br");
    assert.equal(record.checkedAt, "2026-01-01T00:00:00.000Z");
  });

  it("builds a versioned sourceVersion (RNF-016)", async () => {
    const client = createIsavailClientV1({
      transport: fakeTransport(loadFixture("available")),
    });
    const record = await client.check("domainhunter.com.br");
    assert.equal(record.sourceVersion, "isavail-client@v1");
  });
});
