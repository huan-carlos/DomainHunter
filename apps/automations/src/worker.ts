import {
  createDatabase,
  createInitialCheckService,
  migrate,
  SqliteDomainEventRepository,
  SqliteDomainWatchRepository,
  SqliteNotificationRepository,
  SqliteScheduledJobRepository,
} from "@domainhunter/domain-core";
import type {
  Database,
  ScheduledJob,
  ScheduledJobKind,
  ScheduledJobRepository,
} from "@domainhunter/domain-core";
import {
  createIsavailClientV1,
  createRdapClientV1,
  createWhoisClientV1,
} from "@domainhunter/providers";
import {
  createNotificationService,
  smtpConfigFromEnv,
  SmtpEmailProvider,
  type NotificationService,
} from "@domainhunter/notifications";
import { runReleaseScan } from "./release-scan.ts";

export interface WorkerOptions {
  databasePath: string;
  pollIntervalMs: number;
  workerId: string;
  clock?: () => string;
}

export interface Worker {
  start(): void;
  stop(): Promise<void>;
}

/**
 * A job handler runs a claimed job. Handlers are resolved through `deps`
 * first so tests can inject fakes without a database.
 */
export type JobHandler = (job: ScheduledJob, now: string) => Promise<void>;

export interface WorkerDeps {
  jobs?: ScheduledJobRepository;
  clock?: () => string;
  handlers?: Partial<Record<ScheduledJobKind, JobHandler>>;
  /** Notification service (LEX-27); built from env + db when omitted. */
  notifications?: NotificationService;
  /** Email delivery batch size per tick (LEX-27). */
  dispatchEmailLimit?: number;
}

/**
 * Build the default notification service: SMTP provider from env (RNF-009);
 * falls back to dashboard-only when SMTP is not configured.
 */
function defaultNotificationService(db: Database, clock: () => string): NotificationService {
  const config = smtpConfigFromEnv(process.env);
  const email = config != null ? new SmtpEmailProvider(config) : null;
  const emailTo = process.env.DOMAINHUNTER_NOTIFICATION_EMAIL_TO;
  return createNotificationService({
    notifications: new SqliteNotificationRepository(db),
    events: new SqliteDomainEventRepository(db),
    watches: new SqliteDomainWatchRepository(db),
    email,
    ...(emailTo != null && emailTo.length > 0 ? { emailTo } : {}),
    clock,
  });
}

/** Default RELEASE_SCAN handler: run the release process collector (LEX-25). */
function releaseScanHandler(db: Database, notifications?: NotificationService): JobHandler {
  return async (_job) => {
    const outcome = await runReleaseScan({ db });
    if (outcome.technicalError) {
      throw new Error(outcome.technicalError);
    }
    if (notifications && outcome.createdEvents.length > 0) {
      const watches = new SqliteDomainWatchRepository(db);
      for (const event of outcome.createdEvents) {
        const watch = watches.findById(event.domainWatchId);
        if (watch) notifications.processEvent(watch, event);
      }
    }
  };
}

/**
 * Default INITIAL handler (LEX-20): run the initial WHOIS/RDAP + ISAVAIL
 * check for the watch through the shared domain-core runner, so the queued
 * initial job performs the same cadastro diagnostics as the synchronous
 * POST /domains path. Events produced by the check feed the notification
 * service (LEX-27).
 */
function initialCheckHandler(db: Database, notifications?: NotificationService): JobHandler {
  const whois = createWhoisClientV1();
  const rdap = createRdapClientV1();
  const isavail = createIsavailClientV1();
  return async (job) => {
    const watches = new SqliteDomainWatchRepository(db);
    const events = new SqliteDomainEventRepository(db);
    const check = createInitialCheckService({ watches, events });
    const outcome = await check.run({
      watchId: job.domainWatchId,
      providers: {
        whois: (domain) => whois.query(domain),
        rdap: (domain) => rdap.query(domain),
        isavail: (domain) => isavail.check(domain),
      },
    });
    if (!outcome.watch) {
      throw new Error(`initial check: watch ${job.domainWatchId} not found`);
    }
    if (notifications && outcome.events.length > 0) {
      notifications.processEvents(outcome.watch, outcome.events);
    }
  };
}

/**
 * Scheduler worker (LEX-21): polls due pending jobs and dispatches them to
 * per-kind handlers, defaulting to marking jobs succeeded. INITIAL jobs run
 * the initial WHOIS/RDAP + ISAVAIL check (LEX-20); RELEASE_SCAN jobs run the
 * release process collector (LEX-25). A handler that throws marks the job
 * FAILED with `lastError`; domain state is preserved (RN07).
 */
export function createWorker(options: WorkerOptions, deps: WorkerDeps = {}): Worker {
  const db = createDatabase(options.databasePath);
  migrate(db);
  const jobs = deps.jobs ?? new SqliteScheduledJobRepository(db);
  const clock = deps.clock ?? (() => new Date().toISOString());
  const notifications = deps.notifications ?? defaultNotificationService(db, clock);
  const dispatchEmailLimit = deps.dispatchEmailLimit ?? 50;
  const handlers: Partial<Record<ScheduledJobKind, JobHandler>> = {
    INITIAL: initialCheckHandler(db, notifications),
    RELEASE_SCAN: releaseScanHandler(db, notifications),
    ...deps.handlers,
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  /** In-flight ticks, awaited by `stop` so graceful shutdown drains work. */
  const inFlightTicks = new Set<Promise<void>>();

  function runTick(): void {
    const promise = tick();
    inFlightTicks.add(promise);
    void promise.finally(() => inFlightTicks.delete(promise));
  }

  async function dispatch(job: ScheduledJob, now: string): Promise<void> {
    const handler = handlers[job.kind];
    if (!handler) {
      jobs.update(job.id, { status: "SUCCEEDED", finishedAt: now });
      return;
    }
    try {
      await handler(job, now);
      jobs.update(job.id, { status: "SUCCEEDED", finishedAt: now });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed: Partial<ScheduledJob> = {
        status: "FAILED",
        lastError: message,
        finishedAt: now,
      };
      if (job.attempts < job.maxAttempts) {
        const backoffMs = 60_000 * 2 ** (job.attempts - 1);
        failed.status = "PENDING";
        failed.nextRetryAt = new Date(new Date(now).getTime() + backoffMs).toISOString();
      }
      jobs.update(job.id, failed);
    }
  }

  async function tick(): Promise<void> {
    if (!running) return;
    const now = clock();
    const job = jobs.claimNext(now, options.workerId);
    if (job) await dispatch(job, now);
    // Email delivery is a dedicated queue independent of the monitoring
    // job queue (LEX-27, plan §9): a delivery failure never blocks
    // monitoring and vice-versa.
    await notifications.dispatchPendingEmail(dispatchEmailLimit);
  }

  return {
    start() {
      if (running) return;
      running = true;
      timer = setInterval(() => {
        runTick();
      }, options.pollIntervalMs);
      runTick();
    },
    async stop() {
      running = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      // Drain any in-flight tick so pending work (e.g. the dedicated email
      // queue) completes before the database closes.
      await Promise.allSettled([...inFlightTicks]);
      db.close();
    },
  };
}
