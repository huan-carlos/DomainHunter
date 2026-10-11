import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { createInMemoryDatabase, migrate } from "../db/connection.ts";
import { SqliteDomainWatchRepository } from "./domain-watch-repository.ts";
import { SqliteScheduledJobRepository } from "./scheduled-job-repository.ts";

describe("SqliteScheduledJobRepository", () => {
  let db: DatabaseSync;
  let repo: SqliteScheduledJobRepository;
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
    repo = new SqliteScheduledJobRepository(db);
  });

  it("creates a job with defaults", () => {
    const job = repo.create({
      domainWatchId: watchId,
      kind: "ISAVAIL",
      runAt: "2026-08-11T12:00:00.000Z",
    });
    assert.equal(job.status, "PENDING");
    assert.equal(job.attempts, 0);
    assert.equal(job.maxAttempts, 3);
    assert.equal(job.lockedBy, null);
  });

  it("finds due pending jobs", () => {
    repo.create({ domainWatchId: watchId, kind: "ISAVAIL", runAt: "2026-08-11T09:00:00.000Z" });
    repo.create({ domainWatchId: watchId, kind: "RELEASE_SCAN", runAt: "2026-08-11T13:00:00.000Z" });

    const due = repo.findDue("2026-08-11T10:00:00.000Z");
    assert.equal(due.length, 1);
    assert.equal(due[0]?.kind, "ISAVAIL");
  });

  it("claims the next due job atomically with a worker lock", () => {
    repo.create({ domainWatchId: watchId, kind: "ISAVAIL", runAt: "2026-08-11T09:00:00.000Z" });
    const claimed = repo.claimNext("2026-08-11T10:00:00.000Z", "worker-1");
    assert.ok(claimed);
    assert.equal(claimed.status, "RUNNING");
    assert.equal(claimed.lockedBy, "worker-1");
    assert.equal(claimed.attempts, 1);
    assert.equal(repo.claimNext("2026-08-11T10:00:00.000Z", "worker-2"), null);
  });

  it("marks a claimed job succeeded", () => {
    const job = repo.create({ domainWatchId: watchId, kind: "ISAVAIL", runAt: "2026-08-11T09:00:00.000Z" });
    const claimed = repo.claimNext("2026-08-11T10:00:00.000Z", "worker-1");
    const finished = repo.update(claimed!.id, {
      status: "SUCCEEDED",
      finishedAt: "2026-08-11T09:00:05.000Z",
    });
    assert.equal(finished?.status, "SUCCEEDED");
    assert.equal(repo.findById(job.id)?.status, "SUCCEEDED");
  });

  it("deletes a job", () => {
    const job = repo.create({ domainWatchId: watchId, kind: "ISAVAIL", runAt: "2026-08-11T09:00:00.000Z" });
    assert.equal(repo.delete(job.id), true);
    assert.equal(repo.findById(job.id), null);
  });
});
