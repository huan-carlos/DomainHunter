/**
 * Release scan orchestrator (LEX-25): drives one run of the release process
 * collector against the persisted domain set.
 *
 * Flow (product brief §16, technical plan §8):
 *   calendar → next process → list published? → compare lists with
 *   DomainWatch → update ReleaseProcess + DomainWatch + events.
 *
 * The orchestrator owns the resilience boundary:
 * - an `UNKNOWN_FORMAT`/`RATE_LIMIT`/`SOURCE_UNAVAILABLE`/`RELEASE_TIMEOUT`
 *   failure from the collector is a *technical* error: it is reported (job
 *   `lastError`, technical event) and the last confirmed domain state is
 *   preserved (LEX-25 AC10, RN07) — monitoring is never broken by a source
 *   changing format.
 * - a published list is applied atomically through
 *   `createReleaseScanService` from `@domainhunter/domain-core`.
 */
import {
  createReleaseScanService,
  SqliteDomainEventRepository,
  SqliteDomainWatchRepository,
  SqliteReleaseProcessRepository,
  type Database,
  type DomainEvent,
  type ReleaseListLike,
} from "@domainhunter/domain-core";
import {
  ReleaseError,
  createReleaseCollectorV1,
  type ReleaseCollector,
} from "@domainhunter/providers";

export interface ReleaseScanDeps {
  db: Database;
  /** Versioned release collector (injectable for tests). */
  collector?: ReleaseCollector;
  clock?: () => string;
}

export interface ReleaseScanOutcome {
  /** Number of active watches considered. */
  consideredWatches: number;
  /** Watches whose state/priority changed. */
  updatedWatches: number;
  /** Events created for observed changes (LEX-27 notification hook). */
  createdEvents: DomainEvent[];
  /** Process the publication referred to. */
  processReference: string | null;
  /** Technical failure reported without touching domain state. */
  technicalError: string | null;
}

const LIST_KINDS = ["release", "competitive", "eligible"] as const;

/**
 * Run one release collection pass. Fetches the calendar and, when the lists
 * are published, all three official lists, then applies them to the watches.
 * Returns a summary; never throws — technical failures are reported in the
 * result so the scheduler can mark the job failed without breaking
 * monitoring.
 */
export async function runReleaseScan(deps: ReleaseScanDeps): Promise<ReleaseScanOutcome> {
  const clock = deps.clock ?? (() => new Date().toISOString());
  const collector = deps.collector ?? createReleaseCollectorV1();

  try {
    const calendar = await collector.fetchCalendar();

    if (!calendar.publish) {
      return {
        consideredWatches: 0,
        updatedWatches: 0,
        createdEvents: [],
        processReference: null,
        technicalError: null,
      };
    }

    const lists: ReleaseListLike[] = [];
    for (const kind of LIST_KINDS) {
      const record = await collector.fetchList(kind);
      lists.push(record);
    }

    const watches = new SqliteDomainWatchRepository(deps.db);
    const processes = new SqliteReleaseProcessRepository(deps.db);
    const events = new SqliteDomainEventRepository(deps.db);
    const service = createReleaseScanService({ watches, processes, events, clock });

    const result = service.apply({ calendar, lists });
    return {
      consideredWatches: result.consideredWatches,
      updatedWatches: result.updatedWatches.length,
      createdEvents: result.createdEvents,
      processReference: result.process?.sourceReference ?? null,
      technicalError: null,
    };
  } catch (error) {
    if (ReleaseError.isReleaseError(error)) {
      return {
        consideredWatches: 0,
        updatedWatches: 0,
        createdEvents: [],
        processReference: null,
        technicalError: `${error.code}: ${error.message}`,
      };
    }
    return {
      consideredWatches: 0,
      updatedWatches: 0,
      createdEvents: [],
      processReference: null,
      technicalError: `UNEXPECTED: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
