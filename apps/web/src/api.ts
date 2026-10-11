/**
 * DomainHunter web API client (LEX-26, technical plan §10/§11).
 *
 * Talks to the `apps/server` HTTP API over `fetch`. The base URL comes from
 * `DOMAINHUNTER_API_URL` (default `http://127.0.0.1:3000`). The client is a
 * thin typed wrapper: response DTOs mirror `serializeWatch`/`serializeEvent`
 * in `apps/server/src/http/app.ts`.
 */
import {
  type DomainEventSource,
  type DomainEventType,
  type DomainWatchStatus,
  type MonitoringPhase,
  type MonitoringState,
  type WatchPriority,
} from "@domainhunter/domain-core";

/** Wire shape of a watch, as returned by the API (`serializeWatch`). */
export interface DomainWatchDto {
  id: string;
  domain: string;
  status: DomainWatchStatus;
  rawLastStatus: string | null;
  priority: WatchPriority;
  monitoringState: MonitoringState;
  phase: MonitoringPhase;
  createdAt: string;
  lastCheckAt: string | null;
  nextCheckAt: string;
  expirationAt: string | null;
  lastKnownOwner: string | null;
  lastKnownOwnerId: string | null;
  releaseStartAt: string | null;
  releaseEndAt: string | null;
  lastWhoisCheckAt: string | null;
  lastRdapCheckAt: string | null;
  lastIsavailCheckAt: string | null;
  lastSuccessfulCheckAt: string | null;
  availableSince: string | null;
  checkFailureCount: number;
  clientVersions: Record<string, string> | null;
}

/** Wire shape of an audit event, as returned by the API. */
export interface DomainEventDto {
  id: string;
  type: DomainEventType;
  source: DomainEventSource;
  sourceVersion: string;
  occurredAt: string;
  previousValue: string | null;
  newValue: string | null;
  evidence: unknown;
  priority: string | null;
}

export interface TimelineDto {
  domainId: string;
  events: DomainEventDto[];
}

/** Wire shape of a dashboard notification (RF-020, `serializeDashboardNotification`). */
export interface NotificationDto {
  id: string;
  domainId: string;
  domain: string | null;
  eventType: string | null;
  priority: string;
  channel: string;
  status: string;
  readAt: string | null;
  createdAt: string;
}

/** Wire shape of notification settings (RF-021). */
export interface NotificationSettingsDto {
  notificationEmail: string | null;
  expirationNoticeDays: number;
}

/** Source-level outcome of the initial check (LEX-20 diagnostic). */
export interface InitialCheckDto {
  succeeded: boolean;
  sources: Record<"whois" | "rdap" | "isavail", "ok" | "error" | "skipped">;
}

/** Result of a successful `POST /domains` (AC01/AC02/AC03). */
export interface RegisterDomainResult {
  watch: DomainWatchDto;
  initialCheck: InitialCheckDto;
}

export type RegisterDomainOutcome =
  | { kind: "created"; result: RegisterDomainResult }
  | { kind: "already_watched"; domain: string; watch: DomainWatchDto };

export interface DomainApiClient {
  listDomains(): Promise<{ domains: DomainWatchDto[] }>;
  getDomain(id: string): Promise<DomainWatchDto>;
  getTimeline(id: string): Promise<DomainEventDto[]>;
  registerDomain(domain: string): Promise<RegisterDomainOutcome>;
  requestCheck(id: string): Promise<void>;
  setMonitoringState(id: string, state: "ACTIVE" | "PAUSED"): Promise<void>;
  deleteDomain(id: string): Promise<void>;
  listNotifications(): Promise<{ notifications: NotificationDto[] }>;
  markNotificationRead(id: string): Promise<NotificationDto>;
  clearNotifications(): Promise<{ cleared: number }>;
  getSettings(): Promise<NotificationSettingsDto>;
  saveSettings(patch: { notificationEmail?: string | null; expirationNoticeDays?: number }): Promise<NotificationSettingsDto>;
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Injectable for tests (defaults to global fetch). */
  fetchImpl?: typeof fetch;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

async function readJson(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createApiClient(options: ApiClientOptions): DomainApiClient {
  const base = normalizeBaseUrl(options.baseUrl);
  const doFetch = options.fetchImpl ?? fetch;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
        ...init,
      });
    } catch (error) {
      throw new ApiError(0, error instanceof Error ? error.message : "network error", "network_error");
    }
    const body = await readJson(res);
    if (!res.ok) {
      const message =
        body != null && typeof body === "object" && "message" in body && typeof body.message === "string"
          ? body.message
          : `request failed with status ${res.status}`;
      const code =
        body != null && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error
          : null;
      throw new ApiError(res.status, message, code);
    }
    return body as T;
  }

  return {
    async listDomains() {
      return request<{ domains: DomainWatchDto[] }>(`/domains`);
    },
    async getDomain(id: string) {
      return request<DomainWatchDto>(`/domains/${encodeURIComponent(id)}`);
    },
    async getTimeline(id: string) {
      const dto = await request<TimelineDto>(`/domains/${encodeURIComponent(id)}/timeline`);
      return dto.events;
    },
    async registerDomain(domain: string): Promise<RegisterDomainOutcome> {
      let res: Response;
      try {
        res = await doFetch(`${base}/domains`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ domain }),
        });
      } catch (error) {
        throw new ApiError(0, error instanceof Error ? error.message : "network error", "network_error");
      }
      const body = await readJson(res);
      if (res.status === 409) {
        const domainName =
          body != null && typeof body === "object" && "domain" in body && typeof body.domain === "string"
            ? body.domain
            : domain;
        const watch = (body as { watch?: DomainWatchDto }).watch ?? null;
        if (watch != null) return { kind: "already_watched", domain: domainName, watch };
        const error = new ApiError(res.status, "Domínio já está sendo monitorado.", "domain_already_watched");
        throw error;
      }
      if (!res.ok) {
        const message =
          body != null && typeof body === "object" && "message" in body && typeof body.message === "string"
            ? body.message
            : `request failed with status ${res.status}`;
        const code =
          body != null && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : null;
        throw new ApiError(res.status, message, code);
      }
      const payload = body as DomainWatchDto & { initialCheck?: InitialCheckDto };
      if (payload.initialCheck == null) {
        // Should not happen for a 201; treat as created without diagnostics.
        return { kind: "created" as const, result: { watch: payload, initialCheck: { succeeded: true, sources: { whois: "ok", rdap: "ok", isavail: "ok" } } } };
      }
      const { initialCheck, ...watch } = payload;
      return { kind: "created" as const, result: { watch, initialCheck } };
    },
    async requestCheck(id: string) {
      await request<{ status: string }>(`/domains/${encodeURIComponent(id)}/check`, { method: "POST" });
    },
    async setMonitoringState(id: string, state: "ACTIVE" | "PAUSED") {
      await request<DomainWatchDto>(`/domains/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ monitoringState: state }),
      });
    },
    async deleteDomain(id: string) {
      await request<null>(`/domains/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    async listNotifications() {
      return request<{ notifications: NotificationDto[] }>(`/notifications`);
    },
    async markNotificationRead(id: string) {
      return request<NotificationDto>(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
    },
    async clearNotifications() {
      return request<{ cleared: number }>(`/notifications/clear`, { method: "POST" });
    },
    async getSettings() {
      return request<NotificationSettingsDto>(`/settings`);
    },
    async saveSettings(patch) {
      return request<NotificationSettingsDto>(`/settings`, {
        method: "PUT",
        body: JSON.stringify(patch),
      });
    },
  };
}
