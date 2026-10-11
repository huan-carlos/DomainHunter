import type { DatabaseSync } from "node:sqlite";
import { uuidv7 } from "../uuid.ts";
import { now } from "../db/helpers.ts";
import type { DomainEvent, DomainEventSource, DomainEventType } from "../entities/domain-event.ts";

export type DomainEventCreate = Omit<DomainEvent, "id" | "createdAt">;

export interface DomainEventRepository {
  create(input: DomainEventCreate): DomainEvent;
  findById(id: string): DomainEvent | null;
  findByDomainWatchId(domainWatchId: string, limit?: number): DomainEvent[];
}

function fromRow(row: Record<string, unknown>): DomainEvent {
  return {
    id: String(row.id),
    domainWatchId: String(row.domain_watch_id),
    type: String(row.type) as DomainEventType,
    source: String(row.source) as DomainEventSource,
    sourceVersion: String(row.source_version),
    occurredAt: String(row.occurred_at),
    previousValue: row.previous_value == null ? null : String(row.previous_value),
    newValue: row.new_value == null ? null : String(row.new_value),
    evidenceJson: String(row.evidence_json),
    priority: row.priority == null ? null : String(row.priority),
    createdAt: String(row.created_at),
  };
}

export class SqliteDomainEventRepository implements DomainEventRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  create(input: DomainEventCreate): DomainEvent {
    const event: DomainEvent = { id: uuidv7(), createdAt: now(), ...input };
    this.db
      .prepare(
        `INSERT INTO domain_events
           (id, domain_watch_id, type, source, source_version, occurred_at, previous_value,
            new_value, evidence_json, priority, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.domainWatchId,
        event.type,
        event.source,
        event.sourceVersion,
        event.occurredAt,
        event.previousValue,
        event.newValue,
        event.evidenceJson,
        event.priority,
        event.createdAt
      );
    return event;
  }

  findById(id: string): DomainEvent | null {
    const row = this.db
      .prepare("SELECT * FROM domain_events WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? fromRow(row) : null;
  }

  findByDomainWatchId(domainWatchId: string, limit = 100): DomainEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM domain_events WHERE domain_watch_id = ?
         ORDER BY occurred_at DESC LIMIT ?`
      )
      .all(domainWatchId, limit) as Record<string, unknown>[];
    return rows.map(fromRow);
  }
}
