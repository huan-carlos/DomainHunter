/**
 * Notification settings (RF-021): alert email + expiration notice lead time.
 *
 * MVP is single-user (RNF-024): the settings are a single row keyed by the
 * fixed id `default`. `expirationNoticeDays` is the lead time before a domain
 * expires that triggers "expiração se aproximando" alerts (default 45 days,
 * aligned with the pre-expiration window `DEFAULT_APPROACHING_WINDOW_MS`).
 */
export interface NotificationSettings {
  id: "default";
  /** Authorized alert recipient (RNF-010); null disables email alerts. */
  notificationEmail: string | null;
  /** Lead time in days before expiration to alert (RF-021). */
  expirationNoticeDays: number;
  updatedAt: string;
}

export type NotificationSettingsPatch = Partial<
  Pick<NotificationSettings, "notificationEmail" | "expirationNoticeDays">
>;
