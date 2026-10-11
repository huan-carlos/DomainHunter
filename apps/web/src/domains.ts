import type { DomainWatchDto } from "./api.ts";
import type { StatusFilterKey, PriorityFilterKey, WatchStatus } from "./labels.ts";
import { STATUS_BUCKETS, STATUS_LABELS } from "./labels.ts";

/** Sortable ledger column. Names mirror the list table columns. */
export type SortKey =
  | "domain"
  | "status"
  | "expiration"
  | "process"
  | "nextCheck"
  | "priority";

export type SortDir = "asc" | "desc";

export interface DashboardSort {
  key: SortKey;
  dir: SortDir;
}

export interface DashboardFilters {
  status: StatusFilterKey;
  priority: PriorityFilterKey;
  sort: DashboardSort;
  /** Substring de busca pelo nome do domínio (case-insensitive). */
  query: string;
}

export const DEFAULT_SORT: DashboardSort = { key: "domain", dir: "asc" };

export const DEFAULT_FILTERS: DashboardFilters = {
  status: "all",
  priority: "all",
  sort: DEFAULT_SORT,
  query: "",
};

const SORT_KEYS: readonly string[] = [
  "domain",
  "status",
  "expiration",
  "process",
  "nextCheck",
  "priority",
];

function isSortKey(value: string | null): value is SortKey {
  return value != null && SORT_KEYS.includes(value);
}

function isSortDir(value: string | null): value is SortDir {
  return value === "asc" || value === "desc";
}

export function parseFilters(params: URLSearchParams): DashboardFilters {
  const status = params.get("status");
  const priority = params.get("priority");
  const sortKey = params.get("sort");
  const sortDir = params.get("dir");
  return {
    status: isStatusKey(status) ? (status as StatusFilterKey) : DEFAULT_FILTERS.status,
    priority: isPriorityKey(priority)
      ? (priority as PriorityFilterKey)
      : DEFAULT_FILTERS.priority,
    sort: {
      key: isSortKey(sortKey) ? sortKey : DEFAULT_SORT.key,
      dir: isSortDir(sortDir) ? sortDir : DEFAULT_SORT.dir,
    },
    query: params.get("q")?.trim() ?? "",
  };
}

function isStatusKey(value: string | null): boolean {
  return value != null && value in STATUS_BUCKETS;
}

function isPriorityKey(value: string | null): boolean {
  if (value == null) return false;
  return value === "all" || value === "CRITICAL" || value === "HIGH" || value === "MEDIUM" || value === "LOW";
}

export function applyFilters(
  domains: DomainWatchDto[],
  filters: DashboardFilters,
): DomainWatchDto[] {
  const allowedStatuses: ReadonlySet<string> = new Set(STATUS_BUCKETS[filters.status]);
  const needle = filters.query.toLowerCase();
  return domains.filter((domain) => {
    if (filters.priority !== "all" && domain.priority !== filters.priority) return false;
    if (needle !== "" && !domain.domain.toLowerCase().includes(needle)) return false;
    return allowedStatuses.has(domain.status as WatchStatus);
  });
}

const PRIORITY_RANK: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

/**
 * Order domains for the dashboard ledger. Date columns keep empty ("—")
 * cells at the bottom in both directions; null dates never block a sort.
 */
export function sortDomains(
  domains: DomainWatchDto[],
  sort: DashboardSort,
): DomainWatchDto[] {
  const sorted = [...domains];
  const dir = sort.dir === "desc" ? -1 : 1;
  sorted.sort((a, b) => compareBy(a, b, sort.key, dir));
  return sorted;
}

function compareBy(
  a: DomainWatchDto,
  b: DomainWatchDto,
  key: SortKey,
  dir: -1 | 1,
): number {
  switch (key) {
    case "domain":
      return (
        dir *
        a.domain.localeCompare(b.domain, "pt-BR", {
          numeric: true,
          sensitivity: "base",
        })
      );
    case "status":
      return (
        dir *
        statusLabel(a.status).localeCompare(statusLabel(b.status), "pt-BR", {
          sensitivity: "base",
        })
      );
    case "expiration":
      return compareNullableDate(a.expirationAt, b.expirationAt, dir);
    case "process":
      return compareNullableDate(
        a.releaseStartAt ?? a.releaseEndAt,
        b.releaseStartAt ?? b.releaseEndAt,
        dir,
      );
    case "nextCheck":
      return compareNullableDate(a.nextCheckAt, b.nextCheckAt, dir);
    case "priority":
      return (
        dir * ((PRIORITY_RANK[a.priority] ?? 99) - (PRIORITY_RANK[b.priority] ?? 99))
      );
  }
}

/**
 * Compare ISO timestamps as strings. Empty ("—") cells always sink to the
 * bottom of the ledger regardless of direction, so the direction is applied
 * only once the two non-null values are actually compared.
 */
function compareNullableDate(
  aIso: string | null,
  bIso: string | null,
  direction: -1 | 1,
): number {
  if (aIso == null && bIso == null) return 0;
  if (aIso == null) return 1;
  if (bIso == null) return -1;
  return direction * aIso.localeCompare(bIso);
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status as WatchStatus] ?? status;
}
