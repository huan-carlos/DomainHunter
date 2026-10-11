import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createReleaseCollectorV1 } from "./client.ts";
import { RELEASE_COLLECTOR_VERSION } from "./version.ts";
import { loadFixture } from "./fixtures/load.ts";

function textResponse(body: string) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response;
}

describe("release collector client v1", () => {
  it("fetches and parses the calendar against the official URL", async () => {
    const requested: string[] = [];
    const client = createReleaseCollectorV1({
      clock: () => "2026-08-11T12:00:00.000Z",
      fetcher: async (url) => {
        requested.push(url);
        return textResponse(loadFixture("calendar.json"));
      },
    });
    const record = await client.fetchCalendar();
    assert.equal(record.source, "release_collector");
    assert.equal(record.sourceVersion, RELEASE_COLLECTOR_VERSION);
    assert.equal(record.publish, true);
    assert.equal(record.startsAt, "2026-08-12T18:00:00.000Z");
    assert.deepEqual(requested, ["https://registro.br/dominio/proclib-schedule.json"]);
  });

  it("fetches and parses a public list against the official URL", async () => {
    const requested: string[] = [];
    const client = createReleaseCollectorV1({
      clock: () => "2026-08-11T12:00:00.000Z",
      fetcher: async (url) => {
        requested.push(url);
        return textResponse(loadFixture("list-competitive.txt"));
      },
    });
    const record = await client.fetchList("competitive");
    assert.equal(record.sourceVersion, RELEASE_COLLECTOR_VERSION);
    assert.equal(record.kind, "competitive");
    assert.deepEqual(record.domains, ["domainhunter.com.br", "008bank.com.br"]);
    assert.equal(record.sourceUrl, "https://registro.br/dominio/lista-processo-competitivo.txt");
    assert.deepEqual(requested, ["https://registro.br/dominio/lista-processo-competitivo.txt"]);
  });

  it("supports a base URL override for tests/mirrors", async () => {
    const client = createReleaseCollectorV1({
      baseUrl: "http://localhost:8787",
      fetcher: async (url) => {
        assert.equal(url, "http://localhost:8787/dominio/proclib-schedule.json");
        return textResponse(loadFixture("calendar.json"));
      },
    });
    await client.fetchCalendar();
  });

  it("uses a stable clock for fetchedAt (RNF-018)", async () => {
    const client = createReleaseCollectorV1({
      clock: () => "2026-01-01T00:00:00.000Z",
      fetcher: async () => textResponse(loadFixture("calendar.json")),
    });
    const record = await client.fetchCalendar();
    assert.equal(record.fetchedAt, "2026-01-01T00:00:00.000Z");
  });

  it("builds a versioned sourceVersion (RNF-016)", async () => {
    const client = createReleaseCollectorV1({
      fetcher: async () => textResponse(loadFixture("calendar.json")),
    });
    const record = await client.fetchCalendar();
    assert.equal(record.sourceVersion, "release-collector@v1");
  });
});
