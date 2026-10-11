import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { createInMemoryDatabase, migrate } from "../db/connection.ts";
import { SqliteDomainWatchRepository } from "./domain-watch-repository.ts";

describe("SqliteDomainWatchRepository", () => {
  let db: DatabaseSync;
  let repo: SqliteDomainWatchRepository;

  beforeEach(() => {
    db = createInMemoryDatabase();
    migrate(db);
    repo = new SqliteDomainWatchRepository(db);
  });

  it("creates and retrieves a watch with defaults", () => {
    const watch = repo.create({
      domain: "example.com.br",
      userId: null,
      status: "REGISTERED",
      priority: "HIGH",
      nextCheckAt: "2026-08-12T00:00:00.000Z",
    });

    assert.ok(watch.id);
    assert.equal(watch.domain, "example.com.br");
    assert.equal(watch.monitoringState, "ACTIVE");
    assert.equal(watch.phase, "A");
    assert.equal(watch.checkFailureCount, 0);

    const found = repo.findById(watch.id);
    assert.deepEqual(found, watch);
  });

  it("finds by normalized domain", () => {
    const watch = repo.create({
      domain: "example.com.br",
      userId: null,
      status: "REGISTERED",
      priority: "LOW",
      nextCheckAt: "2026-08-12T00:00:00.000Z",
    });
    assert.equal(repo.findByDomain("example.com.br")?.id, watch.id);
    assert.equal(repo.findByDomain("other.com"), null);
  });

  it("enforces unique domains", () => {
    repo.create({
      domain: "example.com.br",
      userId: null,
      status: "REGISTERED",
      priority: "LOW",
      nextCheckAt: "2026-08-12T00:00:00.000Z",
    });
    assert.throws(() =>
      repo.create({
        domain: "example.com.br",
        userId: null,
        status: "REGISTERED",
        priority: "LOW",
        nextCheckAt: "2026-08-12T00:00:00.000Z",
      })
    );
  });

  it("updates a watch", () => {
    const watch = repo.create({
      domain: "example.com.br",
      userId: null,
      status: "REGISTERED",
      priority: "HIGH",
      nextCheckAt: "2026-08-12T00:00:00.000Z",
    });
    const updated = repo.update(watch.id, { status: "EXPIRATION_APPROACHING", checkFailureCount: 2 });
    assert.equal(updated?.status, "EXPIRATION_APPROACHING");
    assert.equal(updated?.checkFailureCount, 2);
    assert.equal(repo.findById(watch.id)?.status, "EXPIRATION_APPROACHING");
  });

  it("returns null when updating a missing watch", () => {
    assert.equal(repo.update("missing", { status: "AVAILABLE" }), null);
  });

  it("soft-deletes a watch and hides it from queries", () => {
    const watch = repo.create({
      domain: "example.com.br",
      userId: null,
      status: "REGISTERED",
      priority: "HIGH",
      nextCheckAt: "2026-08-12T00:00:00.000Z",
    });
    assert.equal(repo.delete(watch.id), true);
    assert.equal(repo.findById(watch.id), null);
    assert.equal(repo.findAll().length, 0);
    assert.equal(repo.findByDomain("example.com.br"), null);
  });

  it("finds active watches due for a check", () => {
    repo.create({
      domain: "a.com.br",
      userId: null,
      status: "REGISTERED",
      priority: "HIGH",
      nextCheckAt: "2026-08-11T10:00:00.000Z",
    });
    repo.create({
      domain: "b.com.br",
      userId: null,
      status: "REGISTERED",
      priority: "HIGH",
      monitoringState: "PAUSED",
      nextCheckAt: "2026-08-11T09:00:00.000Z",
    });
    repo.create({
      domain: "c.com.br",
      userId: null,
      status: "REGISTERED",
      priority: "HIGH",
      nextCheckAt: "2026-08-11T12:00:00.000Z",
    });

    const due = repo.findActiveDue("2026-08-11T11:00:00.000Z");
    assert.deepEqual(
      due.map((w) => w.domain),
      ["a.com.br"]
    );
  });
});
