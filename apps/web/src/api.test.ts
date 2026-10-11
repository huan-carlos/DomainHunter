import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, createApiClient } from "./api.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("listDomains parses a successful /domains response", async () => {
  const domains = [{ id: "id", domain: "exemplo.com.br", status: "REGISTERED" }];
  const client = createApiClient({
    baseUrl: "http://api.test",
    fetchImpl: async () => jsonResponse({ domains }),
  });
  const result = await client.listDomains();
  assert.equal(result.domains.length, 1);
  assert.equal(result.domains[0]?.domain, "exemplo.com.br");
});

test("registerDomain returns the watch and initial diagnostic (AC01/AC02/AC03)", async () => {
  const watch = { id: "w1", domain: "exemplo.com.br", status: "REGISTERED", expirationAt: "2028-09-10T00:00:00.000Z", nextCheckAt: "2026-08-12T12:00:00.000Z" };
  const initialCheck = { succeeded: true, sources: { whois: "ok", rdap: "ok", isavail: "ok" } };
  const client = createApiClient({
    baseUrl: "http://api.test",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.domain, "exemplo.com.br");
      return jsonResponse({ ...watch, initialCheck }, 201);
    },
  });
  const outcome = await client.registerDomain("exemplo.com.br");
  assert.equal(outcome.kind, "created");
  if (outcome.kind === "created") {
    assert.equal(outcome.result.watch.domain, "exemplo.com.br");
    assert.equal(outcome.result.initialCheck.succeeded, true);
  }
});

test("registerDomain returns already_watched on 409", async () => {
  const client = createApiClient({
    baseUrl: "http://api.test",
    fetchImpl: async () =>
      jsonResponse({ error: "domain_already_watched", domain: "exemplo.com.br", watch: { id: "w1", domain: "exemplo.com.br" } }, 409),
  });
  const outcome = await client.registerDomain("exemplo.com.br");
  assert.equal(outcome.kind, "already_watched");
  if (outcome.kind === "already_watched") {
    assert.equal(outcome.domain, "exemplo.com.br");
    assert.equal(outcome.watch.id, "w1");
  }
});

test("registerDomain throws ApiError on server validation failure", async () => {
  const client = createApiClient({
    baseUrl: "http://api.test",
    fetchImpl: async () =>
      jsonResponse({ error: "invalid_domain", code: "UNSUPPORTED_TLD", message: "only .br domains are supported", domain: "exemplo.com" }, 400),
  });
  await assert.rejects(
    client.registerDomain("exemplo.com"),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.code, "invalid_domain");
      assert.match(error.message, /only \.br domains/);
      return true;
    },
  );
});

test("client throws ApiClientError-style ApiError on non-OK status", async () => {
  const client = createApiClient({
    baseUrl: "http://api.test",
    fetchImpl: async () => jsonResponse({ error: "internal_error", message: "boom" }, 500),
  });
  await assert.rejects(
    client.listDomains(),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 500);
      assert.equal(error.code, "internal_error");
      assert.match(error.message, /boom/);
      return true;
    },
  );
});

test("client wraps network failures in ApiError", async () => {
  const client = createApiClient({
    baseUrl: "http://api.test",
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  await assert.rejects(
    client.listDomains(),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 0);
      return true;
    },
  );
});

test("listNotifications parses the dashboard notifications payload (RF-020)", async () => {
  const notifications = [
    {
      id: "n1",
      domainId: "w1",
      domain: "exemplo.com.br",
      eventType: "DOMAIN_AVAILABLE",
      priority: "CRITICAL",
      channel: "dashboard",
      status: "SENT",
      readAt: null,
      createdAt: "2026-08-11T12:00:00.000Z",
    },
  ];
  const client = createApiClient({
    baseUrl: "http://api.test",
    fetchImpl: async () => jsonResponse({ notifications }),
  });
  const result = await client.listNotifications();
  assert.equal(result.notifications.length, 1);
  assert.equal(result.notifications[0]?.domain, "exemplo.com.br");
  assert.equal(result.notifications[0]?.priority, "CRITICAL");
});

test("markNotificationRead POSTs to the read action (RF-020)", async () => {
  let calledPath = "";
  const client = createApiClient({
    baseUrl: "http://api.test",
    fetchImpl: async (url, init) => {
      calledPath = String(url);
      assert.equal(init?.method, "POST");
      return jsonResponse({ id: "n1", readAt: "2026-08-11T12:05:00.000Z" });
    },
  });
  const result = await client.markNotificationRead("n1");
  assert.ok(calledPath.endsWith("/notifications/n1/read"));
  assert.ok(result.readAt);
});

test("clearNotifications POSTs to the clear action (RF-020)", async () => {
  let calledPath = "";
  const client = createApiClient({
    baseUrl: "http://api.test",
    fetchImpl: async (url, init) => {
      calledPath = String(url);
      assert.equal(init?.method, "POST");
      return jsonResponse({ cleared: 2 });
    },
  });
  const result = await client.clearNotifications();
  assert.ok(calledPath.endsWith("/notifications/clear"));
  assert.equal(result.cleared, 2);
});

test("getSettings parses the settings payload (RF-021)", async () => {
  const client = createApiClient({
    baseUrl: "http://api.test",
    fetchImpl: async () =>
      jsonResponse({ notificationEmail: "alertas@exemplo.com.br", expirationNoticeDays: 30 }),
  });
  const result = await client.getSettings();
  assert.equal(result.notificationEmail, "alertas@exemplo.com.br");
  assert.equal(result.expirationNoticeDays, 30);
});

test("saveSettings PUTs the settings payload (RF-021)", async () => {
  let body: unknown;
  const client = createApiClient({
    baseUrl: "http://api.test",
    fetchImpl: async (_url, init) => {
      assert.equal(init?.method, "PUT");
      body = JSON.parse(String(init?.body));
      return jsonResponse({ notificationEmail: "alertas@exemplo.com.br", expirationNoticeDays: 15 });
    },
  });
  const result = await client.saveSettings({ notificationEmail: "alertas@exemplo.com.br", expirationNoticeDays: 15 });
  assert.equal(result.expirationNoticeDays, 15);
  assert.equal((body as { notificationEmail: string }).notificationEmail, "alertas@exemplo.com.br");
});
