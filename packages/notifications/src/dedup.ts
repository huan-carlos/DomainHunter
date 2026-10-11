/**
 * Notification deduplication (LEX-27, technical plan §5/§9, product brief
 * §18/§26, RNF-003).
 *
 * `dedup_key` = sha256(domain_watch_id + event_type + date_bucket), combined
 * with the `UNIQUE(channel, dedup_key)` constraint on the `notifications`
 * table. Reprocessing the same event (or the same job that re-emits the
 * event) within the same bucket does not produce a second notification.
 */
import { createHash } from "node:crypto";

/** Default bucket: the hour the event occurred in (plan §5 "primeira hora"). */
export const DEFAULT_DEDUP_BUCKET_MS = 60 * 60 * 1000;

export interface DedupKeyInput {
  domainWatchId: string;
  eventType: string;
  occurredAt: string;
  /** Bucket width in ms (defaults to one hour). */
  bucketMs?: number;
}

/** Floor a timestamp to the start of its time bucket (ISO-8601 UTC). */
export function timeBucket(occurredAt: string, bucketMs: number = DEFAULT_DEDUP_BUCKET_MS): string {
  const ms = Date.parse(occurredAt);
  if (Number.isNaN(ms)) return occurredAt;
  return new Date(Math.floor(ms / bucketMs) * bucketMs).toISOString();
}

/** sha256 hex digest of the dedup material (RNF-003). */
export function computeDedupKey(input: DedupKeyInput): string {
  const bucket = timeBucket(input.occurredAt, input.bucketMs ?? DEFAULT_DEDUP_BUCKET_MS);
  return createHash("sha256")
    .update(`${input.domainWatchId}\n${input.eventType}\n${bucket}`)
    .digest("hex");
}
