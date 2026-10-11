import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import {
  createInMemoryDatabase,
  migrate,
  SqliteDomainEventRepository,
  SqliteDomainWatchRepository,
  SqliteNotificationRepository,
  type DomainEvent,
  type DomainWatch,
} from "@domainhunter/domain-core";
import {
  channelsForPriority,
  createNotificationService,
} from "./notification-service.ts";
import { InMemoryEmailProvider } from "./mock-email-provider.ts";

const FIXED_NOW = "2026-08-11T12:00:00.000Z";

function seed(db: DatabaseSync): { watch: DomainWatch; event: DomainEvent; eventId: string } {
  const watches = new SqliteDomainWatchRepository(db);
  const watch = watches.create({
    domain: "exemplo.com.br",
    userId: null,
    status: "AVAILABLE",
    priority: "CRITICAL",
    nextCheckAt: FIXED_NOW,
  });
  const events = new SqliteDomainEventRepository(db);
  const event = events.create({
    domainWatchId: watch.id,
    type: "DOMAIN_AVAILABLE",
    source: "isavail",
    sourceVersion: "isavail@v1",
    occurredAt: FIXED_NOW,
    previousValue: "REGISTERED",
    newValue: "AVAILABLE",
    evidenceJson: JSON.stringify({ status: "AVAILABLE" }),
    priority: "CRITICAL",
  });
  return { watch, event, eventId: event.id };
}

function makeService(db: DatabaseSync, opts: { email?: InMemoryEmailProvider | null } = {}) {
  return createNotificationService({
    notifications: new SqliteNotificationRepository(db),
    events: new SqliteDomainEventRepository(db),
    watches: new SqliteDomainWatchRepository(db),
    email: opts.email ?? null,
    emailTo: "user@example.com",
    clock: () => FIXED_NOW,
  });
}

describe("channelsForPriority (brief §18)", () => {
  it("notifies both email and dashboard for high/medium priority", () => {
    for (const priority of ["CRITICAL", "HIGH", "MEDIUM"]) {
      assert.deepEqual(channelsForPriority(priority), ["email", "dashboard"]);
    }
  });

  it("notifies dashboard only for low priority", () => {
    assert.deepEqual(channelsForPriority("LOW"), ["dashboard"]);
  });

  it("does not notify technical events (null priority)", () => {
    assert.deepEqual(channelsForPriority(null), []);
  });
});

describe("createNotificationService.processEvent", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createInMemoryDatabase();
    migrate(db);
  });

  it("creates email + dashboard notifications for a high-priority event (AC05)", () => {
    const { watch, event } = seed(db);
    const service = makeService(db, { email: new InMemoryEmailProvider() });
    const created = service.processEvent(watch, event);
    assert.equal(created.length, 2);
    const channels = created.map((n) => n.channel).sort();
    assert.deepEqual(channels, ["dashboard", "email"]);
    const dashboard = created.find((n) => n.channel === "dashboard");
    assert.equal(dashboard?.status, "SENT");
    const email = created.find((n) => n.channel === "email");
    assert.equal(email?.status, "PENDING");
  });

  it("deduplicates the same event when reprocessed (RNF-003)", () => {
    const { watch, event } = seed(db);
    const service = makeService(db, { email: new InMemoryEmailProvider() });
    const first = service.processEvent(watch, event);
    const second = service.processEvent(watch, event);
    assert.equal(second.length, 0);
    assert.equal(first.length, 2);
    const repo = new SqliteNotificationRepository(db);
    assert.equal(repo.findByDomainWatchId(watch.id).length, 2);
  });

  it("a reprocessed event within the same bucket returns the existing row", () => {
    const { watch, event } = seed(db);
    const service = makeService(db, { email: new InMemoryEmailProvider() });
    service.processEvent(watch, event);
    // A later event of the same type within the same hour bucket.
    const events = new SqliteDomainEventRepository(db);
    const second = events.create({
      domainWatchId: watch.id,
      type: "DOMAIN_AVAILABLE",
      source: "isavail",
      sourceVersion: "isavail@v1",
      occurredAt: "2026-08-11T12:45:00.000Z",
      previousValue: "AVAILABLE",
      newValue: "AVAILABLE",
      evidenceJson: "{}",
      priority: "CRITICAL",
    });
    const created = service.processEvent(watch, second);
    assert.equal(created.length, 0);
  });

  it("creates dashboard-only notification for low priority", () => {
    const { watch } = seed(db);
    const events = new SqliteDomainEventRepository(db);
    const low = events.create({
      domainWatchId: watch.id,
      type: "DOMAIN_EXPIRATION_CHANGED",
      source: "whois",
      sourceVersion: "whois@v1",
      occurredAt: FIXED_NOW,
      previousValue: null,
      newValue: "2027-09-10T00:00:00.000Z",
      evidenceJson: "{}",
      priority: "LOW",
    });
    const service = makeService(db, { email: new InMemoryEmailProvider() });
    const created = service.processEvent(watch, low);
    assert.equal(created.length, 1);
    assert.equal(created[0]?.channel, "dashboard");
  });

  it("skips the email channel when no email provider/recipient is configured", () => {
    const { watch, event } = seed(db);
    const service = makeService(db, { email: null });
    const created = service.processEvent(watch, event);
    assert.equal(created.length, 1);
    assert.equal(created[0]?.channel, "dashboard");
  });
});

