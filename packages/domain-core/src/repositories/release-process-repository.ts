import type { DatabaseSync } from "node:sqlite";
import { uuidv7 } from "../uuid.ts";
import { now } from "../db/helpers.ts";
import type { ReleaseProcess, ReleaseProcessStatus } from "../entities/release-process.ts";

export type ReleaseProcessCreate = Omit<ReleaseProcess, "id">;

export interface ReleaseProcessRepository {
  create(input: ReleaseProcessCreate): ReleaseProcess;
  findById(id: string): ReleaseProcess | null;
  findBySourceReference(sourceReference: string): ReleaseProcess | null;
  findAll(): ReleaseProcess[];
  update(id: string, patch: Partial<ReleaseProcess>): ReleaseProcess | null;
  delete(id: string): boolean;
}

function fromRow(row: Record<string, unknown>): ReleaseProcess {
  return {
    id: String(row.id),
    sourceReference: String(row.source_reference),
    startAt: row.start_at == null ? null : String(row.start_at),
    endAt: row.end_at == null ? null : String(row.end_at),
    publicationAt: row.publication_at == null ? null : String(row.publication_at),
    candidatureWindowStartAt:
      row.candidature_window_start_at == null ? null : String(row.candidature_window_start_at),
    candidatureWindowEndAt:
      row.candidature_window_end_at == null ? null : String(row.candidature_window_end_at),
    status: String(row.status) as ReleaseProcessStatus,
    source: String(row.source),
    rawJson: row.raw_json == null ? null : String(row.raw_json),
    collectedAt: String(row.collected_at),
  };
}

export class SqliteReleaseProcessRepository implements ReleaseProcessRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  create(input: ReleaseProcessCreate): ReleaseProcess {
    const process: ReleaseProcess = { id: uuidv7(), ...input };
    this.db
      .prepare(
        `INSERT INTO release_processes
           (id, source_reference, start_at, end_at, publication_at, candidature_window_start_at,
            candidature_window_end_at, status, source, raw_json, collected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        process.id,
        process.sourceReference,
        process.startAt,
        process.endAt,
        process.publicationAt,
        process.candidatureWindowStartAt,
        process.candidatureWindowEndAt,
        process.status,
        process.source,
        process.rawJson,
        process.collectedAt
      );
    return process;
  }

  findById(id: string): ReleaseProcess | null {
    const row = this.db
      .prepare("SELECT * FROM release_processes WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? fromRow(row) : null;
  }

  findBySourceReference(sourceReference: string): ReleaseProcess | null {
    const row = this.db
      .prepare("SELECT * FROM release_processes WHERE source_reference = ?")
      .get(sourceReference) as Record<string, unknown> | undefined;
    return row ? fromRow(row) : null;
  }

  findAll(): ReleaseProcess[] {
    const rows = this.db
      .prepare("SELECT * FROM release_processes ORDER BY collected_at DESC")
      .all() as Record<string, unknown>[];
    return rows.map(fromRow);
  }

  update(id: string, patch: Partial<ReleaseProcess>): ReleaseProcess | null {
    const existing = this.findById(id);
    if (!existing) return null;
    const updated: ReleaseProcess = { ...existing, ...patch };
    this.db
      .prepare(
        `UPDATE release_processes SET
           source_reference = ?, start_at = ?, end_at = ?, publication_at = ?,
           candidature_window_start_at = ?, candidature_window_end_at = ?, status = ?,
           source = ?, raw_json = ?, collected_at = ?
         WHERE id = ?`
      )
      .run(
        updated.sourceReference,
        updated.startAt,
        updated.endAt,
        updated.publicationAt,
        updated.candidatureWindowStartAt,
        updated.candidatureWindowEndAt,
        updated.status,
        updated.source,
        updated.rawJson,
        updated.collectedAt,
        id
      );
    return updated;
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM release_processes WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
