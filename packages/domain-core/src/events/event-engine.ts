/**
 * Event Engine (LEX-27, technical plan §5/§6/§9, product brief §22/§26, AC10,
 * RNF-007, RNF-016).
 *
 * The Event Engine is the single, audited path that turns an observed change
 * into a persisted `domain_events` row. It enforces the AC10 contract at the
 * boundary: every event MUST carry a source, a source version, an
 * `occurred_at` timestamp and normalized evidence. Callers that already
 * produce validated events (state machine transitions, release scans,
 * registration) can keep using the raw repository; this service exists for
 * callers that want the audit guarantee without re-implementing it.
 *
 * It also exposes the full event catalog from the product brief §26 so the
 * system can reason about "all events" and notifications can decide which
 * events are notifiable.
 */
import type {
  DomainEvent,
  DomainEventSource,
  DomainEventType,
} from "../entities/domain-event.ts";
import type { DomainEventRepository } from "../repositories/domain-event-repository.ts";
import type { WatchPriority } from "../entities/domain-watch.ts";

/** Full event catalog (product brief §26). */
export const DOMAIN_EVENT_CATALOG: readonly DomainEventType[] = [
  "DOMAIN_CREATED_MONITOR",
  "DOMAIN_STATUS_CHANGED",
  "DOMAIN_EXPIRATION_CHANGED",
  "DOMAIN_RENEWED",
  "DOMAIN_APPROACHING_EXPIRATION",
  "DOMAIN_POST_EXPIRATION",
  "DOMAIN_RELEASE_DETECTED",
  "DOMAIN_ENTERED_RELEASE",
  "CANDIDATURE_WINDOW_OPEN",
  "CANDIDATURE_WINDOW_CLOSED",
  "COMPETITIVE_PROCESS_DETECTED",
  "RELEASE_RESULT_PUBLISHED",
  "DOMAIN_AVAILABLE",
  "DOMAIN_UNAVAILABLE",
  "CHECK_SUCCEEDED",
  "CHECK_FAILED",
  "NOTIFICATION_SENT",
];

export interface EventEngineRecordInput {
  domainWatchId: string;
  type: DomainEventType;
  source: DomainEventSource;
  /** Version of the client/parser that produced the event (RNF-016). */
  sourceVersion: string;
  /** Timestamp of the discovery (defaults to now, ISO-8601 UTC, RNF-018). */
  occurredAt?: string;
  previousValue?: string | null;
  newValue?: string | null;
  /** Normalized evidence (raw response or summary) (RNF-007, AC10). */
  evidenceJson: string;
  /** Classified notification priority (plan §9). */
  priority?: WatchPriority | null;
}

export interface EventEngine {
  record(input: EventEngineRecordInput): DomainEvent;
  findById(id: string): DomainEvent | null;
  findByDomainWatchId(domainWatchId: string, limit?: number): DomainEvent[];
}

export interface EventEngineDeps {
  events: DomainEventRepository;
  /** Clock for timestamps (defaults to now, ISO-8601 UTC). */
  clock?: () => string;
}

export function createEventEngine(deps: EventEngineDeps): EventEngine {
  const clock = deps.clock ?? (() => new Date().toISOString());

  function record(input: EventEngineRecordInput): DomainEvent {
    if (input.type.trim().length === 0) {
      throw new Error("event type is required");
    }
    if (input.source.trim().length === 0) {
      throw new Error("event source is required");
    }
    if (input.sourceVersion.trim().length === 0) {
      throw new Error("event sourceVersion is required");
    }
    if (input.evidenceJson.trim().length === 0) {
      throw new Error("event evidenceJson is required");
    }
    return deps.events.create({
      domainWatchId: input.domainWatchId,
      type: input.type,
      source: input.source,
      sourceVersion: input.sourceVersion,
      occurredAt: input.occurredAt ?? clock(),
      previousValue: input.previousValue ?? null,
      newValue: input.newValue ?? null,
      evidenceJson: input.evidenceJson,
      priority: input.priority ?? null,
    });
  }

  return {
    record,
    findById: (id) => deps.events.findById(id),
    findByDomainWatchId: (domainWatchId, limit) =>
      deps.events.findByDomainWatchId(domainWatchId, limit),
  };
}
