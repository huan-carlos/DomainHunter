export type DomainEventType =
  | "DOMAIN_CREATED_MONITOR"
  | "DOMAIN_STATUS_CHANGED"
  | "DOMAIN_RENEWED"
  | "DOMAIN_EXPIRATION_CHANGED"
  | "DOMAIN_APPROACHING_EXPIRATION"
  | "DOMAIN_POST_EXPIRATION"
  | "DOMAIN_RELEASE_DETECTED"
  | "DOMAIN_ENTERED_RELEASE"
  | "CANDIDATURE_WINDOW_OPEN"
  | "CANDIDATURE_WINDOW_CLOSED"
  | "COMPETITIVE_PROCESS_DETECTED"
  | "RELEASE_RESULT_PUBLISHED"
  | "DOMAIN_AVAILABLE"
  | "DOMAIN_UNAVAILABLE"
  | "CHECK_SUCCEEDED"
  | "CHECK_FAILED"
  | "NOTIFICATION_SENT"
  | "EXPIRATION_APPROACHING"
  | "RELEASE_DETECTED"
  | "RELEASE_CANDIDATURE_OPEN"
  | "RELEASE_COMPETITIVE"
  | "RELEASE_CLOSED";

export type DomainEventSource =
  | "whois"
  | "rdap"
  | "isavail"
  | "release_collector"
  | "system"
  | "user";

export interface DomainEvent {
  id: string;
  domainWatchId: string;
  type: DomainEventType;
  source: DomainEventSource;
  /** Version of the client/parser that produced the event (RNF-016). */
  sourceVersion: string;
  occurredAt: string;
  previousValue: string | null;
  newValue: string | null;
  /** Normalized evidence (raw response or summary) (RNF-007, AC10). */
  evidenceJson: string;
  priority: string | null;
  createdAt: string;
}