describe("createNotificationService.dispatchPendingEmail", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createInMemoryDatabase();
    migrate(db);
  });

  it("sends pending email notifications and marks them SENT", async () => {
    const { watch, event } = seed(db);
    const email = new InMemoryEmailProvider();
    const service = makeService(db, { email });
    service.processEvent(watch, event);

    const summary = await service.dispatchPendingEmail();
    assert.equal(summary.attempted, 1);
    assert.equal(summary.sent, 1);
    assert.equal(summary.failed, 0);
    assert.equal(email.sent.length, 1);
    assert.match(email.sent[0]?.subject ?? "", /exemplo\.com\.br/);

    const repo = new SqliteNotificationRepository(db);
    const sent = repo.findByDomainWatchId(watch.id).find((n) => n.channel === "email");
    assert.equal(sent?.status, "SENT");
    assert.equal(sent?.sentAt, FIXED_NOW);
  });

  it("records a NOTIFICATION_SENT audit event after a successful email (catalog §26)", async () => {
    const { watch, event } = seed(db);
    const service = makeService(db, { email: new InMemoryEmailProvider() });
    service.processEvent(watch, event);
    await service.dispatchPendingEmail();
    const events = new SqliteDomainEventRepository(db);
    const audit = events.findByDomainWatchId(watch.id);
    assert.ok(audit.some((e) => e.type === "NOTIFICATION_SENT"));
  });

  it("marks email FAILED after retries are exhausted without blocking (plan §9)", async () => {
    const { watch, event } = seed(db);
    const service = makeService(db, {
      email: new InMemoryEmailProvider({ failAlways: true }),
    });
    service.processEvent(watch, event);

    let summary = await service.dispatchPendingEmail();
    assert.equal(summary.attempted, 1);
    summary = await service.dispatchPendingEmail();
    summary = await service.dispatchPendingEmail();

    const repo = new SqliteNotificationRepository(db);
    const email = repo.findByDomainWatchId(watch.id).find((n) => n.channel === "email");
    assert.equal(email?.status, "FAILED");
    assert.equal(email?.attempts, 3);
    assert.ok(email?.lastError);
  });

  it("keeps email PENDING while retries remain (limited retry)", async () => {
    const { watch, event } = seed(db);
    const service = makeService(db, {
      email: new InMemoryEmailProvider({ failAlways: true }),
    });
    service.processEvent(watch, event);

    await service.dispatchPendingEmail();

    const repo = new SqliteNotificationRepository(db);
    const email = repo.findByDomainWatchId(watch.id).find((n) => n.channel === "email");
    assert.equal(email?.status, "PENDING");
    assert.equal(email?.attempts, 1);
  });

  it("succeeds after transient failures (retry recovers)", async () => {
    const { watch, event } = seed(db);
    const service = makeService(db, {
      email: new InMemoryEmailProvider({ failCount: 2 }),
    });
    service.processEvent(watch, event);

    await service.dispatchPendingEmail();
    await service.dispatchPendingEmail();
    const summary = await service.dispatchPendingEmail();

    assert.equal(summary.sent, 1);
    const repo = new SqliteNotificationRepository(db);
    const email = repo.findByDomainWatchId(watch.id).find((n) => n.channel === "email");
    assert.equal(email?.status, "SENT");
  });

  it("is a no-op when email is not configured", async () => {
    const { watch, event } = seed(db);
    const service = makeService(db, { email: null });
    service.processEvent(watch, event);
    const summary = await service.dispatchPendingEmail();
    assert.deepEqual(summary, { attempted: 0, sent: 0, failed: 0, errors: [] });
  });
});
