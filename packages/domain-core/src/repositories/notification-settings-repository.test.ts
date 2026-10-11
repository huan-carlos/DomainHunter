import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { createInMemoryDatabase, migrate } from "../db/connection.ts";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  SqliteNotificationSettingsRepository,
} from "./notification-settings-repository.ts";

describe("SqliteNotificationSettingsRepository", () => {
  let db: DatabaseSync;
  let repo: SqliteNotificationSettingsRepository;

  beforeEach(() => {
    db = createInMemoryDatabase();
    migrate(db);
    repo = new SqliteNotificationSettingsRepository(db);
  });

  it("returns defaults when unset (RF-021)", () => {
    const settings = repo.get();
    assert.equal(settings.id, "default");
    assert.equal(settings.notificationEmail, DEFAULT_NOTIFICATION_SETTINGS.notificationEmail);
    assert.equal(settings.expirationNoticeDays, 45);
  });

  it("persists email and antecedent (RF-021)", () => {
    const updated = repo.update({
      notificationEmail: "alertas@domainhunter.local",
      expirationNoticeDays: 30,
    });
    assert.equal(updated.notificationEmail, "alertas@domainhunter.local");
    assert.equal(updated.expirationNoticeDays, 30);

    const reread = repo.get();
    assert.equal(reread.notificationEmail, "alertas@domainhunter.local");
    assert.equal(reread.expirationNoticeDays, 30);
  });

  it("updates a single field without losing the others", () => {
    repo.update({ expirationNoticeDays: 15 });
    const reread = repo.get();
    assert.equal(reread.expirationNoticeDays, 15);
    assert.equal(reread.notificationEmail, DEFAULT_NOTIFICATION_SETTINGS.notificationEmail);
  });
});
