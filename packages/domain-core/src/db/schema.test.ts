import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDatabase, migrate } from "./connection.ts";

describe("schema", () => {
  it("creates all required tables", () => {
    const db = createInMemoryDatabase();
    migrate(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    const names = new Set(tables.map((t) => t.name));

    assert.ok(names.has("domain_watches"));
    assert.ok(names.has("release_processes"));
    assert.ok(names.has("domain_events"));
    assert.ok(names.has("scheduled_jobs"));
    assert.ok(names.has("notifications"));
    assert.ok(names.has("notification_settings"));
  });

  it("creates the required indexes", () => {
    const db = createInMemoryDatabase();
    migrate(db);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all() as { name: string }[];
    const names = new Set(indexes.map((i) => i.name));

    assert.ok(names.has("idx_jobs_due"));
    assert.ok(names.has("idx_domain_events_watch"));
    assert.ok(names.has("idx_notifications_channel_created"));
  });

  it("is idempotent (migrate can run twice)", () => {
    const db = createInMemoryDatabase();
    migrate(db);
    migrate(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    assert.equal(tables.length, 6);
  });
});
