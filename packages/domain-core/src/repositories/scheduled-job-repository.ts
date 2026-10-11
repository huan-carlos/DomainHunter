import type { DatabaseSync } from "node:sqlite";
import { uuidv7 } from "../uuid.ts";
import { now } from "../db/helpers.ts";
import type { ScheduledJob, ScheduledJobKind, ScheduledJobStatus } from "../entities/scheduled-job.ts";

export type ScheduledJobCreate = Omit<
  ScheduledJob,
  | "id"
  | "createdAt"
  | "status"
  | "attempts"
  | "maxAttempts"
  | "nextRetryAt"
  | "lastError"
  | "lockedBy"
  | "lockedAt"
  | "finishedAt"
> & {
  status?: ScheduledJobStatus;
  maxAttempts?: number;
  nextRetryAt?: string | null;
  lastError?: string | null;
};

export interface ScheduledJobRepository {
  create(input: ScheduledJobCreate): ScheduledJob;
  findById(id: string): ScheduledJob | null;
  findDue(before: string, limit?: number): ScheduledJob[];
  claimNext(before: string, workerId: string): ScheduledJob | null;
  update(id: string, patch: Partial<ScheduledJob>): ScheduledJob | null;
  delete(id: string): boolean;
}

function fromRow(row: Record<string, unknown>): ScheduledJob {
  return {
    id: String(row.id),
    domainWatchId: String(row.domain_watch_id),
    kind: String(row.kind) as ScheduledJobKind,
    runAt: String(row.run_at),
    status: String(row.status) as ScheduledJobStatus,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    nextRetryAt: row.next_retry_at == null ? null : String(row.next_retry_at),
    lastError: row.last_error == null ? null : String(row.last_error),
    lockedBy: row.locked_by == null ? null : String(row.locked_by),
    lockedAt: row.locked_at == null ? null : String(row.locked_at),
    finishedAt: row.finished_at == null ? null : String(row.finished_at),
    createdAt: String(row.created_at),
  };
}

export class SqliteScheduledJobRepository implements ScheduledJobRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  create(input: ScheduledJobCreate): ScheduledJob {
    const job: ScheduledJob = {
      id: uuidv7(),
      domainWatchId: input.domainWatchId,
      kind: input.kind,
      runAt: input.runAt,
      status: input.status ?? "PENDING",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      nextRetryAt: input.nextRetryAt ?? null,
      lastError: null,
      lockedBy: null,
      lockedAt: null,
      finishedAt: null,
      createdAt: now(),
    };
    this.db
      .prepare(
        `INSERT INTO scheduled_jobs
           (id, domain_watch_id, kind, run_at, status, attempts, max_attempts, next_retry_at,
            last_error, locked_by, locked_at, finished_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        job.id,
        job.domainWatchId,
        job.kind,
        job.runAt,
        job.status,
        job.attempts,
        job.maxAttempts,
        job.nextRetryAt,
        job.lastError,
        job.lockedBy,
        job.lockedAt,
        job.finishedAt,
        job.createdAt
      );
    return job;
  }

  findById(id: string): ScheduledJob | null {
    const row = this.db
      .prepare("SELECT * FROM scheduled_jobs WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? fromRow(row) : null;
  }

  findDue(before: string, limit = 100): ScheduledJob[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM scheduled_jobs
         WHERE status = 'PENDING' AND run_at <= ?
         ORDER BY run_at ASC LIMIT ?`
      )
      .all(before, limit) as Record<string, unknown>[];
    return rows.map(fromRow);
  }

  claimNext(before: string, workerId: string): ScheduledJob | null {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          `SELECT * FROM scheduled_jobs
           WHERE status = 'PENDING' AND run_at <= ?
           ORDER BY run_at ASC LIMIT 1`
        )
        .get(before) as Record<string, unknown> | undefined;
      if (!row) {
        this.db.exec("COMMIT");
        return null;
      }
      const id = String(row.id);
      const ts = now();
      this.db
        .prepare(
          `UPDATE scheduled_jobs
           SET status = 'RUNNING', attempts = attempts + 1, locked_by = ?, locked_at = ?
           WHERE id = ? AND status = 'PENDING'`
        )
        .run(workerId, ts, id);
      this.db.exec("COMMIT");
      return this.findById(id);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  update(id: string, patch: Partial<ScheduledJob>): ScheduledJob | null {
    const existing = this.findById(id);
    if (!existing) return null;
    const updated: ScheduledJob = { ...existing, ...patch };
    this.db
      .prepare(
        `UPDATE scheduled_jobs SET
           domain_watch_id = ?, kind = ?, run_at = ?, status = ?, attempts = ?, max_attempts = ?,
           next_retry_at = ?, last_error = ?, locked_by = ?, locked_at = ?, finished_at = ?
         WHERE id = ?`
      )
      .run(
        updated.domainWatchId,
        updated.kind,
        updated.runAt,
        updated.status,
        updated.attempts,
        updated.maxAttempts,
        updated.nextRetryAt,
        updated.lastError,
        updated.lockedBy,
        updated.lockedAt,
        updated.finishedAt,
        id
      );
    return updated;
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM scheduled_jobs WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
