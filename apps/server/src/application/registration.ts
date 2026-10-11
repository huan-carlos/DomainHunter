/**
 * Domain registration application service (LEX-20, technical plan §4/§5/§10,
 * product brief §12, AC01–AC03).
 *
 * `registerDomain` owns the cadastro flow end-to-end:
 *   1. normalize + validate the `.br` input (pure, `br-domain.ts`);
 *   2. create the `DomainWatch` with initial status `UNKNOWN` (AC01) and a
 *      `DOMAIN_CREATED_MONITOR` audit event;
 *   3. enqueue the initial job (`INITIAL`) on the persistent queue so the
 *      automations worker also processes it (plan §4 data flow);
 *   4. run the initial check synchronously through `createInitialCheckService`
 *      (WHOIS/RDAP cadastral + ISAVAIL availability, via the pure state
 *      machine) so the registration response carries the initial diagnostic:
 *      state, stored expiry (AC02) and `next_check_at` (AC03).
 *
 * Availability is never inferred: the state machine only reaches `AVAILABLE`
 * on a valid ISAVAIL reply (AC05/AC06, RNF-020).
 */
import {
  createInitialCheckService,
  type DomainEvent,
  type DomainEventRepository,
  type DomainWatch,
  type DomainWatchRepository,
  type InitialCheckSource,
  type PhaseFrequency,
  type ScheduledJobRepository,
} from "@domainhunter/domain-core";
import type { IsavailProvider, RdapProvider, WhoisProvider } from "@domainhunter/providers";
import type { MonitoringPhase } from "@domainhunter/domain-core";
import { BrDomainError, normalizeBrDomain } from "../domain/br-domain.ts";

/** Version identity of the registration flow (RNF-016). */
export const DOMAIN_REGISTRATION_VERSION = "domain-registration@v1";

export interface ProviderSet {
  whois: WhoisProvider;
  rdap: RdapProvider;
  isavail: IsavailProvider;
}

export interface RegistrationDeps {
  watches: DomainWatchRepository;
  events: DomainEventRepository;
  jobs: ScheduledJobRepository;
  providers: ProviderSet;
  /** Clock for timestamps (defaults to now, ISO-8601 UTC). */
  clock?: () => string;
  /** Phase→frequency overrides (RNF-021). */
  frequencies?: Partial<Record<MonitoringPhase, PhaseFrequency>>;
  /** Pre-expiration window for phase B derivation (defaults to 45 days). */
  approachingWindowMs?: number;
}

export type SourceStatus = "ok" | "error" | "skipped";

export interface InitialCheckDiagnostic {
  succeeded: boolean;
  sources: Record<InitialCheckSource, SourceStatus>;
}

export type RegisterResult =
  | {
      kind: "created";
      watch: DomainWatch;
      events: DomainEvent[];
      jobId: string;
      diagnostic: InitialCheckDiagnostic;
    }
  | { kind: "already_watching"; watch: DomainWatch };

/** Throws `BrDomainError` on invalid input. */
export function normalizeDomain(input: string): string {
  return normalizeBrDomain(input);
}

export async function registerDomain(
  domainInput: string,
  deps: RegistrationDeps,
): Promise<RegisterResult> {
  const clock = deps.clock ?? (() => new Date().toISOString());
  const domain = normalizeDomain(domainInput);

  const existing = deps.watches.findByDomain(domain);
  if (existing) {
    return { kind: "already_watching", watch: existing };
  }

  const createdAt = clock();
  const watch = deps.watches.create({
    domain,
    userId: null,
    status: "UNKNOWN",
    priority: "LOW",
    monitoringState: "ACTIVE",
    nextCheckAt: createdAt,
    phase: "A",
  });

  deps.events.create({
    domainWatchId: watch.id,
    type: "DOMAIN_CREATED_MONITOR",
    source: "user",
    sourceVersion: DOMAIN_REGISTRATION_VERSION,
    occurredAt: createdAt,
    previousValue: null,
    newValue: domain,
    evidenceJson: JSON.stringify({ action: "register", domain }),
    priority: "LOW",
  });

  const job = deps.jobs.create({
    domainWatchId: watch.id,
    kind: "INITIAL",
    runAt: createdAt,
  });

  const checkService = createInitialCheckService({
    watches: deps.watches,
    events: deps.events,
    clock,
    ...(deps.frequencies != null ? { frequencies: deps.frequencies } : {}),
    ...(deps.approachingWindowMs != null
      ? { approachingWindowMs: deps.approachingWindowMs }
      : {}),
  });
  const outcome = await checkService.run({
    watchId: watch.id,
    providers: {
      whois: (domain) => deps.providers.whois.query(domain),
      rdap: (domain) => deps.providers.rdap.query(domain),
      isavail: (domain) => deps.providers.isavail.check(domain),
    },
  });

  if (!outcome.watch) {
    // The watch cannot have vanished mid-flight; treat as registration
    // completed with the initial UNKNOWN state.
    return {
      kind: "created",
      watch,
      events: [],
      jobId: job.id,
      diagnostic: {
        succeeded: false,
        sources: { whois: "error", rdap: "error", isavail: "error" },
      },
    };
  }

  return {
    kind: "created",
    watch: outcome.watch,
    events: [...outcome.events],
    jobId: job.id,
    diagnostic: {
      succeeded: !outcome.technicalFailure,
      sources: outcome.sources,
    },
  };
}

export { BrDomainError };
