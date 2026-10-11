import type { DatabaseSync } from "node:sqlite";
import { uuidv7 } from "../uuid.ts";
import { now } from "../db/helpers.ts";
import type { Notification, NotificationChannel, NotificationStatus } from "../entities/notification.ts";

export type NotificationCreate = Omit<
  Notification,
  "id" | "createdAt" | "status" | "attempts" | "maxAttempts" | "lastError" | "sentAt" | "readAt"
> & {
  status?: NotificationStatus;
  attempts?: number;
  maxAttempts?: number;
  lastError?: string | null;
  sentAt?: string | null;
  readAt?: string | null;
};

export interface NotificationRepository {
  create(input: NotificationCreate): Notification;
  findById(id: string): Notification | null;
  findByDomainWatchId(domainWatchId: string): Notification[];
  findByDedupKey(channel: NotificationChannel, dedupKey: string): Notification | null;
  /** Dashboard notifications for a channel, newest first (RF-020). */
  findByChannel(channel: NotificationChannel, limit?: number): Notification[];
  /** Pending notifications that are still retryable for a channel (limited retry). */
  findPending(channel: NotificationChannel, limit?: number): Notification[];
  update(id: string, patch: Partial<Notification>): Notification | null;
  /** Mark a notification as read (RF-020). */
  markRead(id: string, readAt: string): boolean;
  delete(id: string): boolean;
}

function fromRow(row: Record<string, unknown>): Notification {
  return {
    id: String(row.id),
    domainWatchId: String(row.domain_watch_id),
    domainEventId: String(row.domain_event_id),
    channel: String(row.channel) as NotificationChannel,
    priority: String(row.priority),
    dedupKey: String(row.dedup_key),
    status: String(row.status) as NotificationStatus,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    lastError: row.last_error == null ? null : String(row.last_error),
    sentAt: row.sent_at == null ? null : String(row.sent_at),
    readAt: row.read_at == null ? null : String(row.read_at),
    createdAt: String(row.created_at),
  };
}

export class SqliteNotificationRepository implements NotificationRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  create(input: NotificationCreate): Notification {
    const notification: Notification = {
      id: uuidv7(),
      domainWatchId: input.domainWatchId,
      domainEventId: input.domainEventId,
      channel: input.channel,
      priority: input.priority,
      dedupKey: input.dedupKey,
      status: input.status ?? "PENDING",
      attempts: input.attempts ?? 0,
      maxAttempts: input.maxAttempts ?? 3,
      lastError: input.lastError ?? null,
      sentAt: input.sentAt ?? null,
      readAt: input.readAt ?? null,
      createdAt: now(),
    };
    this.db
      .prepare(
        `INSERT INTO notifications
           (id, domain_watch_id, domain_event_id, channel, priority, dedup_key, status,
            attempts, max_attempts, last_error, sent_at, read_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        notification.id,
        notification.domainWatchId,
        notification.domainEventId,
        notification.channel,
        notification.priority,
        notification.dedupKey,
        notification.status,
        notification.attempts,
        notification.maxAttempts,
        notification.lastError,
        notification.sentAt,
        notification.readAt,
        notification.createdAt
      );
    return notification;
  }

  findById(id: string): Notification | null {
    const row = this.db
      .prepare("SELECT * FROM notifications WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? fromRow(row) : null;
  }

  findByDomainWatchId(domainWatchId: string): Notification[] {
    const rows = this.db
      .prepare("SELECT * FROM notifications WHERE domain_watch_id = ? ORDER BY created_at DESC")
      .all(domainWatchId) as Record<string, unknown>[];
    return rows.map(fromRow);
  }

  findByDedupKey(channel: NotificationChannel, dedupKey: string): Notification | null {
    const row = this.db
      .prepare("SELECT * FROM notifications WHERE channel = ? AND dedup_key = ?")
      .get(channel, dedupKey) as Record<string, unknown> | undefined;
    return row ? fromRow(row) : null;
  }

  findByChannel(channel: NotificationChannel, limit = 50): Notification[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM notifications
         WHERE channel = ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(channel, limit) as Record<string, unknown>[];
    return rows.map(fromRow);
  }

  findPending(channel: NotificationChannel, limit = 100): Notification[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM notifications
         WHERE channel = ? AND status = 'PENDING' AND attempts < max_attempts
         ORDER BY created_at ASC LIMIT ?`
      )
      .all(channel, limit) as Record<string, unknown>[];
    return rows.map(fromRow);
  }

  update(id: string, patch: Partial<Notification>): Notification | null {
    const existing = this.findById(id);
    if (!existing) return null;
    const updated: Notification = { ...existing, ...patch };
    this.db
      .prepare(
        `UPDATE notifications SET
           domain_watch_id = ?, domain_event_id = ?, channel = ?, priority = ?, dedup_key = ?,
           status = ?, attempts = ?, max_attempts = ?, last_error = ?, sent_at = ?, read_at = ?
         WHERE id = ?`
      )
      .run(
        updated.domainWatchId,
        updated.domainEventId,
        updated.channel,
        updated.priority,
        updated.dedupKey,
        updated.status,
        updated.attempts,
        updated.maxAttempts,
        updated.lastError,
        updated.sentAt,
        updated.readAt,
        id
      );
    return updated;
  }

  markRead(id: string, readAt: string): boolean {
    const result = this.db
      .prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL")
      .run(readAt, id);
    return result.changes > 0;
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM notifications WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
