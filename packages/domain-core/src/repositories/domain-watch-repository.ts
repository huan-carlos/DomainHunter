import type { DatabaseSync } from "node:sqlite";
import { uuidv7 } from "../uuid.ts";
import { now, toJson, fromJson } from "../db/helpers.ts";
import type { DomainWatch, DomainWatchStatus, MonitoringPhase, MonitoringState, WatchPriority } from "../entities/domain-watch.ts";

export type DomainWatchCreate = Omit<
  DomainWatch,
  | "id"
  | "createdAt"
  | "deletedAt"
  | "rawLastStatus"
  | "monitoringState"
  | "phase"
  | "checkFailureCount"
  | "lastCheckAt"
  | "expirationAt"
  | "lastKnownOwner"
  | "lastKnownOwnerId"
  | "releaseProcessId"
  | "releaseStartAt"
  | "releaseEndAt"
  | "lastWhoisCheckAt"
  | "lastRdapCheckAt"
  | "lastIsavailCheckAt"
  | "lastSuccessfulCheckAt"
  | "availableSince"
  | "clientVersions"
> & {
  monitoringState?: MonitoringState;
  phase?: MonitoringPhase;
  checkFailureCount?: number;
  rawLastStatus?: string | null;
  lastCheckAt?: string | null;
  expirationAt?: string | null;
  lastKnownOwner?: string | null;
  lastKnownOwnerId?: string | null;
  releaseProcessId?: string | null;
  releaseStartAt?: string | null;
  releaseEndAt?: string | null;
  lastWhoisCheckAt?: string | null;
  lastRdapCheckAt?: string | null;
  lastIsavailCheckAt?: string | null;
  lastSuccessfulCheckAt?: string | null;
  availableSince?: string | null;
  clientVersions?: Record<string, string> | null;
};

export interface DomainWatchRepository {
  create(input: DomainWatchCreate): DomainWatch;
  findById(id: string): DomainWatch | null;
  findByDomain(domain: string): DomainWatch | null;
  findAll(): DomainWatch[];
  findActiveDue(nextCheckAt: string): DomainWatch[];
  update(id: string, patch: Partial<DomainWatch>): DomainWatch | null;
  delete(id: string): boolean;
}

function fromRow(row: Record<string, unknown>): DomainWatch {
  return {
    id: String(row.id),
    domain: String(row.domain),
    userId: row.user_id == null ? null : String(row.user_id),
    status: String(row.status) as DomainWatchStatus,
    rawLastStatus: row.raw_last_status == null ? null : String(row.raw_last_status),
    priority: String(row.priority) as WatchPriority,
    monitoringState: String(row.monitoring_state) as MonitoringState,
    createdAt: String(row.created_at),
    lastCheckAt: row.last_check_at == null ? null : String(row.last_check_at),
    nextCheckAt: String(row.next_check_at),
    expirationAt: row.expiration_at == null ? null : String(row.expiration_at),
    lastKnownOwner: row.last_known_owner == null ? null : String(row.last_known_owner),
    lastKnownOwnerId: row.last_known_owner_id == null ? null : String(row.last_known_owner_id),
    releaseProcessId: row.release_process_id == null ? null : String(row.release_process_id),
    releaseStartAt: row.release_start_at == null ? null : String(row.release_start_at),
    releaseEndAt: row.release_end_at == null ? null : String(row.release_end_at),
    lastWhoisCheckAt: row.last_whois_check_at == null ? null : String(row.last_whois_check_at),
    lastRdapCheckAt: row.last_rdap_check_at == null ? null : String(row.last_rdap_check_at),
    lastIsavailCheckAt: row.last_isavail_check_at == null ? null : String(row.last_isavail_check_at),
    lastSuccessfulCheckAt: row.last_successful_check_at == null ? null : String(row.last_successful_check_at),
    availableSince: row.available_since == null ? null : String(row.available_since),
    checkFailureCount: Number(row.check_failure_count),
    phase: String(row.phase) as MonitoringPhase,
    clientVersions: fromJson<Record<string, string>>(row.client_versions == null ? null : String(row.client_versions)),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
  };
}

