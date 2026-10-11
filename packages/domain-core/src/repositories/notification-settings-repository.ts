import type { DatabaseSync } from "node:sqlite";
import { now } from "../db/helpers.ts";
import type {
  NotificationSettings,
  NotificationSettingsPatch,
} from "../entities/notification-settings.ts";

export const DEFAULT_NOTIFICATION_SETTINGS: Omit<NotificationSettings, "updatedAt"> = {
  id: "default",
  notificationEmail: null,
  expirationNoticeDays: 45,
};

export interface NotificationSettingsRepository {
  /** Read the current settings; returns defaults when unset (RF-021). */
  get(): NotificationSettings;
  /** Apply a partial update and persist (upsert single row). */
  update(patch: NotificationSettingsPatch): NotificationSettings;
}

function fromRow(row: Record<string, unknown>): NotificationSettings {
  return {
    id: "default",
    notificationEmail: row.notification_email == null ? null : String(row.notification_email),
    expirationNoticeDays: Number(row.expiration_notice_days),
    updatedAt: String(row.updated_at),
  };
}

export class SqliteNotificationSettingsRepository implements NotificationSettingsRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  get(): NotificationSettings {
    const row = this.db
      .prepare("SELECT * FROM notification_settings WHERE id = 'default'")
      .get() as Record<string, unknown> | undefined;
    if (!row) {
      return { ...DEFAULT_NOTIFICATION_SETTINGS, updatedAt: now() };
    }
    return fromRow(row);
  }

  update(patch: NotificationSettingsPatch): NotificationSettings {
    const current = this.get();
    const updated: NotificationSettings = {
      ...current,
      ...patch,
      id: "default",
      updatedAt: now(),
    };
    this.db
      .prepare(
        `INSERT INTO notification_settings (id, notification_email, expiration_notice_days, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           notification_email = excluded.notification_email,
           expiration_notice_days = excluded.expiration_notice_days,
           updated_at = excluded.updated_at`
      )
      .run(
        updated.id,
        updated.notificationEmail,
        updated.expirationNoticeDays,
        updated.updatedAt
      );
    return updated;
  }
}
