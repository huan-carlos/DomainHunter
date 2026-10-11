import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { createInMemoryDatabase, migrate } from "../db/connection.ts";
import { SqliteReleaseProcessRepository } from "./release-process-repository.ts";

describe("SqliteReleaseProcessRepository", () => {
  let db: DatabaseSync;
  let repo: SqliteReleaseProcessRepository;

  beforeEach(() => {
    db = createInMemoryDatabase();
    migrate(db);
    repo = new SqliteReleaseProcessRepository(db);
  });

  it("creates and retrieves a release process", () => {
    const process = repo.create({
      sourceReference: "ref-2026-01",
      startAt: "2026-08-01T00:00:00.000Z",
      endAt: null,
      publicationAt: "2026-08-01T00:00:00.000Z",
      candidatureWindowStartAt: null,
      candidatureWindowEndAt: null,
      status: "DETECTED",
      source: "registro.br-calendar",
      rawJson: "{}",
      collectedAt: "2026-08-01T12:00:00.000Z",
    });

    assert.ok(process.id);
    const found = repo.findById(process.id);
    assert.deepEqual(found, process);
  });

  it("updates status through the release lifecycle", () => {
    const process = repo.create({
      sourceReference: "ref-2026-01",
      startAt: null,
      endAt: null,
      publicationAt: null,
      candidatureWindowStartAt: null,
      candidatureWindowEndAt: null,
      status: "DETECTED",
      source: "registro.br-calendar",
      rawJson: null,
      collectedAt: "2026-08-01T12:00:00.000Z",
    });

    const updated = repo.update(process.id, { status: "CANDIDATURE_OPEN" });
    assert.equal(updated?.status, "CANDIDATURE_OPEN");
  });

  it("deletes a release process", () => {
    const process = repo.create({
      sourceReference: "ref-2026-01",
      startAt: null,
      endAt: null,
      publicationAt: null,
      candidatureWindowStartAt: null,
      candidatureWindowEndAt: null,
      status: "DETECTED",
      source: "registro.br-calendar",
      rawJson: null,
      collectedAt: "2026-08-01T12:00:00.000Z",
    });
    assert.equal(repo.delete(process.id), true);
    assert.equal(repo.findById(process.id), null);
  });
});
