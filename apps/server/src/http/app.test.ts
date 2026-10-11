import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import {
  createInMemoryDatabase,
  migrate,
  SqliteDomainEventRepository,
  SqliteDomainWatchRepository,
  SqliteNotificationRepository,
  SqliteNotificationSettingsRepository,
  SqliteScheduledJobRepository,
} from "@domainhunter/domain-core";
import { createDomainApp, type DomainAppDeps } from "./app.ts";
import {
  failingProvider,
  isavailProviderFixture,
  providers,
  rdapProviderFixture,
  whoisProviderFixture,
} from "./test-providers.ts";

const FIXED_NOW = "2026-08-11T12:00:00.000Z";

function makeDeps(overrides: Partial<DomainAppDeps> = {}): DomainAppDeps {
  const db = createInMemoryDatabase();
  migrate(db);
  return {
    watches: new SqliteDomainWatchRepository(db),
    events: new SqliteDomainEventRepository(db),
    jobs: new SqliteScheduledJobRepository(db),
    notifications: new SqliteNotificationRepository(db),
    providers: providers(),
    clock: () => FIXED_NOW,
    ...overrides,
  };
}

async function startApp(deps: DomainAppDeps): Promise<{ server: Server; port: number; close: () => Promise<void> }> {
  const app = createDomainApp(deps);
  const server = createServer(app.handle);
  server.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    server,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function postJson(port: number, path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function getJson(port: number, path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json() };
}

async function patchJson(port: number, path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function putJson(port: number, path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function requestJson(port: number, path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  const body = res.status === 204 ? null : await res.json();
  return { status: res.status, body };
}

describe("POST /domains", () => {  it("creates a DomainWatch and returns the initial diagnostic for a registered domain (AC01/AC02/AC03)", async () => {
    const { port, close } = await startApp(makeDeps());
    try {
      const { status, body } = await postJson(port, "/domains", { domain: "domainhunter.com.br" });
      assert.equal(status, 201);
      assert.equal(body.domain, "domainhunter.com.br");
      assert.equal(body.status, "REGISTERED");
      assert.equal(body.expirationAt, "2028-09-10T00:00:00.000Z");
      assert.ok(body.id);
      assert.equal(body.nextCheckAt, "2026-08-12T12:00:00.000Z"); // phase A → +24h
      assert.equal(body.phase, "A");
      assert.equal(body.lastKnownOwner, "DomainHunter Tecnologia Ltda");
      assert.equal(body.initialCheck.succeeded, true);
      assert.deepEqual(body.initialCheck.sources, { whois: "ok", rdap: "ok", isavail: "ok" });
    } finally {
      await close();
    }
  });

  it("reaches AVAILABLE only through a valid ISAVAIL reply (AC05)", async () => {
    const deps = makeDeps({
      providers: providers({
        whois: whoisProviderFixture("not-found", FIXED_NOW),
        rdap: rdapProviderFixture("not-found", FIXED_NOW),
        isavail: isavailProviderFixture("available", FIXED_NOW),
      }),
    });
    const { port, close } = await startApp(deps);
    try {
      const { status, body } = await postJson(port, "/domains", { domain: "disponivel.com.br" });
      assert.equal(status, 201);
      assert.equal(body.status, "AVAILABLE");
      assert.equal(body.priority, "CRITICAL");
      assert.equal(body.phase, "E");
      assert.ok(body.availableSince);
    } finally {
      await close();
    }
  });

  it("never marks AVAILABLE when ISAVAIL fails even if WHOIS shows an expiry (AC06)", async () => {
    const failing = failingProvider("ISAVAIL_TIMEOUT");
    const deps = makeDeps({
      providers: providers({
        whois: whoisProviderFixture("registered", FIXED_NOW),
        rdap: rdapProviderFixture("registered", FIXED_NOW),
        isavail: failing.isavail,
      }),
    });
    const { port, close } = await startApp(deps);
    try {
      const { status, body } = await postJson(port, "/domains", { domain: "domainhunter.com.br" });
      assert.equal(status, 201);
      assert.notEqual(body.status, "AVAILABLE");
      assert.equal(body.expirationAt, "2028-09-10T00:00:00.000Z");
      assert.equal(body.initialCheck.sources.isavail, "error");
      assert.equal(body.initialCheck.succeeded, true); // cadastral still succeeded
      assert.equal(body.checkFailureCount, 0);
    } finally {
      await close();
    }
  });

  it("returns a technical UNKNOWN diagnostic when every source fails (AC09)", async () => {
    const deps = makeDeps({ providers: failingProvider("SOURCE_UNAVAILABLE") });
    const { port, close } = await startApp(deps);
    try {
      const { status, body } = await postJson(port, "/domains", { domain: "domainhunter.com.br" });
      assert.equal(status, 201);
      assert.equal(body.status, "UNKNOWN");
      assert.equal(body.checkFailureCount, 1);
      assert.equal(body.initialCheck.succeeded, false);
      assert.deepEqual(body.initialCheck.sources, { whois: "error", rdap: "error", isavail: "error" });
    } finally {
      await close();
    }
  });

  it("enqueues an INITIAL scheduled job (plan §4)", async () => {
    const db = createInMemoryDatabase();
    migrate(db);
    const jobs = new SqliteScheduledJobRepository(db);
    const deps = makeDeps({
      jobs,
      watches: new SqliteDomainWatchRepository(db),
      events: new SqliteDomainEventRepository(db),
    });
    const { port, close } = await startApp(deps);
    try {
      const { status } = await postJson(port, "/domains", { domain: "domainhunter.com.br" });
      assert.equal(status, 201);
      const all = db.prepare("SELECT * FROM scheduled_jobs").all() as Array<{ kind: string; status: string; run_at: string }>;
      assert.equal(all.length, 1);
      assert.equal(all[0]?.kind, "INITIAL");
      assert.equal(all[0]?.status, "PENDING");
      assert.equal(all[0]?.run_at, FIXED_NOW);
    } finally {
      await close();
    }
  });

  it("rejects an invalid or non-br domain with 400", async () => {
    const { port, close } = await startApp(makeDeps());
    try {
      for (const invalid of ["not a domain", "example.com", "", "exemplo.foo.br"]) {
        const { status, body } = await postJson(port, "/domains", { domain: invalid });
        assert.equal(status, 400, `expected 400 for "${invalid}"`);
        assert.equal(body.error, "invalid_domain");
      }
    } finally {
      await close();
    }
  });

  it("rejects a duplicate registration with 409", async () => {
    const { port, close } = await startApp(makeDeps());
    try {
      const first = await postJson(port, "/domains", { domain: "www.domainhunter.com.br" });
      assert.equal(first.status, 201);
      const second = await postJson(port, "/domains", { domain: "domainhunter.com.br" });
      assert.equal(second.status, 409);
      assert.equal(second.body.error, "domain_already_watched");
    } finally {
      await close();
    }
  });
});

describe("auxiliary routes", () => {
  it("GET /domains lists created watches", async () => {
    const { port, close } = await startApp(makeDeps());
    try {
      await postJson(port, "/domains", { domain: "domainhunter.com.br" });
      const { status, body } = await getJson(port, "/domains");
      assert.equal(status, 200);
      assert.equal(body.domains.length, 1);
      assert.equal(body.domains[0].domain, "domainhunter.com.br");
    } finally {
      await close();
    }
  });

  it("GET /domains/:id returns the watch detail", async () => {
    const { port, close } = await startApp(makeDeps());
    try {
      const created = await postJson(port, "/domains", { domain: "domainhunter.com.br" });
      const { status, body } = await getJson(port, `/domains/${created.body.id}`);
      assert.equal(status, 200);
      assert.equal(body.id, created.body.id);
      assert.equal(body.status, "REGISTERED");
    } finally {
      await close();
    }
  });

  it("GET /domains/:id returns 404 for an unknown watch", async () => {
    const { port, close } = await startApp(makeDeps());
    try {
      const { status } = await getJson(port, "/domains/does-not-exist");
      assert.equal(status, 404);
    } finally {
      await close();
    }
  });

  it("GET /domains/:id/timeline returns the audit events (AC10)", async () => {
    const { port, close } = await startApp(makeDeps());
    try {
      const created = await postJson(port, "/domains", { domain: "domainhunter.com.br" });
      const { status, body } = await getJson(port, `/domains/${created.body.id}/timeline`);
      assert.equal(status, 200);
      const types = body.events.map((event: { type: string }) => event.type);
      assert.ok(types.includes("DOMAIN_CREATED_MONITOR"));
      assert.ok(types.includes("DOMAIN_STATUS_CHANGED"));
      const statusChanged = body.events.find((event: { type: string }) => event.type === "DOMAIN_STATUS_CHANGED");
      assert.equal(statusChanged?.previousValue, "UNKNOWN");
      assert.equal(statusChanged?.newValue, "REGISTERED");
      assert.ok(statusChanged?.sourceVersion);
    } finally {
      await close();
    }
  });
});

describe("domain action routes (LEX-26)", () => {
  it("POST /domains/:id/check enqueues a manual check job (RF-027)", async () => {
    const db = createInMemoryDatabase();
    migrate(db);
    const jobs = new SqliteScheduledJobRepository(db);
    const deps = makeDeps({
      jobs,
      watches: new SqliteDomainWatchRepository(db),
      events: new SqliteDomainEventRepository(db),
    });
    const { port, close } = await startApp(deps);
    try {
      const created = await postJson(port, "/domains", { domain: "domainhunter.com.br" });
      assert.equal(created.status, 201);
      const { status, body } = await requestJson(port, `/domains/${created.body.id}/check`, { method: "POST" });
      assert.equal(status, 202);
      assert.equal(body.status, "queued");
      assert.equal(body.job.kind, "INITIAL");
      assert.equal(body.job.runAt, FIXED_NOW);
      const all = db.prepare("SELECT * FROM scheduled_jobs ORDER BY created_at").all() as Array<{ kind: string; status: string }>;
      assert.equal(all.length, 2);
      assert.equal(all[1]?.kind, "INITIAL");
      assert.equal(all[1]?.status, "PENDING");
    } finally {
      await close();
    }
  });

  it("POST /domains/:id/check returns 404 for an unknown watch", async () => {
    const { port, close } = await startApp(makeDeps());
    try {
      const { status } = await requestJson(port, "/domains/does-not-exist/check", { method: "POST" });
      assert.equal(status, 404);
    } finally {
      await close();
    }
  });

  it("PATCH /domains/:id pauses and resumes monitoring (RF-022)", async () => {
    const { port, close } = await startApp(makeDeps());
    try {
      const created = await postJson(port, "/domains", { domain: "domainhunter.com.br" });
      assert.equal(created.body.monitoringState, "ACTIVE");

      const paused = await patchJson(port, `/domains/${created.body.id}`, { monitoringState: "PAUSED" });
      assert.equal(paused.status, 200);
      assert.equal(paused.body.monitoringState, "PAUSED");

      const resumed = await patchJson(port, `/domains/${created.body.id}`, { monitoringState: "ACTIVE" });
      assert.equal(resumed.status, 200);
      assert.equal(resumed.body.monitoringState, "ACTIVE");
    } finally {
      await close();
    }
  });

  it("PATCH /domains/:id rejects invalid monitoring states", async () => {
    const { port, close } = await startApp(makeDeps());
    try {
      const created = await postJson(port, "/domains", { domain: "domainhunter.com.br" });
      const { status, body } = await patchJson(port, `/domains/${created.body.id}`, { monitoringState: "STOPPED" });
      assert.equal(status, 400);
      assert.equal(body.error, "invalid_monitoring_state");
    } finally {
      await close();
    }
  });

  it("PATCH /domains/:id returns 404 for an unknown watch", async () => {
    const { port, close } = await startApp(makeDeps());
    try {
      const { status } = await patchJson(port, "/domains/does-not-exist", { monitoringState: "PAUSED" });
      assert.equal(status, 404);
    } finally {
      await close();
    }
  });

  it("DELETE /domains/:id removes monitoring (RF-023)", async () => {
    const { port, close } = await startApp(makeDeps());
    try {
      const created = await postJson(port, "/domains", { domain: "domainhunter.com.br" });
      const { status } = await requestJson(port, `/domains/${created.body.id}`, { method: "DELETE" });
      assert.equal(status, 204);
      const after = await getJson(port, `/domains/${created.body.id}`);
      assert.equal(after.status, 404);
    } finally {
      await close();
    }
  });

  it("DELETE /domains/:id returns 404 for an unknown watch", async () => {
    const { port, close } = await startApp(makeDeps());
    try {
      const { status } = await requestJson(port, "/domains/does-not-exist", { method: "DELETE" });
      assert.equal(status, 404);
    } finally {
      await close();
    }
  });
});

describe("dashboard notifications route (LEX-27)", () => {
  it("GET /domains/:id/notifications exposes dashboard notifications (RF-020)", async () => {
    const db = createInMemoryDatabase();
    migrate(db);
    const notifications = new SqliteNotificationRepository(db);
    const events = new SqliteDomainEventRepository(db);
    const watches = new SqliteDomainWatchRepository(db);
    const deps = makeDeps({
      notifications,
      watches,
      events,
      jobs: new SqliteScheduledJobRepository(db),
    });
    const { port, close } = await startApp(deps);
    try {
      const created = await postJson(port, "/domains", { domain: "domainhunter.com.br" });
      assert.equal(created.status, 201);
      const watch = watches.findByDomain("domainhunter.com.br");
      assert.ok(watch);

      const event = events.create({
        domainWatchId: watch.id,
        type: "DOMAIN_AVAILABLE",
        source: "isavail",
        sourceVersion: "isavail@v1",
        occurredAt: FIXED_NOW,
        previousValue: "REGISTERED",
        newValue: "AVAILABLE",
        evidenceJson: "{}",
        priority: "CRITICAL",
      });
      notifications.create({
        domainWatchId: watch.id,
        domainEventId: event.id,
        channel: "dashboard",
        priority: "CRITICAL",
        dedupKey: "dedup-dashboard-1",
        status: "SENT",
      });

      const { status, body } = await getJson(port, `/domains/${watch.id}/notifications`);
      assert.equal(status, 200);
      assert.equal(body.notifications.length, 1);
      assert.equal(body.notifications[0].channel, "dashboard");
      assert.equal(body.notifications[0].status, "SENT");
    } finally {
      await close();
    }
  });

  it("GET /domains/:id/notifications returns 404 for an unknown watch", async () => {
    const { port, close } = await startApp(makeDeps());
    try {
      const { status } = await getJson(port, "/domains/does-not-exist/notifications");
      assert.equal(status, 404);
    } finally {
      await close();
    }
  });
});

describe("dashboard notifications panel routes (LEX-28)", () => {
  it("GET /notifications lists dashboard notifications with domain + event type (RF-020)", async () => {
    const db = createInMemoryDatabase();
    migrate(db);
    const notifications = new SqliteNotificationRepository(db);
    const events = new SqliteDomainEventRepository(db);
    const watches = new SqliteDomainWatchRepository(db);
    const deps = makeDeps({ notifications, watches, events, jobs: new SqliteScheduledJobRepository(db) });
    const { port, close } = await startApp(deps);
    try {
      const created = await postJson(port, "/domains", { domain: "domainhunter.com.br" });
      assert.equal(created.status, 201);
      const watch = watches.findByDomain("domainhunter.com.br");
      assert.ok(watch);
      const event = events.create({
        domainWatchId: watch.id,
        type: "DOMAIN_AVAILABLE",
        source: "isavail",
        sourceVersion: "isavail@v1",
        occurredAt: FIXED_NOW,
        previousValue: "REGISTERED",
        newValue: "AVAILABLE",
        evidenceJson: "{}",
        priority: "CRITICAL",
      });
      notifications.create({
        domainWatchId: watch.id,
        domainEventId: event.id,
        channel: "dashboard",
        priority: "CRITICAL",
        dedupKey: "dashboard-panel-1",
        status: "SENT",
      });

      const { status, body } = await getJson(port, "/notifications");
      assert.equal(status, 200);
      assert.equal(body.notifications.length, 1);
      assert.equal(body.notifications[0].domain, "domainhunter.com.br");
      assert.equal(body.notifications[0].eventType, "DOMAIN_AVAILABLE");
      assert.equal(body.notifications[0].priority, "CRITICAL");
      assert.equal(body.notifications[0].readAt, null);
    } finally {
      await close();
    }
  });

  it("POST /notifications/:id/read marks a dashboard notification as read (RF-020)", async () => {
    const db = createInMemoryDatabase();
    migrate(db);
    const notifications = new SqliteNotificationRepository(db);
    const events = new SqliteDomainEventRepository(db);
    const watches = new SqliteDomainWatchRepository(db);
    const deps = makeDeps({ notifications, watches, events, jobs: new SqliteScheduledJobRepository(db) });
    const { port, close } = await startApp(deps);
    try {
      const created = await postJson(port, "/domains", { domain: "domainhunter.com.br" });
      assert.equal(created.status, 201);
      const watch = watches.findByDomain("domainhunter.com.br");
      assert.ok(watch);
      const event = events.create({
        domainWatchId: watch.id,
        type: "DOMAIN_AVAILABLE",
        source: "isavail",
        sourceVersion: "isavail@v1",
        occurredAt: FIXED_NOW,
        previousValue: "REGISTERED",
        newValue: "AVAILABLE",
        evidenceJson: "{}",
        priority: "CRITICAL",
      });
      const notification = notifications.create({
        domainWatchId: watch.id,
        domainEventId: event.id,
        channel: "dashboard",
        priority: "CRITICAL",
        dedupKey: "dashboard-read-1",
        status: "SENT",
      });

      const { status, body } = await postJson(port, `/notifications/${notification.id}/read`, {});
      assert.equal(status, 200);
      assert.ok(body.readAt);
      assert.equal(notifications.findById(notification.id)?.readAt, body.readAt);
    } finally {
      await close();
    }
  });

  it("POST /notifications/clear removes dashboard notifications (RF-020)", async () => {
    const db = createInMemoryDatabase();
    migrate(db);
    const notifications = new SqliteNotificationRepository(db);
    const events = new SqliteDomainEventRepository(db);
    const watches = new SqliteDomainWatchRepository(db);
    const deps = makeDeps({ notifications, watches, events, jobs: new SqliteScheduledJobRepository(db) });
    const { port, close } = await startApp(deps);
    try {
      const created = await postJson(port, "/domains", { domain: "domainhunter.com.br" });
      assert.equal(created.status, 201);
      const watch = watches.findByDomain("domainhunter.com.br");
      assert.ok(watch);
      const event = events.create({
        domainWatchId: watch.id,
        type: "DOMAIN_AVAILABLE",
        source: "isavail",
        sourceVersion: "isavail@v1",
        occurredAt: FIXED_NOW,
        previousValue: "REGISTERED",
        newValue: "AVAILABLE",
        evidenceJson: "{}",
        priority: "CRITICAL",
      });
      notifications.create({
        domainWatchId: watch.id,
        domainEventId: event.id,
        channel: "dashboard",
        priority: "CRITICAL",
        dedupKey: "dashboard-clear-1",
        status: "SENT",
      });

      const { status, body } = await postJson(port, "/notifications/clear", {});
      assert.equal(status, 200);
      assert.equal(body.cleared, 1);
      assert.equal(notifications.findByChannel("dashboard").length, 0);
    } finally {
      await close();
    }
  });
});

describe("notification settings routes (RF-021, LEX-28)", () => {
  it("GET /settings returns defaults when unset", async () => {
    const db = createInMemoryDatabase();
    migrate(db);
    const settings = new SqliteNotificationSettingsRepository(db);
    const { port, close } = await startApp(makeDeps({ settings }));
    try {
      const { status, body } = await getJson(port, "/settings");
      assert.equal(status, 200);
      assert.equal(body.notificationEmail, null);
      assert.equal(body.expirationNoticeDays, 45);
    } finally {
      await close();
    }
  });

  it("PUT /settings persists email and antecedent (RF-021)", async () => {
    const db = createInMemoryDatabase();
    migrate(db);
    const settings = new SqliteNotificationSettingsRepository(db);
    const { port, close } = await startApp(makeDeps({ settings }));
    try {
      const { status, body } = await putJson(port, "/settings", {
        notificationEmail: "alertas@domainhunter.local",
        expirationNoticeDays: 30,
      });
      assert.equal(status, 200);
      assert.equal(body.notificationEmail, "alertas@domainhunter.local");
      assert.equal(body.expirationNoticeDays, 30);

      const reread = await getJson(port, "/settings");
      assert.equal(reread.body.notificationEmail, "alertas@domainhunter.local");
      assert.equal(reread.body.expirationNoticeDays, 30);
    } finally {
      await close();
    }
  });

  it("PUT /settings rejects an invalid antecedent", async () => {
    const db = createInMemoryDatabase();
    migrate(db);
    const settings = new SqliteNotificationSettingsRepository(db);
    const { port, close } = await startApp(makeDeps({ settings }));
    try {
      const { status } = await putJson(port, "/settings", { expirationNoticeDays: 0 });
      assert.equal(status, 400);
    } finally {
      await close();
    }
  });
});
