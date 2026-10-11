export type DomainWatchStatus =
  | "REGISTERED"
  | "EXPIRATION_APPROACHING"
  | "POST_EXPIRATION_MONITORING"
  | "RELEASE_PENDING"
  | "RELEASE_PROCESS"
  | "AVAILABLE"
  | "RENEWED"
  | "UNKNOWN"
  | "CHECK_FAILED"
  | "COMPETITIVE_RELEASE"
  | "MONITORING_STOPPED";

export type WatchPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type MonitoringState = "ACTIVE" | "PAUSED" | "STOPPED";

export type MonitoringPhase = "A" | "B" | "C" | "D" | "E";

export interface DomainWatch {
  id: string;
  /** Normalized domain, e.g. `example.com.br`. */
  domain: string;
  /** NULL in the single-user MVP (RNF-024, multiuser-ready). */
  userId: string | null;
  status: DomainWatchStatus;
  rawLastStatus: string | null;
  priority: WatchPriority;
  monitoringState: MonitoringState;
  createdAt: string;
  lastCheckAt: string | null;
  nextCheckAt: string;
  expirationAt: string | null;
  lastKnownOwner: string | null;
  lastKnownOwnerId: string | null;
  releaseProcessId: string | null;
  releaseStartAt: string | null;
  releaseEndAt: string | null;
  lastWhoisCheckAt: string | null;
  lastRdapCheckAt: string | null;
  lastIsavailCheckAt: string | null;
  lastSuccessfulCheckAt: string | null;
  availableSince: string | null;
  checkFailureCount: number;
  phase: MonitoringPhase;
  /** Parser versions used in the last query (RNF-016). */
  clientVersions: Record<string, string> | null;
  deletedAt: string | null;
}
