/**
 * Release Process collector source contract (LEX-25, product brief §16).
 *
 * The Registro.br registry publishes, on official public URLs, the release
 * process calendar and the public lists of domains involved in each process
 * (domains being released, domains eligible for a competitive process, and
 * domains participating in a competitive process). Those publications are the
 * only authorized source of release information for this product
 * (product brief §16.1, RNF-020): a watch may reach `RELEASE_PENDING`,
 * `RELEASE_PROCESS`, or `COMPETITIVE_RELEASE` only through a valid release
 * publication. This contract is the single typed interface every release
 * collector must satisfy; concrete, versioned clients (RNF-016, RNF-023)
 * implement `ReleaseCollector` and return normalized records while preserving
 * the raw publication for audit (RNF-007).
 */

/** The three official public release publications (one domain per line). */
export type ReleaseListKind = "release" | "competitive" | "eligible";

/** Official URLs of the release calendar and public lists. */
export const RELEASE_CALENDAR_URL = "https://registro.br/dominio/proclib-schedule.json";

export const RELEASE_LIST_URLS: Record<ReleaseListKind, string> = {
  release: "https://registro.br/dominio/lista-processo-liberacao.txt",
  competitive: "https://registro.br/dominio/lista-processo-competitivo.txt",
  eligible: "https://registro.br/dominio/lista-competicao.txt",
};

/** Normalized release process calendar entry (proclib-schedule.json). */
export interface ReleaseCalendarRecord {
  /** Fixed source identifier, usable as `domain_events.source`. */
  source: "release_collector";
  /** Versioned collector/parser identity (RNF-016), e.g. `release-collector@v1`. */
  sourceVersion: string;
  /** Process start, ISO-8601 UTC (null when not published yet). */
  startsAt: string | null;
  /** Process end, ISO-8601 UTC (null when not published yet). */
  endsAt: string | null;
  /** Whether the public lists are published (registry `Publish` flag). */
  publish: boolean;
  /** Raw future process dates as announced by the calendar (dd/mm/yyyy). */
  next: string[];
  /** Raw calendar payload, preserved as audit evidence (RNF-007). */
  raw: string;
  /** Fetch timestamp, ISO-8601 UTC (RNF-018). */
  fetchedAt: string;
}

/** Normalized public release list (one of the three official publications). */
export interface ReleaseListRecord {
  /** Fixed source identifier, usable as `domain_events.source`. */
  source: "release_collector";
  /** Versioned collector/parser identity (RNF-016), e.g. `release-collector@v1`. */
  sourceVersion: string;
  /** Which official list was read. */
  kind: ReleaseListKind;
  /** Official URL the list was fetched from (audit evidence). */
  sourceUrl: string;
  /** Process period start from the list header, ISO-8601 UTC (null if absent). */
  periodStart: string | null;
  /** Process period end from the list header, ISO-8601 UTC (null if absent). */
  periodEnd: string | null;
  /** Publication timestamp from the `Arquivo gerado em` header, ISO-8601 UTC. */
  generatedAt: string | null;
  /** Normalized domain names contained in the list (lowercase FQDN). */
  domains: string[];
  /** True when the registry marked the list empty (`Arquivo vazio`). */
  isEmpty: boolean;
  /** Raw list payload, preserved as audit evidence (RNF-007). */
  raw: string;
  /** Fetch timestamp, ISO-8601 UTC (RNF-018). */
  fetchedAt: string;
}

/** Versioned release process collector (RNF-016). */
export interface ReleaseCollector {
  /** Fetch and normalize the release process calendar. */
  fetchCalendar(): Promise<ReleaseCalendarRecord>;
  /** Fetch and normalize one of the three public release lists. */
  fetchList(kind: ReleaseListKind): Promise<ReleaseListRecord>;
}
