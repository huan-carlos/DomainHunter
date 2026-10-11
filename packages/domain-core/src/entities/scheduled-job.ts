export type ScheduledJobKind = "INITIAL" | "CADASTRAL" | "ISAVAIL" | "RELEASE_SCAN";

export type ScheduledJobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";

export interface ScheduledJob {
  id: string;
  domainWatchId: string;
  kind: ScheduledJobKind;
  runAt: string;
  status: ScheduledJobStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  /** Worker id owning the lock (safe resume, RNF-013). */
  lockedBy: string | null;
  lockedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}