export class SqliteDomainWatchRepository implements DomainWatchRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  create(input: DomainWatchCreate): DomainWatch {
    const id = uuidv7();
    const ts = now();
    const watch: DomainWatch = {
      id,
      domain: input.domain,
      userId: input.userId,
      status: input.status,
      rawLastStatus: input.rawLastStatus ?? null,
      priority: input.priority,
      monitoringState: input.monitoringState ?? "ACTIVE",
      createdAt: ts,
      lastCheckAt: input.lastCheckAt ?? null,
      nextCheckAt: input.nextCheckAt,
      expirationAt: input.expirationAt ?? null,
      lastKnownOwner: input.lastKnownOwner ?? null,
      lastKnownOwnerId: input.lastKnownOwnerId ?? null,
      releaseProcessId: input.releaseProcessId ?? null,
      releaseStartAt: input.releaseStartAt ?? null,
      releaseEndAt: input.releaseEndAt ?? null,
      lastWhoisCheckAt: input.lastWhoisCheckAt ?? null,
      lastRdapCheckAt: input.lastRdapCheckAt ?? null,
      lastIsavailCheckAt: input.lastIsavailCheckAt ?? null,
      lastSuccessfulCheckAt: input.lastSuccessfulCheckAt ?? null,
      availableSince: input.availableSince ?? null,
      checkFailureCount: input.checkFailureCount ?? 0,
      phase: input.phase ?? "A",
      clientVersions: input.clientVersions ?? null,
      deletedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO domain_watches
           (id, domain, user_id, status, raw_last_status, priority, monitoring_state, created_at,
            last_check_at, next_check_at, expiration_at, last_known_owner, last_known_owner_id,
            release_process_id, release_start_at, release_end_at, last_whois_check_at, last_rdap_check_at,
            last_isavail_check_at, last_successful_check_at, available_since, check_failure_count,
            phase, client_versions, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        watch.id,
        watch.domain,
        watch.userId,
        watch.status,
        watch.rawLastStatus,
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
        watch.clientVersions == null ? null : toJson(watch.clientVersions),
        watch.deletedAt
      );
    return watch;
  }

  findById(id: string): DomainWatch | null {
    const row = this.db
      .prepare("SELECT * FROM domain_watches WHERE id = ? AND deleted_at IS NULL")
      .get(id) as Record<string, unknown> | undefined;
    return row ? fromRow(row) : null;
  }

  findByDomain(domain: string): DomainWatch | null {
    const row = this.db
      .prepare("SELECT * FROM domain_watches WHERE domain = ? AND deleted_at IS NULL")
      .get(domain) as Record<string, unknown> | undefined;
    return row ? fromRow(row) : null;
  }

  findAll(): DomainWatch[] {
    const rows = this.db
      .prepare("SELECT * FROM domain_watches WHERE deleted_at IS NULL ORDER BY created_at DESC")
      .all() as Record<string, unknown>[];
    return rows.map(fromRow);
  }

  findActiveDue(nextCheckAt: string): DomainWatch[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM domain_watches
         WHERE deleted_at IS NULL AND monitoring_state = 'ACTIVE' AND next_check_at <= ?
         ORDER BY next_check_at ASC`
      )
      .all(nextCheckAt) as Record<string, unknown>[];
    return rows.map(fromRow);
  }

  update(id: string, patch: Partial<DomainWatch>): DomainWatch | null {
    const existing = this.findById(id);
    if (!existing) return null;
    const updated: DomainWatch = { ...existing, ...patch };
    this.db
      .prepare(
        `UPDATE domain_watches SET
           domain = ?, user_id = ?, status = ?, raw_last_status = ?, priority = ?, monitoring_state = ?,
           last_check_at = ?, next_check_at = ?, expiration_at = ?, last_known_owner = ?, last_known_owner_id = ?,
           release_process_id = ?, release_start_at = ?, release_end_at = ?, last_whois_check_at = ?,
           last_rdap_check_at = ?, last_isavail_check_at = ?, last_successful_check_at = ?, available_since = ?,
           check_failure_count = ?, phase = ?, client_versions = ?, deleted_at = ?
         WHERE id = ?`
      )
      .run(
        updated.domain,
        updated.userId,
        updated.status,
        updated.rawLastStatus,
        updated.priority,
        updated.monitoringState,
        updated.lastCheckAt,
        updated.nextCheckAt,
        updated.expirationAt,
        updated.lastKnownOwner,
        updated.lastKnownOwnerId,
        updated.releaseProcessId,
        updated.releaseStartAt,
        updated.releaseEndAt,
        updated.lastWhoisCheckAt,
        updated.lastRdapCheckAt,
        updated.lastIsavailCheckAt,
        updated.lastSuccessfulCheckAt,
        updated.availableSince,
        updated.checkFailureCount,
        updated.phase,
        updated.clientVersions == null ? null : toJson(updated.clientVersions),
        updated.deletedAt,
        id
      );
    return updated;
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare("UPDATE domain_watches SET deleted_at = ?, monitoring_state = 'STOPPED' WHERE id = ?")
      .run(now(), id);
    return result.changes > 0;
  }
}
