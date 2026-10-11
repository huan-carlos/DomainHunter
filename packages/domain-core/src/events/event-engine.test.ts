import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { createInMemoryDatabase, migrate } from "../db/connection.ts";
import { SqliteDomainEventRepository } from "../repositories/domain-event-repository.ts";
import { SqliteDomainWatchRepository } from "../repositories/domain-watch-repository.ts";
import { DOMAIN_EVENT_CATALOG, createEventEngine } from "./event-engine.ts";

describe("Event Engine", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createInMemoryDatabase();
    migrate(db);
  });

  it("exposes the full event catalog from the brief §26", () => {
    assert.ok(DOMAIN_EVENT_CATALOG.includes("DOMAIN_AVAILABLE"));
    assert.ok(DOMAIN_EVENT_CATALOG.includes("NOTIFICATION_SENT"));
    assert.ok(DOMAIN_EVENT_CATALOG.includes("CHECK_FAILED"));
    assert.equal(DOMAIN_EVENT_CATALOG.length >= 16, true);
  });

  it("records an event with source/timestamp/evidence (AC10, RNF-007)", () => {
    const watch = new SqliteDomainWatchRepository(db).create({
      domain: "exemplo.com.br",
      userId: null,
      status: "REGISTERED",
      priority: "MEDIUM",
      nextCheckAt: "2026-08-11T12:00:00.000Z",
    });
    const engine = createEventEngine({
      events: new SqliteDomainEventRepository(db),
      clock: () => "2026-08-11T12:00:00.000Z",
    });
    const event = engine.record({
      domainWatchId: watch.id,
      type: "DOMAIN_RENEWED",
      source: "whois",
      sourceVersion: "whois@v1",
      previousValue: "2026-09-10T00:00:00.000Z",
      newValue: "2027-09-10T00:00:00.000Z",
      evidenceJson: JSON.stringify({ owner: "DomainHunter" }),
      priority: "HIGH",
    });
    assert.ok(event.id);
    assert.equal(event.source, "whois");
    assert.equal(event.sourceVersion, "whois@v1");
    assert.equal(event.occurredAt, "2026-08-11T12:00:00.000Z");
    assert.equal(event.evidenceJson, JSON.stringify({ owner: "DomainHunter" }));
    assert.equal(event.priority, "HIGH");
    assert.equal(engine.findById(event.id)?.type, "DOMAIN_RENEWED");
  });

  it("rejects a record missing AC10 evidence", () => {
    const watch = new SqliteDomainWatchRepository(db).create({
      domain: "exemplo.com.br",
      userId: null,
      status: "REGISTERED",
      priority: "MEDIUM",
      nextCheckAt: "2026-08-11T12:00:00.000Z",
    });
    const engine = createEventEngine({
      events: new SqliteDomainEventRepository(db),
    });
    assert.throws(() =>
      engine.record({
        domainWatchId: watch.id,
        type: "DOMAIN_STATUS_CHANGED",
        source: "isavail",
        sourceVersion: "isavail@v1",
        evidenceJson: "",
      }),
    );
  });
});
