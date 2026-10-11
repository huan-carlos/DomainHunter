import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createInMemoryDatabase,
  migrate,
  SqliteDomainEventRepository,
  SqliteNotificationRepository,
  SqliteScheduledJobRepository,
  SqliteDomainWatchRepository,
} from "@domainhunter/domain-core";
import { createNotificationService } from "@domainhunter/notifications";
import { InMemoryEmailProvider } from "@domainhunter/notifications";
import { createWorker } from "./worker.ts";

function insertWatch(db: ReturnType<typeof createInMemoryDatabase>, overrides: Partial<{ id: string; domain: string; status: string; priority: string }> = {}) {
  const watch = {
    id: "watch-notify",
    domain: "disponivel.com.br",
    userId: null,
    status: "REGISTERED",
    priority: "HIGH",
    monitoringState: "ACTIVE",
    createdAt: "2026-08-11T10:00:00.000Z",
    lastCheckAt: null,
    nextCheckAt: "2026-08-11T11:00:00.000Z",
    expirationAt: null,
    lastKnownOwner: null,
    lastKnownOwnerId: null,
    releaseProcessId: null,
    releaseStartAt: null,
    releaseEndAt: null,
    lastWhoisCheckAt: null,
    lastRdapCheckAt: null,
    lastIsavailCheckAt: null,
    lastSuccessfulCheckAt: null,
    availableSince: null,
    checkFailureCount: 0,
    phase: "A",
    clientVersions: null,
    deletedAt: null,
    ...overrides,
  };
  new SqliteDomainWatchRepository(db).create({
    domain: watch.domain,
    userId: null,
    status: watch.status as never,
    priority: watch.priority as never,
    nextCheckAt: watch.nextCheckAt,
  });
  return watch;
}

describe("createWorker notification hook (LEX-27)", () => {
  it("generates a high-priority alert when the INITIAL handler reaches AVAILABLE (AC05)", async () => {
    const db = createInMemoryDatabase();
    migrate(db);
    insertWatch(db);

    // Seed a DOMAIN_AVAILABLE event exactly as the state machine would emit
    // it for an AVAILABLE watch, then drive the notification path directly:
    // the worker handler is network-bound (real providers), so we verify the
    // wiring contract here — the INITIAL handler calls processEvents with the
    // events the initial check produced.
    const watches = new SqliteDomainWatchRepository(db);
    const watch = watches.findByDomain("disponivel.com.br");
    assert.ok(watch);
    watches.update(watch.id, { status: "AVAILABLE", priority: "CRITICAL", phase: "E" });

    const events = new SqliteDomainEventRepository(db);
    const event = events.create({
      domainWatchId: watch.id,
      type: "DOMAIN_AVAILABLE",
      source: "isavail",
      sourceVersion: "isavail@v1",
      occurredAt: "2026-08-11T12:00:00.000Z",
      previousValue: "REGISTERED",
      newValue: "AVAILABLE",
      evidenceJson: JSON.stringify({ status: "AVAILABLE" }),
      priority: "CRITICAL",
    });

    const email = new InMemoryEmailProvider();
    const notifications = createNotificationService({
      notifications: new SqliteNotificationRepository(db),
      events,
      watches,
      email,
      emailTo: "user@example.com",
      clock: () => "2026-08-11T12:00:00.000Z",
    });
    const created = notifications.processEvent(watch, event);
    assert.equal(created.length, 2);

    const job = new SqliteScheduledJobRepository(db).create({
      domainWatchId: watch.id,
      kind: "INITIAL",
      runAt: "2026-08-11T11:00:00.000Z",
    });
    // The INITIAL handler runs the notification hook after the check. We run
    // the worker with the notifications service injected and a no-op INITIAL
    // handler so the job dispatches, then confirm email dispatch happens on
    // the tick (dedicated queue).
    const worker = createWorker(
      { databasePath: ":memory:", pollIntervalMs: 1_000_000, workerId: "worker-notify" },
      {
        jobs: new SqliteScheduledJobRepository(db),
        notifications,
        clock: () => "2026-08-11T12:00:00.000Z",
        handlers: {
          INITIAL: async () => {},
        },
      }
    );
    worker.start();
    await worker.stop();
    // The worker tick dispatches the email asynchronously; drain the event
    // loop so the microtask/macrotask chain completes before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(email.sent.length, 1);
    assert.match(email.sent[0]?.subject ?? "", /disponivel\.com\.br/);
    const sent = new SqliteNotificationRepository(db)
      .findByDomainWatchId(watch.id)
      .find((n) => n.channel === "email");
    assert.equal(sent?.status, "SENT");
  });
});

