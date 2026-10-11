/**
 * Versioned Registro.br release process collector — `release-collector@v1`
 * (RNF-016, LEX-25).
 *
 * Combines the HTTPS transport with the v1 calendar/list parsers and returns
 * normalized, typed `ReleaseCalendarRecord` / `ReleaseListRecord` records
 * while preserving the raw publications for audit (RNF-007). It uses only the
 * official public Registro.br URLs — it never scrapes HTML pages
 * (LEX-25 AC09). Technical failures surface as identifiable `ReleaseError`
 * codes (`RELEASE_TIMEOUT`, `RATE_LIMIT`, `PARSER_ERROR`, `UNKNOWN_FORMAT`,
 * `SOURCE_UNAVAILABLE`) and never imply a release verdict (product brief
 * §23, RNF-001).
 */
import { RELEASE_CALENDAR_URL, RELEASE_LIST_URLS } from "../release-provider.ts";
import type { ReleaseCollector, ReleaseListKind } from "../release-provider.ts";
import { parseReleaseCalendarV1 } from "./calendar-parser.ts";
import { parseReleaseListV1 } from "./list-parser.ts";
import { fetchReleaseText } from "./transport.ts";
import type { ReleaseTransportOptions } from "./transport.ts";
import { RELEASE_COLLECTOR_VERSION } from "./version.ts";

export interface ReleaseCollectorV1Options {
  /** Fetch timeout in milliseconds (defaults to 15s). */
  timeoutMs?: number;
  /** Base override for the official URLs (tests / mirrors). */
  baseUrl?: string;
  /** Injectable fetcher (tests). */
  fetcher?: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
  /** Clock for the `fetchedAt` timestamp (defaults to now, UTC ISO-8601). */
  clock?: () => string;
}

export function createReleaseCollectorV1(
  options: ReleaseCollectorV1Options = {},
): ReleaseCollector {
  const clock = options.clock ?? (() => new Date().toISOString());
  const base = options.baseUrl ?? "https://registro.br";

  function calendarUrl(): string {
    return `${base}${RELEASE_CALENDAR_URL.replace("https://registro.br", "")}`;
  }
  function listUrl(kind: ReleaseListKind): string {
    const path = RELEASE_LIST_URLS[kind].replace("https://registro.br", "");
    return `${base}${path}`;
  }

  function transportOptions(): ReleaseTransportOptions {
    return {
      ...(options.timeoutMs != null ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.fetcher != null ? { fetcher: options.fetcher } : {}),
    };
  }

  async function fetchCalendar() {
    const fetchedAt = clock();
    const raw = await fetchReleaseText("calendar", calendarUrl(), transportOptions());
    return parseReleaseCalendarV1({ raw, fetchedAt });
  }

  async function fetchList(kind: ReleaseListKind) {
    const fetchedAt = clock();
    const url = listUrl(kind);
    const raw = await fetchReleaseText(kind, url, transportOptions());
    return parseReleaseListV1({ raw, kind, fetchedAt, sourceUrl: url });
  }

  return { fetchCalendar, fetchList };
}

export { RELEASE_COLLECTOR_VERSION };
