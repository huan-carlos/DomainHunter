import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type {
  DomainApiClient,
  DomainEventDto,
  DomainWatchDto,
  RegisterDomainOutcome,
} from "./api.ts";
import { createDefaultWebApp, createWebApp, createWebServer } from "./index.ts";

const FIXED_NOW = "2026-08-11T12:00:00.000Z";

function makeWatch(overrides: Partial<DomainWatchDto> = {}): DomainWatchDto {
  return {
    id: "watch-1",
    domain: "domainhunter.com.br",
    status: "REGISTERED",
    rawLastStatus: "REGISTERED",
    priority: "HIGH",
    monitoringState: "ACTIVE",
    phase: "A",
    createdAt: FIXED_NOW,
    lastCheckAt: FIXED_NOW,
    nextCheckAt: "2026-08-12T12:00:00.000Z",
    expirationAt: "2028-09-10T00:00:00.000Z",
    lastKnownOwner: "DomainHunter Tecnologia Ltda",
    lastKnownOwnerId: null,
    releaseStartAt: null,
    releaseEndAt: null,
    lastWhoisCheckAt: FIXED_NOW,
    lastRdapCheckAt: FIXED_NOW,
    lastIsavailCheckAt: FIXED_NOW,
    lastSuccessfulCheckAt: FIXED_NOW,
    availableSince: null,
    checkFailureCount: 0,
    clientVersions: null,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<DomainEventDto> = {}): DomainEventDto {
  return {
    id: "event-1",
    type: "DOMAIN_STATUS_CHANGED",
    source: "isavail",
    sourceVersion: "isavail-client@v1",
    occurredAt: FIXED_NOW,
    previousValue: "UNKNOWN",
    newValue: "REGISTERED",
    evidence: {},
    priority: null,
    ...overrides,
  };
}

function makeApi(overrides: Partial<DomainApiClient> = {}): DomainApiClient {
  return {
    async listDomains() {
      return { domains: [makeWatch()] };
    },
    async getDomain(id: string) {
      if (id === "missing")
        throw Object.assign(new Error("not found"), { status: 404 });
      return makeWatch({ id });
    },
    async getTimeline() {
      return [makeEvent()];
    },
    async registerDomain(domain: string): Promise<RegisterDomainOutcome> {
      return {
        kind: "created",
        result: {
          watch: makeWatch({ domain }),
          initialCheck: {
            succeeded: true,
            sources: { whois: "ok", rdap: "ok", isavail: "ok" },
          },
        },
      };
    },
    async requestCheck() {},
    async setMonitoringState() {},
    async deleteDomain() {},
    async listNotifications() {
      return { notifications: [] };
    },
    async markNotificationRead() {
      return makeNotification({ id: "n1", readAt: FIXED_NOW });
    },
    async clearNotifications() {
      return { cleared: 0 };
    },
    async getSettings() {
      return { notificationEmail: null, expirationNoticeDays: 45 };
    },
    async saveSettings(patch) {
      return {
        notificationEmail: patch.notificationEmail ?? null,
        expirationNoticeDays: patch.expirationNoticeDays ?? 45,
      };
    },
    ...overrides,
  };
}

function makeNotification(
  overrides: Partial<ReturnType<typeof notificationDto>> = {},
): ReturnType<typeof notificationDto> {
  return notificationDto(overrides);
}

function notificationDto(
  overrides: Partial<import("./api.ts").NotificationDto> = {},
): import("./api.ts").NotificationDto {
  return {
    id: "n1",
    domainId: "watch-1",
    domain: "domainhunter.com.br",
    eventType: "DOMAIN_AVAILABLE",
    priority: "CRITICAL",
    channel: "dashboard",
    status: "SENT",
    readAt: null,
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

async function startApp(
  api: DomainApiClient,
): Promise<{ server: Server; port: number; close: () => Promise<void> }> {
  const app = createWebApp({ api, actionBase: "" });
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

async function get(
  port: number,
  path: string,
): Promise<{ status: number; body: string; location: string | null }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    redirect: "manual",
  });
  return {
    status: res.status,
    body: await res.text(),
    location: res.headers.get("location"),
  };
}

async function postForm(
  port: number,
  path: string,
  form: Record<string, string> = {},
): Promise<{ status: number; location: string | null; body: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  return {
    status: res.status,
    location: res.headers.get("location"),
    body: await res.text(),
  };
}

describe("web app routes", () => {
  it("GET / redirects to /domains", async () => {
    const { port, close } = await startApp(makeApi());
    try {
      const { status, location } = await get(port, "/");
      assert.equal(status, 303);
      assert.equal(location, "/domains");
    } finally {
      await close();
    }
  });

  it("GET /domains renders the list with the watched domain", async () => {
    const { port, close } = await startApp(makeApi());
    try {
      const { status, body } = await get(port, "/domains");
      assert.equal(status, 200);
      assert.match(body, /domainhunter\.com\.br/);
      assert.match(body, /DomainHunter/);
    } finally {
      await close();
    }
  });

  it("GET /domains/new renders the registration form", async () => {
    const { port, close } = await startApp(makeApi());
    try {
      const { status, body } = await get(port, "/domains/new");
      assert.equal(status, 200);
      assert.match(body, /Cadastrar domínio/);
      assert.match(body, /name="domain"/);
      assert.match(body, /Cadastrar e consultar/);
    } finally {
      await close();
    }
  });

  it("POST /domains registers a valid domain and shows the initial diagnostic", async () => {
    let posted = "";
    const api = makeApi({
      registerDomain: async (domain) => {
        posted = domain;
        return {
          kind: "created" as const,
          result: {
            watch: makeWatch({
              domain,
              status: "REGISTERED",
              expirationAt: "2028-09-10T00:00:00.000Z",
              nextCheckAt: "2026-08-12T12:00:00.000Z",
            }),
            initialCheck: {
              succeeded: true,
              sources: { whois: "ok", rdap: "ok", isavail: "ok" },
            },
          },
        };
      },
    });
    const { port, close } = await startApp(api);
    try {
      const { status, body } = await postForm(port, "/domains", {
        domain: "domainhunter.com.br",
      });
      assert.equal(status, 201);
      assert.equal(posted, "domainhunter.com.br");
      assert.match(body, /cadastrado com sucesso/);
      assert.match(body, /diagnostic-status/);
      assert.match(body, /Registrado/);
      assert.match(body, /10\/09\/2028/);
      assert.match(body, /12\/08\/2026/);
      assert.match(body, /Ver página do domínio/);
      assert.match(body, /href="\/domains\/watch-1"/);
    } finally {
      await close();
    }
  });

  it("POST /domains rejects a non-br domain with a client-side validation error", async () => {
    let calls = 0;
    const api = makeApi({
      registerDomain: async () => {
        calls += 1;
        throw new Error("should not be called");
      },
    });
    const { port, close } = await startApp(api);
    try {
      const { status, body } = await postForm(port, "/domains", {
        domain: "exemplo.com",
      });
      assert.equal(status, 400);
      assert.equal(calls, 0);
      assert.match(body, /Apenas domínios \.br são suportados\./);
      assert.match(body, /register-error/);
    } finally {
      await close();
    }
  });

  it("POST /domains surfaces an API error on the form", async () => {
    const api = makeApi({
      registerDomain: async () => {
        throw new Error("boom");
      },
    });
    const { port, close } = await startApp(api);
    try {
      const { status, body } = await postForm(port, "/domains", {
        domain: "domainhunter.com.br",
      });
      assert.equal(status, 502);
      assert.match(body, /Não foi possível cadastrar o domínio/);
      assert.match(body, /register-error/);
      assert.match(body, /value="domainhunter\.com\.br"/);
    } finally {
      await close();
    }
  });

  it("POST /domains handles an already-watched domain", async () => {
    const api = makeApi({
      registerDomain: async () => ({
        kind: "already_watched" as const,
        domain: "domainhunter.com.br",
        watch: makeWatch(),
      }),
    });
    const { port, close } = await startApp(api);
    try {
      const { status, body } = await postForm(port, "/domains", {
        domain: "domainhunter.com.br",
      });
      assert.equal(status, 409);
      assert.match(body, /já está sendo monitorado/);
      assert.match(body, /register-error/);
    } finally {
      await close();
    }
  });

  it("GET /domains/:id renders state, dates, monitoring and timeline", async () => {
    const { port, close } = await startApp(makeApi());
    try {
      const { status, body } = await get(port, "/domains/watch-1");
      assert.equal(status, 200);
      assert.match(body, /domainhunter\.com\.br/);
      assert.match(body, /Registrado/);
      assert.match(body, /Fase A/);
      assert.match(body, /11\/08\/2026/);
      assert.match(body, /Registrar domínio/);
      assert.match(body, /Registro\.br/);
      assert.match(body, /Linha do tempo/);
      assert.match(body, /Consultar agora/);
      assert.match(body, /Pausar/);
      assert.match(body, /Encerrar monitoramento/);
      assert.match(body, /ISAVAIL/);
    } finally {
      await close();
    }
  });

  it("GET /domains/:id shows resume when paused", async () => {
    const api = makeApi({
      getDomain: async () => makeWatch({ monitoringState: "PAUSED" }),
    });
    const { port, close } = await startApp(api);
    try {
      const { body } = await get(port, "/domains/watch-1");
      assert.match(body, /Retomar/);
    } finally {
      await close();
    }
  });

  it("GET /domains/:id renders release process section when present", async () => {
    const api = makeApi({
      getDomain: async () =>
        makeWatch({
          releaseStartAt: "2026-09-01T00:00:00.000Z",
          releaseEndAt: "2026-10-01T00:00:00.000Z",
        }),
    });
    const { port, close } = await startApp(api);
    try {
      const { body } = await get(port, "/domains/watch-1");
      assert.match(body, /Processo de liberação/);
    } finally {
      await close();
    }
  });

  it("POST /domains/:id/check redirects with notice after calling the API", async () => {
    let checked = "";
    const api = makeApi({
      requestCheck: async (id) => {
        checked = id;
      },
    });
    const { port, close } = await startApp(api);
    try {
      const { status, location } = await postForm(
        port,
        "/domains/watch-1/check",
      );
      assert.equal(status, 303);
      assert.equal(checked, "watch-1");
      assert.match(location ?? "", /notice=check-queued/);
    } finally {
      await close();
    }
  });

  it("POST /domains/:id/monitoring pauses and resumes via the API", async () => {
    const calls: Array<{ id: string; state: string }> = [];
    const api = makeApi({
      setMonitoringState: async (id, state) => {
        calls.push({ id, state });
      },
    });
    const { port, close } = await startApp(api);
    try {
      const pause = await postForm(port, "/domains/watch-1/monitoring", {
        monitoringState: "PAUSED",
      });
      assert.equal(pause.status, 303);
      assert.match(pause.location ?? "", /notice=monitoring-paused/);
      const resume = await postForm(port, "/domains/watch-1/monitoring", {
        monitoringState: "ACTIVE",
      });
      assert.equal(resume.status, 303);
      assert.deepEqual(calls, [
        { id: "watch-1", state: "PAUSED" },
        { id: "watch-1", state: "ACTIVE" },
      ]);
    } finally {
      await close();
    }
  });

  it("POST /domains/:id/monitoring rejects an invalid state", async () => {
    const { port, close } = await startApp(makeApi());
    try {
      const { status, body } = await postForm(
        port,
        "/domains/watch-1/monitoring",
        { monitoringState: "STOPPED" },
      );
      assert.equal(status, 400);
      assert.match(body, /monitoringState/);
    } finally {
      await close();
    }
  });

  it("POST /domains/:id/delete redirects to the list after removing", async () => {
    let deleted = "";
    const api = makeApi({
      deleteDomain: async (id) => {
        deleted = id;
      },
    });
    const { port, close } = await startApp(api);
    try {
      const { status, location } = await postForm(
        port,
        "/domains/watch-1/delete",
      );
      assert.equal(status, 303);
      assert.equal(deleted, "watch-1");
      assert.match(location ?? "", /notice=deleted/);
    } finally {
      await close();
    }
  });

  it("returns 404 for unknown paths", async () => {
    const { port, close } = await startApp(makeApi());
    try {
      const { status } = await get(port, "/nope");
      assert.equal(status, 404);
    } finally {
      await close();
    }
  });
});

describe("notifications routes (LEX-28)", () => {
  it("GET /notifications renders the panel with notifications (RF-020)", async () => {
    const api = makeApi({
      listNotifications: async () => ({
        notifications: [
          {
            id: "n1",
            domainId: "watch-1",
            domain: "domainhunter.com.br",
            eventType: "DOMAIN_AVAILABLE",
            priority: "CRITICAL",
            channel: "dashboard",
            status: "SENT",
            readAt: null,
            createdAt: FIXED_NOW,
          },
        ],
      }),
    });
    const { port, close } = await startApp(api);
    try {
      const { status, body } = await get(port, "/notifications");
      assert.equal(status, 200);
      assert.match(body, /domainhunter\.com\.br/);
      assert.match(body, /Crítica/);
      assert.match(body, /notifications-table/);
    } finally {
      await close();
    }
  });

  it("GET /notifications renders the empty state", async () => {
    const { port, close } = await startApp(makeApi());
    try {
      const { status, body } = await get(port, "/notifications");
      assert.equal(status, 200);
      assert.match(body, /Nenhuma notificação/);
    } finally {
      await close();
    }
  });

  it("POST /notifications/:id/read marks read and redirects", async () => {
    let read = "";
    const api = makeApi({
      markNotificationRead: async (id) => {
        read = id;
        return notificationDto({ id, readAt: FIXED_NOW });
      },
    });
    const { port, close } = await startApp(api);
    try {
      const { status, location } = await postForm(
        port,
        "/notifications/n1/read",
      );
      assert.equal(status, 303);
      assert.equal(read, "n1");
      assert.match(location ?? "", /notice=read/);
    } finally {
      await close();
    }
  });

  it("POST /notifications/clear clears and redirects", async () => {
    let cleared = false;
    const api = makeApi({
      clearNotifications: async () => {
        cleared = true;
        return { cleared: 1 };
      },
    });
    const { port, close } = await startApp(api);
    try {
      const { status, location } = await postForm(port, "/notifications/clear");
      assert.equal(status, 303);
      assert.equal(cleared, true);
      assert.match(location ?? "", /notice=cleared/);
    } finally {
      await close();
    }
  });

  it("GET /notifications renders an error state when the API fails", async () => {
    const api = makeApi({
      listNotifications: async () => {
        throw new Error("boom");
      },
    });
    const { port, close } = await startApp(api);
    try {
      const { status, body } = await get(port, "/notifications");
      assert.equal(status, 502);
      assert.match(body, /notifications-error/);
    } finally {
      await close();
    }
  });
});

describe("settings routes (RF-021, LEX-28)", () => {
  it("GET /settings renders the form with current settings", async () => {
    const api = makeApi({
      getSettings: async () => ({
        notificationEmail: "alertas@domainhunter.local",
        expirationNoticeDays: 30,
      }),
    });
    const { port, close } = await startApp(api);
    try {
      const { status, body } = await get(port, "/settings");
      assert.equal(status, 200);
      assert.match(body, /alertas@domainhunter\.local/);
      assert.match(body, /value="30"/);
      assert.match(body, /settings-form/);
    } finally {
      await close();
    }
  });

  it("POST /settings saves and redirects", async () => {
    const saved: {
      notificationEmail?: string | null;
      expirationNoticeDays?: number;
    } = {};
    const api = makeApi({
      saveSettings: async (patch: {
        notificationEmail?: string | null;
        expirationNoticeDays?: number;
      }) => {
        saved.notificationEmail = patch.notificationEmail ?? null;
        if (patch.expirationNoticeDays !== undefined)
          saved.expirationNoticeDays = patch.expirationNoticeDays;
        return {
          notificationEmail: saved.notificationEmail,
          expirationNoticeDays: patch.expirationNoticeDays ?? 45,
        };
      },
    });
    const { port, close } = await startApp(api);
    try {
      const { status, location } = await postForm(port, "/settings", {
        notificationEmail: "alertas@domainhunter.local",
        expirationNoticeDays: "30",
      });
      assert.equal(status, 303);
      assert.equal(saved.notificationEmail, "alertas@domainhunter.local");
      assert.equal(saved.expirationNoticeDays, 30);
      assert.match(location ?? "", /notice=saved/);
    } finally {
      await close();
    }
  });

  it("POST /settings rejects an invalid antecedent", async () => {
    const { port, close } = await startApp(makeApi());
    try {
      const { status, body } = await postForm(port, "/settings", {
        notificationEmail: "",
        expirationNoticeDays: "0",
      });
      assert.equal(status, 400);
      assert.match(body, /settings-error/);
    } finally {
      await close();
    }
  });
});

describe("createWebServer", () => {
  it("starts and stops on a port", async () => {
    const api = makeApi();
    const app = createWebApp({ api, actionBase: "" });
    const server = createWebServer({ port: 0, app });
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const res = await fetch(`http://127.0.0.1:${address.port}/domains`);
    assert.equal(res.status, 200);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

describe("auth (password gate)", () => {
  async function startAuthApp(
    password: string,
  ): Promise<{ port: number; close: () => Promise<void> }> {
    const app = createWebApp({
      api: makeApi(),
      actionBase: "",
      authPassword: password,
    });
    const server = createServer(app.handle);
    server.listen(0);
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    return {
      port: address.port,
      close: () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    };
  }

  async function request(
    port: number,
    path: string,
    init: RequestInit = {},
  ): Promise<{
    status: number;
    body: string;
    location: string | null;
    setCookie: string | null;
  }> {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      redirect: "manual",
      ...init,
    });
    return {
      status: res.status,
      body: await res.text(),
      location: res.headers.get("location"),
      setCookie: res.headers.get("set-cookie"),
    };
  }

  function loginForm(
    password: string,
    extra: Record<string, string> = {},
  ): RequestInit {
    return {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password, ...extra }).toString(),
    };
  }

  it("redirects unauthenticated requests to /login", async () => {
    const { port, close } = await startAuthApp("s3cr3t");
    try {
      const { status, location } = await request(port, "/domains");
      assert.equal(status, 303);
      assert.equal(location, "/login?next=%2Fdomains");
    } finally {
      await close();
    }
  });

  it("GET /login renders the password form", async () => {
    const { port, close } = await startAuthApp("s3cr3t");
    try {
      const { status, body } = await request(port, "/login");
      assert.equal(status, 200);
      assert.match(body, /name="password"/);
      assert.match(body, /Entrar/);
      assert.match(body, /login-form/);
    } finally {
      await close();
    }
  });

  it("rejects a wrong password without setting a session", async () => {
    const { port, close } = await startAuthApp("s3cr3t");
    try {
      const { status, body, setCookie } = await request(
        port,
        "/login",
        loginForm("wrong"),
      );
      assert.equal(status, 401);
      assert.match(body, /Senha incorreta/);
      assert.match(body, /login-error/);
      assert.equal(setCookie, null);
    } finally {
      await close();
    }
  });

  it("accepts the correct password and grants access", async () => {
    const { port, close } = await startAuthApp("s3cr3t");
    try {
      const login = await request(port, "/login", loginForm("s3cr3t"));
      assert.equal(login.status, 303);
      assert.equal(login.location, "/domains");
      const cookie = login.setCookie;
      assert.ok(cookie != null);
      assert.ok(cookie.startsWith("domainhunter_session="));
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Lax/);
      const value = cookie.split(";")[0] ?? "";
      const { status, body } = await request(port, "/domains", {
        headers: { cookie: value },
      });
      assert.equal(status, 200);
      assert.match(body, /domainhunter\.com\.br/);
    } finally {
      await close();
    }
  });

  it("redirects to the requested page after login", async () => {
    const { port, close } = await startAuthApp("s3cr3t");
    try {
      const login = await request(
        port,
        "/login",
        loginForm("s3cr3t", { next: "/domains/watch-1" }),
      );
      assert.equal(login.status, 303);
      assert.equal(login.location, "/domains/watch-1");
    } finally {
      await close();
    }
  });

  it("POST /logout clears the session cookie on the client", async () => {
    const { port, close } = await startAuthApp("s3cr3t");
    try {
      const login = await request(port, "/login", loginForm("s3cr3t"));
      const cookie = (login.setCookie ?? "").split(";")[0] ?? "";
      const out = await request(port, "/logout", {
        method: "POST",
        headers: { cookie },
      });
      assert.equal(out.status, 303);
      assert.equal(out.location, "/login");
      assert.match(out.setCookie ?? "", /Max-Age=0/);
      assert.match(out.setCookie ?? "", /domainhunter_session=/);
    } finally {
      await close();
    }
  });

  it("createDefaultWebApp gates with the default password when unset", async () => {
    const previous = process.env.DOMAINHUNTER_PASSWORD;
    delete process.env.DOMAINHUNTER_PASSWORD;
    try {
      const app = createDefaultWebApp({ api: makeApi() });
      const server = createServer(app.handle);
      server.listen(0);
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const res = await fetch(`http://127.0.0.1:${address.port}/domains`, {
        redirect: "manual",
      });
      assert.equal(res.status, 303);
      assert.equal(res.headers.get("location"), "/login?next=%2Fdomains");
      await new Promise<void>((resolve) => server.close(() => resolve()));
    } finally {
      if (previous != null) process.env.DOMAINHUNTER_PASSWORD = previous;
      else delete process.env.DOMAINHUNTER_PASSWORD;
    }
  });
});
