/**
 * DomainHunter HTTP API (LEX-20/LEX-26, technical plan §10).
 *
 * Routes:
 *   POST /domains            — register a `.br` domain, run the initial
 *                              check and return the initial diagnostic
 *                              (AC01/AC02/AC03)
 *   GET  /domains            — list watched domains
 *   GET  /domains/:id        — detail (state, dates, monitoring)
 *   GET  /domains/:id/timeline — audit event timeline (RF-017, AC10)
 *   POST /domains/:id/check  — manual immediate check (enqueue job, RF-027)
 *   PATCH /domains/:id       — pause/resume monitoring (RF-022)
 *   DELETE /domains/:id      — stop/remove monitoring (RF-023)
 *   GET  /health             — healthcheck
 *
 * Responses are JSON; dates are ISO-8601 UTC (RNF-018). The app is built on
 * Node built-ins and is dependency-free beyond the DomainHunter packages.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type DomainEvent,
  type DomainEventRepository,
  type DomainWatch,
  type DomainWatchRepository,
  type MonitoringState,
  type Notification,
  type NotificationRepository,
  type NotificationSettingsRepository,
  type PhaseFrequency,
  type ScheduledJobRepository,
} from "@domainhunter/domain-core";
import type { MonitoringPhase } from "@domainhunter/domain-core";
import type { IsavailProvider, RdapProvider, WhoisProvider } from "@domainhunter/providers";
import { BrDomainError, registerDomain } from "../application/registration.ts";

export interface DomainAppDeps {
  watches: DomainWatchRepository;
  events: DomainEventRepository;
  jobs: ScheduledJobRepository;
  /** Dashboard notification repository (LEX-27, RF-020). */
  notifications?: NotificationRepository;
  /** Notification settings (RF-021): alert email + expiration lead time. */
  settings?: NotificationSettingsRepository;
  providers: {
    whois: WhoisProvider;
    rdap: RdapProvider;
    isavail: IsavailProvider;
  };
  /** Clock for timestamps (defaults to now, ISO-8601 UTC). */
  clock?: () => string;
  /** Phase→frequency overrides (RNF-021). */
  frequencies?: Partial<Record<MonitoringPhase, PhaseFrequency>>;
  /** Pre-expiration window for phase B derivation (defaults to 45 days). */
  approachingWindowMs?: number;
}

export interface DomainApp {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

const MAX_BODY_BYTES = 1024 * 1024;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "connection": "close",
  });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("request body too large");
      Object.assign(error, { code: "BODY_TOO_LARGE" });
      throw error;
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("invalid JSON body");
    Object.assign(error, { code: "INVALID_JSON" });
    throw error;
  }
}

/** Flat JSON representation of a watch for API responses. */
function serializeWatch(watch: DomainWatch): Record<string, unknown> {
  return {
    id: watch.id,
    domain: watch.domain,
    status: watch.status,
    rawLastStatus: watch.rawLastStatus,
    priority: watch.priority,
    monitoringState: watch.monitoringState,
    phase: watch.phase,
    createdAt: watch.createdAt,
    lastCheckAt: watch.lastCheckAt,
    nextCheckAt: watch.nextCheckAt,
    expirationAt: watch.expirationAt,
    lastKnownOwner: watch.lastKnownOwner,
    lastKnownOwnerId: watch.lastKnownOwnerId,
    releaseStartAt: watch.releaseStartAt,
    releaseEndAt: watch.releaseEndAt,
    lastWhoisCheckAt: watch.lastWhoisCheckAt,
    lastRdapCheckAt: watch.lastRdapCheckAt,
    lastIsavailCheckAt: watch.lastIsavailCheckAt,
    lastSuccessfulCheckAt: watch.lastSuccessfulCheckAt,
    availableSince: watch.availableSince,
    checkFailureCount: watch.checkFailureCount,
    clientVersions: watch.clientVersions,
  };
}

function serializeEvent(event: DomainEvent): Record<string, unknown> {
  return {
    id: event.id,
    type: event.type,
    source: event.source,
    sourceVersion: event.sourceVersion,
    occurredAt: event.occurredAt,
    previousValue: event.previousValue,
    newValue: event.newValue,
    evidence: parseEvidence(event.evidenceJson),
    priority: event.priority,
  };
}

