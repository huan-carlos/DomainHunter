import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { createInMemoryDatabase, migrate } from "../db/connection.ts";
import { SqliteDomainWatchRepository } from "./domain-watch-repository.ts";
import { SqliteDomainEventRepository } from "./domain-event-repository.ts";
import { SqliteNotificationRepository } from "./notification-repository.ts";

describe("SqliteNotificationRepository", () => {
  let db: DatabaseSync;
  let repo: SqliteNotificationRepository;
  let watchId: string;
  let eventId: string;

  beforeEach(() => {
    db = createInMemoryDatabase();
    migrate(db);
    const watches = new SqliteDomainWatchRepository(db);
    const watch = watches.create({
      domain: "example.com.br",
      userId: null,
      status: "AVAILABLE",
      priority: "CRITICAL",
      nextCheckAt: "2026-08-12T00:00:00.000Z",
    });
    watchId = watch.id;
    const events = new SqliteDomainEventRepository(db);
    const event = events.create({
      domainWatchId: watchId,
      type: "DOMAIN_AVAILABLE",
      source: "isavail",
      sourceVersion: "1.0.0",
      occurredAt: "2026-08-11T12:00:00.000Z",
      previousValue: "REGISTERED",
      newValue: "AVAILABLE",
      evidenceJson: "{}",
      priority: "CRITICAL",
    });
    eventId = event.id;
    repo = new SqliteNotificationRepository(db);
  });

  it("creates a notification with defaults", () => {
    const notification = repo.create({
      domainWatchId: watchId,
      domainEventId: eventId,
      channel: "email",
      priority: "CRITICAL",
      dedupKey: "hash-of-example-com-br-2026-08-11",
    });
    assert.equal(notification.status, "PENDING");
    assert.equal(notification.sentAt, null);
    assert.ok(notification.id);
  });

  it("deduplicates by (channel, dedup_key)", () => {
    const base = {
      domainWatchId: watchId,
      domainEventId: eventId,
      channel: "email" as const,
      priority: "CRITICAL",
      dedupKey: "same-key",
    };
    repo.create(base);
    assert.ok(repo.findByDedupKey("email", "same-key"));
    assert.throws(() => repo.create(base));
  });

  it("marks a notification sent", () => {
    const notification = repo.create({
      domainWatchId: watchId,
      domainEventId: eventId,
      channel: "dashboard",
      priority: "CRITICAL",
      dedupKey: "key-1",
    });
    const updated = repo.update(notification.id, {
      status: "SENT",
      sentAt: "2026-08-11T12:00:05.000Z",
    });
    assert.equal(updated?.status, "SENT");
  });

  it("tracks delivery attempts and limits retries", () => {
    const notification = repo.create({
      domainWatchId: watchId,
      domainEventId: eventId,
      channel: "email",
      priority: "CRITICAL",
      dedupKey: "key-retry",
      maxAttempts: 2,
    });
    assert.equal(notification.attempts, 0);
    assert.equal(notification.maxAttempts, 2);
    repo.update(notification.id, { attempts: 1, lastError: "SMTP timeout" });
    const pending = repo.findPending("email");
    assert.equal(pending.length, 1);
    repo.update(notification.id, { attempts: 2, status: "FAILED", lastError: "SMTP timeout" });
    assert.equal(repo.findPending("email").length, 0);
    assert.equal(repo.findById(notification.id)?.status, "FAILED");
  });

  it("lists notifications for a watch", () => {
    repo.create({
      domainWatchId: watchId,
      domainEventId: eventId,
      channel: "email",
      priority: "CRITICAL",
      dedupKey: "key-1",
    });
    repo.create({
      domainWatchId: watchId,
      domainEventId: eventId,
      channel: "dashboard",
      priority: "CRITICAL",
      dedupKey: "key-2",
    });
    assert.equal(repo.findByDomainWatchId(watchId).length, 2);
  });

  it("lists dashboard notifications per channel newest first (RF-020)", () => {
    repo.create({
      domainWatchId: watchId,
      domainEventId: eventId,
      channel: "dashboard",
      priority: "MEDIUM",
      dedupKey: "key-1",
    });
    repo.create({
      domainWatchId: watchId,
      domainEventId: eventId,
      channel: "dashboard",
      priority: "CRITICAL",
      dedupKey: "key-2",
    });
    repo.create({
      domainWatchId: watchId,
      domainEventId: eventId,
      channel: "email",
      priority: "CRITICAL",
      dedupKey: "key-3",
    });
    const dashboard = repo.findByChannel("dashboard");
    assert.equal(dashboard.length, 2);
    assert.equal(repo.findByChannel("email").length, 1);
  });

  it("marks a dashboard notification as read (RF-020)", () => {
    const notification = repo.create({
      domainWatchId: watchId,
      domainEventId: eventId,
      channel: "dashboard",
      priority: "CRITICAL",
      dedupKey: "key-read",
    });
    assert.equal(notification.readAt, null);
    assert.equal(repo.markRead(notification.id, "2026-08-11T12:05:00.000Z"), true);
    assert.equal(repo.findById(notification.id)?.readAt, "2026-08-11T12:05:00.000Z");
    assert.equal(repo.markRead(notification.id, "2026-08-11T12:06:00.000Z"), false);
    assert.equal(repo.findById(notification.id)?.readAt, "2026-08-11T12:05:00.000Z");
  });
});
