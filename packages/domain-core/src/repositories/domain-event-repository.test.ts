import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { createInMemoryDatabase, migrate } from "../db/connection.ts";
import { SqliteDomainWatchRepository } from "./domain-watch-repository.ts";
import { SqliteDomainEventRepository } from "./domain-event-repository.ts";

describe("SqliteDomainEventRepository", () => {
  let db: DatabaseSync;
  let repo: SqliteDomainEventRepository;
  let watchId: string;

  beforeEach(() => {
    db = createInMemoryDatabase();
    migrate(db);
    const watches = new SqliteDomainWatchRepository(db);
    const watch = watches.create({
      domain: "example.com.br",
      userId: null,
      status: "REGISTERED",
      priority: "HIGH",
      nextCheckAt: "2026-08-12T00:00:00.000Z",
    });
    watchId = watch.id;
    repo = new SqliteDomainEventRepository(db);
  });

  it("creates and retrieves an event", () => {
    const event = repo.create({
      domainWatchId: watchId,
      type: "DOMAIN_STATUS_CHANGED",
      source: "isavail",
      sourceVersion: "1.0.0",
      occurredAt: "2026-08-11T12:00:00.000Z",
      previousValue: "REGISTERED",
      newValue: "AVAILABLE",
      evidenceJson: JSON.stringify({ raw: "AVAILABLE" }),
      priority: "HIGH",
    });

    assert.ok(event.id);
    const found = repo.findById(event.id);
    assert.deepEqual(found, event);
  });

  it("lists events for a watch newest first", () => {
    repo.create({
      domainWatchId: watchId,
      type: "DOMAIN_STATUS_CHANGED",
      source: "isavail",
      sourceVersion: "1.0.0",
      occurredAt: "2026-08-11T10:00:00.000Z",
      previousValue: "REGISTERED",
      newValue: "EXPIRATION_APPROACHING",
      evidenceJson: "{}",
      priority: null,
    });
    repo.create({
      domainWatchId: watchId,
      type: "DOMAIN_AVAILABLE",
      source: "isavail",
      sourceVersion: "1.0.0",
      occurredAt: "2026-08-11T11:00:00.000Z",
      previousValue: "EXPIRATION_APPROACHING",
      newValue: "AVAILABLE",
      evidenceJson: "{}",
      priority: "CRITICAL",
    });

    const events = repo.findByDomainWatchId(watchId);
    assert.equal(events.length, 2);
    assert.equal(events[0]?.type, "DOMAIN_AVAILABLE");
    assert.equal(events[1]?.type, "DOMAIN_STATUS_CHANGED");
  });

  it("returns an empty list for unknown watches", () => {
    assert.deepEqual(repo.findByDomainWatchId("missing"), []);
  });
});
