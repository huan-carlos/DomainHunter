/**
 * Notification service (LEX-27, technical plan §9, product brief §18/§19/§22,
 * AC05, RNF-003, RNF-009, RNF-010, RNF-014).
 *
 * Responsibilities:
 *  - classify an event's channels by priority (brief §18): high/medium →
 *    email + dashboard; low → dashboard only; technical (null) → none;
 *  - create `notifications` rows keyed by `dedup_key`
 *    (sha256(domain_watch_id + event_type + bucket)) so reprocessing an event
 *    never duplicates a notification (RNF-003, UNIQUE(channel, dedup_key));
 *  - dashboard notifications are delivered by persistence (the API/UI reads
 *    the table), so they are created as SENT immediately;
 *  - email notifications start PENDING and are dispatched with a bounded
 *    number of attempts; a delivery failure marks the row FAILED and never
 *    blocks monitoring (plan §9).
 *
 * A successful email delivery also records a `NOTIFICATION_SENT` audit event
 * through the Event Engine (catalog §26, AC10).
 */
import type { DomainEvent } from "@domainhunter/domain-core";
import type { DomainWatch } from "@domainhunter/domain-core";
import type {
  DomainEventRepository,
  DomainWatchRepository,
  Notification,
  NotificationChannel,
  NotificationRepository,
} from "@domainhunter/domain-core";
import { computeDedupKey } from "./dedup.ts";
import type { EmailProvider } from "./email-provider.ts";
import { renderNotificationEmail } from "./template.ts";

export interface NotificationServiceDeps {
  notifications: NotificationRepository;
  events: DomainEventRepository;
  watches: DomainWatchRepository;
  /** Email provider; when null/undefined the email channel is skipped (dashboard-only). */
  email?: EmailProvider | null;
  /** Authorized recipient (RNF-010); email is skipped when absent. */
  emailTo?: string;
  /** Clock for timestamps (defaults to now, ISO-8601 UTC). */
  clock?: () => string;
  /** Max delivery attempts for an email notification (default 3). */
  maxAttempts?: number;
  /** Dedup bucket width in ms (default 1 hour, plan §5). */
  dedupBucketMs?: number;
}

export interface NotificationService {
  /** Create notifications for one persisted event, deduplicated (RNF-003). */
  processEvent(watch: DomainWatch, event: DomainEvent): Notification[];
  /** Create notifications for many events. */
  processEvents(watch: DomainWatch, events: DomainEvent[]): Notification[];
  /** Dispatch pending email notifications with limited retry. */
  dispatchPendingEmail(limit?: number): Promise<DispatchSummary>;
}

export interface DispatchSummary {
  attempted: number;
  sent: number;
  failed: number;
  errors: string[];
}

/**
 * Channels for a notification priority (product brief §18, plan §9):
 * high/medium → email + dashboard; low → dashboard only; technical (null) →
 * no notification.
 */
export function channelsForPriority(priority: string | null): NotificationChannel[] {
  if (priority == null) return [];
  if (priority === "LOW") return ["dashboard"];
  return ["email", "dashboard"];
}

export function createNotificationService(deps: NotificationServiceDeps): NotificationService {
  const clock = deps.clock ?? (() => new Date().toISOString());
  const maxAttempts = deps.maxAttempts ?? 3;
  const bucketMs = deps.dedupBucketMs ?? 60 * 60 * 1000;
  const emailEnabled = deps.email != null && deps.emailTo != null && deps.emailTo.length > 0;

  function createForChannel(
    watch: DomainWatch,
    event: DomainEvent,
    channel: NotificationChannel,
  ): Notification | null {
    const dedupKey = computeDedupKey({
      domainWatchId: watch.id,
      eventType: event.type,
      occurredAt: event.occurredAt,
      bucketMs,
    });
    const existing = deps.notifications.findByDedupKey(channel, dedupKey);
    if (existing) return null;

    const createdAt = clock();
    const isDashboard = channel === "dashboard";
    return deps.notifications.create({
      domainWatchId: watch.id,
      domainEventId: event.id,
      channel,
      priority: event.priority ?? "LOW",
      dedupKey,
      status: isDashboard ? "SENT" : "PENDING",
      attempts: 0,
      maxAttempts,
      lastError: null,
      sentAt: isDashboard ? createdAt : null,
    });
  }

  function processEvent(watch: DomainWatch, event: DomainEvent): Notification[] {
    const channels = channelsForPriority(event.priority);
    if (channels.length === 0) return [];
    const created: Notification[] = [];
    for (const channel of channels) {
      if (channel === "email" && !emailEnabled) continue;
      const notification = createForChannel(watch, event, channel);
      if (notification) created.push(notification);
    }
    return created;
  }

  function processEvents(watch: DomainWatch, events: DomainEvent[]): Notification[] {
    const created: Notification[] = [];
    for (const event of events) {
      created.push(...processEvent(watch, event));
    }
    return created;
  }

  async function dispatchPendingEmail(limit = 50): Promise<DispatchSummary> {
    if (!emailEnabled) return { attempted: 0, sent: 0, failed: 0, errors: [] };
    const pending = deps.notifications.findPending("email", limit);
    const summary: DispatchSummary = { attempted: 0, sent: 0, failed: 0, errors: [] };
    const provider = deps.email!;

    for (const notification of pending) {
      summary.attempted += 1;
      try {
        const watch = deps.watches.findById(notification.domainWatchId);
        if (!watch) {
          throw new Error(`watch ${notification.domainWatchId} not found`);
        }
        const event = deps.events.findById(notification.domainEventId);
        if (!event) {
          throw new Error(`event ${notification.domainEventId} not found`);
        }
        const email = renderNotificationEmail({
          domain: watch.domain,
          eventType: event.type,
          priority: event.priority,
          occurredAt: event.occurredAt,
          status: watch.status,
        });
        await provider.send({
          to: deps.emailTo!,
          subject: email.subject,
          text: email.text,
          html: email.html,
        });
        deps.notifications.update(notification.id, {
          status: "SENT",
          attempts: notification.attempts + 1,
          lastError: null,
          sentAt: clock(),
        });
        deps.events.create({
          domainWatchId: watch.id,
          type: "NOTIFICATION_SENT",
          source: "system",
          sourceVersion: "notification-service@v1",
          occurredAt: clock(),
          previousValue: null,
          newValue: notification.channel,
          evidenceJson: JSON.stringify({ channel: notification.channel, notificationId: notification.id }),
          priority: null,
        });
        summary.sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const attempts = notification.attempts + 1;
        const failed = attempts >= maxAttempts;
        deps.notifications.update(notification.id, {
          attempts,
          lastError: message,
          status: failed ? "FAILED" : "PENDING",
        });
        summary.failed += failed ? 1 : 0;
        summary.errors.push(`${notification.id}: ${message}`);
      }
    }
    return summary;
  }

  return { processEvent, processEvents, dispatchPendingEmail };
}

export type { Notification, NotificationChannel };
