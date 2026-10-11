export type ReleaseProcessStatus =
  | "DETECTED"
  | "CANDIDATURE_OPEN"
  | "COMPETITIVE"
  | "RESULTS"
  | "CLOSED";

export interface ReleaseProcess {
  id: string;
  /** Reference to the official publication. */
  sourceReference: string;
  startAt: string | null;
  endAt: string | null;
  publicationAt: string | null;
  candidatureWindowStartAt: string | null;
  candidatureWindowEndAt: string | null;
  status: ReleaseProcessStatus;
  /** Official calendar / lists source. */
  source: string;
  /** Raw publication content (audit evidence). */
  rawJson: string | null;
  collectedAt: string;
}