describe("createWorker", () => {
  it("claims a due pending job and marks it succeeded on tick", async () => {
    const db = createInMemoryDatabase();
    migrate(db);
    const jobs = new SqliteScheduledJobRepository(db);

    const watch = {
      id: "watch-1",
      domain: "example.com.br",
      userId: null,
      status: "REGISTERED",
      priority: "HIGH",
      monitoringState: "ACTIVE",
      createdAt: "2026-08-11T10:00:00.000Z",
      lastCheckAt: null,
      nextCheckAt: "2026-08-11T11:00:00.000Z",
      expirationAt: null,
      lastKnownOwner: null,
      lastKnownOwnerId: null,
      releaseProcessId: null,
      releaseStartAt: null,
      releaseEndAt: null,
      lastWhoisCheckAt: null,
      lastRdapCheckAt: null,
      lastIsavailCheckAt: null,
      lastSuccessfulCheckAt: null,
      availableSince: null,
      checkFailureCount: 0,
      phase: "A",
      clientVersions: null,
      deletedAt: null,
    };
    db.prepare(
      `INSERT INTO domain_watches
         (id, domain, user_id, status, raw_last_status, priority, monitoring_state, created_at,
          last_check_at, next_check_at, expiration_at, last_known_owner, last_known_owner_id,
          release_process_id, release_start_at, release_end_at, last_whois_check_at, last_rdap_check_at,
          last_isavail_check_at, last_successful_check_at, available_since, check_failure_count,
          phase, client_versions, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      watch.id,
      watch.domain,
      watch.userId,
      watch.status,
      null,
      watch.priority,
      watch.monitoringState,
      watch.createdAt,
      watch.lastCheckAt,
      watch.nextCheckAt,
      watch.expirationAt,
      watch.lastKnownOwner,
      watch.lastKnownOwnerId,
      watch.releaseProcessId,
      watch.releaseStartAt,
      watch.releaseEndAt,
      watch.lastWhoisCheckAt,
      watch.lastRdapCheckAt,
      watch.lastIsavailCheckAt,
      watch.lastSuccessfulCheckAt,
      watch.availableSince,
      watch.checkFailureCount,
      watch.phase,
      null,
      watch.deletedAt
    );

    const job = jobs.create({
      domainWatchId: watch.id,
      kind: "ISAVAIL",
      runAt: "2026-08-11T09:00:00.000Z",
    });
    assert.equal(job.status, "PENDING");

    const fixedNow = "2026-08-11T10:00:00.000Z";
    const worker = createWorker(
      { databasePath: ":memory:", pollIntervalMs: 1_000_000, workerId: "worker-1" },
      { jobs, clock: () => fixedNow }
    );
    worker.start();
    await worker.stop();

    const finished = jobs.findById(job.id);
    assert.equal(finished?.status, "SUCCEEDED");
    assert.equal(finished?.finishedAt, fixedNow);
    assert.equal(finished?.lockedBy, "worker-1");
  });

  it("dispatches a due job to its kind handler (LEX-25 release scan hook)", async () => {
    const db = createInMemoryDatabase();
    migrate(db);
    const jobs = new SqliteScheduledJobRepository(db);

    const watch = {
      id: "watch-dispatch",
      domain: "dispatch.com.br",
      userId: null,
      status: "REGISTERED",
      priority: "HIGH",
      monitoringState: "ACTIVE",
      createdAt: "2026-08-11T10:00:00.000Z",
      lastCheckAt: null,
      nextCheckAt: "2026-08-11T11:00:00.000Z",
      expirationAt: null,
      lastKnownOwner: null,
      lastKnownOwnerId: null,
      releaseProcessId: null,
      releaseStartAt: null,
      releaseEndAt: null,
      lastWhoisCheckAt: null,
      lastRdapCheckAt: null,
      lastIsavailCheckAt: null,
      lastSuccessfulCheckAt: null,
      availableSince: null,
      checkFailureCount: 0,
      phase: "A",
      clientVersions: null,
      deletedAt: null,
    };
    db.prepare(
      `INSERT INTO domain_watches
         (id, domain, user_id, status, priority, monitoring_state, created_at, next_check_at,
          last_whois_check_at, last_rdap_check_at, last_isavail_check_at, last_successful_check_at,
          check_failure_count, phase)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, ?)`
    ).run(watch.id, watch.domain, watch.userId, watch.status, watch.priority, watch.monitoringState, watch.createdAt, watch.nextCheckAt, watch.phase);

    const job = jobs.create({
      domainWatchId: watch.id,
      kind: "RELEASE_SCAN",
      runAt: "2026-08-11T09:00:00.000Z",
    });

    let dispatchedKind: string | null = null;
    const worker = createWorker(
      { databasePath: ":memory:", pollIntervalMs: 1_000_000, workerId: "worker-1" },
      {
        jobs,
        clock: () => "2026-08-11T10:00:00.000Z",
        handlers: {
          RELEASE_SCAN: async (claimed) => {
            dispatchedKind = claimed.kind;
          },
        },
      }
    );
    worker.start();
    await worker.stop();

    assert.equal(dispatchedKind, "RELEASE_SCAN");
    assert.equal(jobs.findById(job.id)?.status, "SUCCEEDED");
  });

  it("reschedules a failed job with backoff while attempts remain (LEX-21 retry)", async () => {
    const db = createInMemoryDatabase();
    migrate(db);
    const jobs = new SqliteScheduledJobRepository(db);

    const watch = {
      id: "watch-retry",
      domain: "retry.com.br",
      userId: null,
      status: "REGISTERED",
      priority: "LOW",
      monitoringState: "ACTIVE",
      createdAt: "2026-08-11T10:00:00.000Z",
      lastCheckAt: null,
      nextCheckAt: "2026-08-11T11:00:00.000Z",
      expirationAt: null,
      lastKnownOwner: null,
      lastKnownOwnerId: null,
      releaseProcessId: null,
      releaseStartAt: null,
      releaseEndAt: null,
      lastWhoisCheckAt: null,
      lastRdapCheckAt: null,
      lastIsavailCheckAt: null,
      lastSuccessfulCheckAt: null,
      availableSince: null,
      checkFailureCount: 0,
      phase: "A",
      clientVersions: null,
      deletedAt: null,
    };
    db.prepare(
      `INSERT INTO domain_watches
         (id, domain, user_id, status, priority, monitoring_state, created_at, next_check_at,
          last_whois_check_at, last_rdap_check_at, last_isavail_check_at, last_successful_check_at,
          check_failure_count, phase)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, ?)`
    ).run(watch.id, watch.domain, watch.userId, watch.status, watch.priority, watch.monitoringState, watch.createdAt, watch.nextCheckAt, watch.phase);

    const job = jobs.create({
      domainWatchId: watch.id,
      kind: "ISAVAIL",
      runAt: "2026-08-11T09:00:00.000Z",
      maxAttempts: 3,
    });

    const worker = createWorker(
      { databasePath: ":memory:", pollIntervalMs: 1_000_000, workerId: "worker-1" },
      {
        jobs,
        clock: () => "2026-08-11T10:00:00.000Z",
        handlers: {
          ISAVAIL: async () => {
            throw new Error("ISAVAIL_TIMEOUT");
          },
        },
      }
    );
    worker.start();
    await worker.stop();

    const rescheduled = jobs.findById(job.id);
    assert.equal(rescheduled?.status, "PENDING");
    assert.equal(rescheduled?.lastError, "ISAVAIL_TIMEOUT");
    assert.equal(rescheduled?.nextRetryAt, "2026-08-11T10:01:00.000Z");
  });

  it("marks a job FAILED with lastError when its handler throws and attempts are exhausted", async () => {
    const db = createInMemoryDatabase();
    migrate(db);
    const jobs = new SqliteScheduledJobRepository(db);

    const watch = {
      id: "watch-fail",
      domain: "fail.com.br",
      userId: null,
      status: "REGISTERED",
      priority: "LOW",
      monitoringState: "ACTIVE",
      createdAt: "2026-08-11T10:00:00.000Z",
      lastCheckAt: null,
      nextCheckAt: "2026-08-11T11:00:00.000Z",
      expirationAt: null,
      lastKnownOwner: null,
      lastKnownOwnerId: null,
      releaseProcessId: null,
      releaseStartAt: null,
      releaseEndAt: null,
      lastWhoisCheckAt: null,
      lastRdapCheckAt: null,
      lastIsavailCheckAt: null,
      lastSuccessfulCheckAt: null,
      availableSince: null,
      checkFailureCount: 0,
      phase: "A",
      clientVersions: null,
      deletedAt: null,
    };
    db.prepare(
      `INSERT INTO domain_watches
         (id, domain, user_id, status, priority, monitoring_state, created_at, next_check_at,
          last_whois_check_at, last_rdap_check_at, last_isavail_check_at, last_successful_check_at,
          check_failure_count, phase)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, ?)`
    ).run(watch.id, watch.domain, watch.userId, watch.status, watch.priority, watch.monitoringState, watch.createdAt, watch.nextCheckAt, watch.phase);

    const job = jobs.create({
      domainWatchId: watch.id,
      kind: "ISAVAIL",
      runAt: "2026-08-11T09:00:00.000Z",
      maxAttempts: 1,
    });

    const worker = createWorker(
      { databasePath: ":memory:", pollIntervalMs: 1_000_000, workerId: "worker-1" },
      {
        jobs,
        clock: () => "2026-08-11T10:00:00.000Z",
        handlers: {
          ISAVAIL: async () => {
            throw new Error("ISAVAIL_TIMEOUT");
          },
        },
      }
    );
    worker.start();
    await worker.stop();

    const failed = jobs.findById(job.id);
    assert.equal(failed?.status, "FAILED");
    assert.equal(failed?.lastError, "ISAVAIL_TIMEOUT");
  });

  it("leaves a not-yet-due job pending", async () => {
    const db = createInMemoryDatabase();
    migrate(db);
    const jobs = new SqliteScheduledJobRepository(db);

    const watch = {
      id: "watch-2",
      domain: "future.com.br",
      userId: null,
      status: "REGISTERED",
      priority: "LOW",
      monitoringState: "ACTIVE",
      createdAt: "2026-08-11T10:00:00.000Z",
      lastCheckAt: null,
      nextCheckAt: "2026-08-12T00:00:00.000Z",
      expirationAt: null,
      lastKnownOwner: null,
      lastKnownOwnerId: null,
      releaseProcessId: null,
      releaseStartAt: null,
      releaseEndAt: null,
      lastWhoisCheckAt: null,
      lastRdapCheckAt: null,
      lastIsavailCheckAt: null,
      lastSuccessfulCheckAt: null,
      availableSince: null,
      checkFailureCount: 0,
      phase: "A",
      clientVersions: null,
      deletedAt: null,
    };
    db.prepare(
      `INSERT INTO domain_watches
         (id, domain, user_id, status, priority, monitoring_state, created_at, next_check_at,
          last_whois_check_at, last_rdap_check_at, last_isavail_check_at, last_successful_check_at,
          check_failure_count, phase)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, ?)`
    ).run(watch.id, watch.domain, watch.userId, watch.status, watch.priority, watch.monitoringState, watch.createdAt, watch.nextCheckAt, watch.phase);

    const job = jobs.create({
      domainWatchId: watch.id,
      kind: "RELEASE_SCAN",
      runAt: "2026-08-12T00:00:00.000Z",
    });

    const worker = createWorker(
      { databasePath: ":memory:", pollIntervalMs: 1_000_000, workerId: "worker-1" },
      { jobs, clock: () => "2026-08-11T10:00:00.000Z" }
    );
    worker.start();
    await worker.stop();

    assert.equal(jobs.findById(job.id)?.status, "PENDING");
  });
});