function parseEvidence(evidenceJson: string): unknown {
  try {
    return JSON.parse(evidenceJson);
  } catch {
    return evidenceJson;
  }
}

/** Flat JSON representation of a dashboard notification (RF-020). */
function serializeNotification(notification: Notification): Record<string, unknown> {
  return {
    id: notification.id,
    channel: notification.channel,
    priority: notification.priority,
    status: notification.status,
    attempts: notification.attempts,
    sentAt: notification.sentAt,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  };
}

/**
 * Dashboard notification enriched with the watched domain and the event type
 * (RF-020): the dashboard panel shows priority, type, domain and timestamp.
 */
function serializeDashboardNotification(
  notification: Notification,
  watch: DomainWatch | undefined,
  event: DomainEvent | undefined,
): Record<string, unknown> {
  return {
    id: notification.id,
    domainId: notification.domainWatchId,
    domain: watch?.domain ?? null,
    eventType: event?.type ?? null,
    priority: notification.priority,
    channel: notification.channel,
    status: notification.status,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  };
}

export function createDomainApp(deps: DomainAppDeps): DomainApp {
  /** Dashboard notifications across all watched domains, newest first (RF-020). */
  function handleGetDashboardNotifications(_req: IncomingMessage, res: ServerResponse): void {
    if (!deps.notifications) {
      sendJson(res, 200, { notifications: [] });
      return;
    }
    const notifications = deps.notifications.findByChannel("dashboard", 100);
    const items = notifications.map((notification) => {
      const watch = deps.watches.findById(notification.domainWatchId);
      const event = deps.events.findById(notification.domainEventId);
      return serializeDashboardNotification(notification, watch ?? undefined, event ?? undefined);
    });
    sendJson(res, 200, { notifications: items });
  }

  /** Mark a dashboard notification as read (RF-020). */
  function handlePostNotificationRead(id: string, _req: IncomingMessage, res: ServerResponse): void {
    if (!deps.notifications) {
      sendJson(res, 404, { error: "not_found", id });
      return;
    }
    const notification = deps.notifications.findById(id);
    if (!notification) {
      sendJson(res, 404, { error: "not_found", id });
      return;
    }
    const readAt = deps.clock?.() ?? new Date().toISOString();
    deps.notifications.markRead(id, readAt);
    sendJson(res, 200, serializeNotification(deps.notifications.findById(id) ?? notification));
  }

  /** Clear (delete) all dashboard notifications (RF-020). */
  function handlePostNotificationsClear(_req: IncomingMessage, res: ServerResponse): void {
    if (!deps.notifications) {
      sendJson(res, 200, { cleared: 0 });
      return;
    }
    let cleared = 0;
    for (const notification of deps.notifications.findByChannel("dashboard", 1000)) {
      if (deps.notifications.delete(notification.id)) cleared += 1;
    }
    sendJson(res, 200, { cleared });
  }

  /** Read notification settings (RF-021): alert email + expiration lead time. */
  function handleGetSettings(_req: IncomingMessage, res: ServerResponse): void {
    if (!deps.settings) {
      sendJson(res, 200, { notificationEmail: null, expirationNoticeDays: 45 });
      return;
    }
    const settings = deps.settings.get();
    sendJson(res, 200, {
      notificationEmail: settings.notificationEmail,
      expirationNoticeDays: settings.expirationNoticeDays,
    });
  }

  /** Update notification settings (RF-021). */
  async function handlePutSettings(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!deps.settings) {
      sendJson(res, 501, { error: "settings_unavailable" });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "BODY_TOO_LARGE") {
        sendJson(res, 413, { error: "body_too_large" });
        return;
      }
      sendJson(res, 400, { error: "invalid_json" });
      return;
    }
    const notificationEmail = (body as { notificationEmail?: unknown } | undefined)?.notificationEmail;
    const expirationNoticeDays = (body as { expirationNoticeDays?: unknown } | undefined)?.expirationNoticeDays;

    if (notificationEmail !== undefined && notificationEmail !== null && typeof notificationEmail !== "string") {
      sendJson(res, 400, { error: "invalid_email", message: "notificationEmail must be a string or null" });
      return;
    }
    if (
      expirationNoticeDays !== undefined &&
      (typeof expirationNoticeDays !== "number" ||
        !Number.isInteger(expirationNoticeDays) ||
        expirationNoticeDays < 1 ||
        expirationNoticeDays > 365)
    ) {
      sendJson(res, 400, {
        error: "invalid_expiration_notice_days",
        message: "expirationNoticeDays must be an integer between 1 and 365",
      });
      return;
    }

    const patch: { notificationEmail?: string | null; expirationNoticeDays?: number } = {};
    if (notificationEmail !== undefined) {
      patch.notificationEmail = notificationEmail === "" ? null : (notificationEmail as string).trim();
    }
    if (expirationNoticeDays !== undefined) {
      patch.expirationNoticeDays = expirationNoticeDays as number;
    }
    const settings = deps.settings.update(patch);
    sendJson(res, 200, {
      notificationEmail: settings.notificationEmail,
      expirationNoticeDays: settings.expirationNoticeDays,
    });
  }

  async function handlePostDomains(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "BODY_TOO_LARGE") {
        sendJson(res, 413, { error: "body_too_large" });
        return;
      }
      sendJson(res, 400, { error: "invalid_json" });
      return;
    }

    const domain = (body as { domain?: unknown } | undefined)?.domain;
    if (typeof domain !== "string" || domain.trim().length === 0) {
      sendJson(res, 400, { error: "invalid_domain", message: "domain is required" });
      return;
    }

    let result;
    try {
      result = await registerDomain(domain, {
        watches: deps.watches,
        events: deps.events,
        jobs: deps.jobs,
        providers: deps.providers,
        ...(deps.clock != null ? { clock: deps.clock } : {}),
        ...(deps.frequencies != null ? { frequencies: deps.frequencies } : {}),
        ...(deps.approachingWindowMs != null
          ? { approachingWindowMs: deps.approachingWindowMs }
          : {}),
      });
    } catch (error) {
      if (error instanceof BrDomainError) {
        sendJson(res, 400, {
          error: "invalid_domain",
          code: error.code,
          message: error.message,
          domain: error.input,
        });
        return;
      }
      throw error;
    }

    if (result.kind === "already_watching") {
      sendJson(res, 409, {
        error: "domain_already_watched",
        domain: result.watch.domain,
        watch: serializeWatch(result.watch),
      });
      return;
    }

    sendJson(res, 201, {
      ...serializeWatch(result.watch),
      initialCheck: result.diagnostic,
    });
  }

  function handleGetDomains(_req: IncomingMessage, res: ServerResponse): void {
    sendJson(res, 200, { domains: deps.watches.findAll().map(serializeWatch) });
  }

  function handleGetDomain(id: string, _req: IncomingMessage, res: ServerResponse): void {
    const watch = deps.watches.findById(id);
    if (!watch) {
      sendJson(res, 404, { error: "not_found", id });
      return;
    }
    sendJson(res, 200, serializeWatch(watch));
  }

  function handleGetTimeline(id: string, _req: IncomingMessage, res: ServerResponse): void {
    const watch = deps.watches.findById(id);
    if (!watch) {
      sendJson(res, 404, { error: "not_found", id });
      return;
    }
    sendJson(res, 200, {
      domainId: id,
      events: deps.events.findByDomainWatchId(id).map(serializeEvent),
    });
  }

  /** Dashboard notifications for a domain (RF-020, LEX-27). */
  function handleGetNotifications(id: string, _req: IncomingMessage, res: ServerResponse): void {
    const watch = deps.watches.findById(id);
    if (!watch) {
      sendJson(res, 404, { error: "not_found", id });
      return;
    }
    const notifications = deps.notifications?.findByDomainWatchId(id) ?? [];
    sendJson(res, 200, {
      domainId: id,
      notifications: notifications.map(serializeNotification),
    });
  }

  /**
   * Manual immediate check (RF-027). Enqueues an INITIAL job on the
   * persistent queue so the automations worker runs the same WHOIS/RDAP +
   * ISAVAIL cadastral check as the initial diagnostic, without blocking the
   * HTTP response. Idempotent: re-running enqueues another check.
   */
  function handlePostDomainCheck(id: string, _req: IncomingMessage, res: ServerResponse): void {
    const watch = deps.watches.findById(id);
    if (!watch) {
      sendJson(res, 404, { error: "not_found", id });
      return;
    }
    const now = deps.clock?.() ?? new Date().toISOString();
    const job = deps.jobs.create({
      domainWatchId: id,
      kind: "INITIAL",
      runAt: now,
    });
    sendJson(res, 202, {
      status: "queued",
      job: { id: job.id, kind: job.kind, runAt: job.runAt },
      watch: serializeWatch(watch),
    });
  }

  /** Pause or resume monitoring (RF-022). */
  async function handlePatchDomain(id: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const watch = deps.watches.findById(id);
    if (!watch) {
      sendJson(res, 404, { error: "not_found", id });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "BODY_TOO_LARGE") {
        sendJson(res, 413, { error: "body_too_large" });
        return;
      }
      sendJson(res, 400, { error: "invalid_json" });
      return;
    }
    const monitoringState = (body as { monitoringState?: unknown } | undefined)?.monitoringState;
    if (monitoringState !== "PAUSED" && monitoringState !== "ACTIVE") {
      sendJson(res, 400, {
        error: "invalid_monitoring_state",
        message: "monitoringState must be PAUSED or ACTIVE",
      });
      return;
    }
    const updated = deps.watches.update(id, {
      monitoringState: monitoringState as MonitoringState,
    });
    if (!updated) {
      sendJson(res, 404, { error: "not_found", id });
      return;
    }
    sendJson(res, 200, serializeWatch(updated));
  }

  /** Stop and remove monitoring (RF-023). Soft delete per repository. */
  function handleDeleteDomain(id: string, _req: IncomingMessage, res: ServerResponse): void {
    const watch = deps.watches.findById(id);
    if (!watch) {
      sendJson(res, 404, { error: "not_found", id });
      return;
    }
    deps.watches.delete(id);
    res.writeHead(204, { "connection": "close" });
    res.end();
  }

  function handleHealth(_req: IncomingMessage, res: ServerResponse): void {
    sendJson(res, 200, { status: "ok", service: "domainhunter-server" });
  }

  return {
    async handle(req, res): Promise<void> {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const path = url.pathname.replace(/\/+$/, "") || "/";
        const method = req.method ?? "GET";

        if (method === "GET" && path === "/health") {
          handleHealth(req, res);
          return;
        }

        if (method === "POST" && path === "/domains") {
          await handlePostDomains(req, res);
          return;
        }

        if (method === "GET" && path === "/domains") {
          handleGetDomains(req, res);
          return;
        }

        const domainsMatch = path.match(/^\/domains\/([^/]+)$/);
        if (domainsMatch) {
          const id = decodeURIComponent(domainsMatch[1] ?? "");
          if (method === "GET") {
            handleGetDomain(id, req, res);
            return;
          }
          if (method === "PATCH") {
            await handlePatchDomain(id, req, res);
            return;
          }
          if (method === "DELETE") {
            handleDeleteDomain(id, req, res);
            return;
          }
        }

        const checkMatch = path.match(/^\/domains\/([^/]+)\/check$/);
        if (method === "POST" && checkMatch) {
          handlePostDomainCheck(decodeURIComponent(checkMatch[1] ?? ""), req, res);
          return;
        }

        const timelineMatch = path.match(/^\/domains\/([^/]+)\/timeline$/);
        if (method === "GET" && timelineMatch) {
          handleGetTimeline(decodeURIComponent(timelineMatch[1] ?? ""), req, res);
          return;
        }

        const notificationsMatch = path.match(/^\/domains\/([^/]+)\/notifications$/);
        if (method === "GET" && notificationsMatch) {
          handleGetNotifications(decodeURIComponent(notificationsMatch[1] ?? ""), req, res);
          return;
        }

        if (method === "GET" && path === "/notifications") {
          handleGetDashboardNotifications(req, res);
          return;
        }

        const notificationReadMatch = path.match(/^\/notifications\/([^/]+)\/read$/);
        if (method === "POST" && notificationReadMatch) {
          handlePostNotificationRead(decodeURIComponent(notificationReadMatch[1] ?? ""), req, res);
          return;
        }

        if (method === "POST" && path === "/notifications/clear") {
          handlePostNotificationsClear(req, res);
          return;
        }

        if (method === "GET" && path === "/settings") {
          handleGetSettings(req, res);
          return;
        }

        if (method === "PUT" && path === "/settings") {
          await handlePutSettings(req, res);
          return;
        }

        sendJson(res, 404, { error: "not_found", path });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 500, { error: "internal_error", message });
      }
    },
  };
}
