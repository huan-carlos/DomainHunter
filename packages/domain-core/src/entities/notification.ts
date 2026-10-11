export type NotificationChannel = "email" | "dashboard";

export type NotificationStatus = "PENDING" | "SENT" | "FAILED";

export interface Notification {
  id: string;
  domainWatchId: string;
  domainEventId: string;
  channel: NotificationChannel;
  priority: string;
  /** sha256(domain_watch_id + event_type + date_bucket) — dedup (RNF-003). */
  dedupKey: string;
  status: NotificationStatus;
  /** Delivery attempts made; bounded by `maxAttempts` (failed sends never block monitoring). */
  attempts: number;
  maxAttempts: number;
  /** Last delivery error (limited retry, plan §9). */
  lastError: string | null;
  sentAt: string | null;
  /** When the dashboard notification was marked as read (RF-020). */
  readAt: string | null;
  createdAt: string;
}
