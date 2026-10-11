/**
 * v1 parser for the Registro.br release process calendar
 * (proclib-schedule.json).
 *
 * Real payload (2026-08-10):
 * ```json
 * {"StartsAt":"12/08/2026 15h","EndsAt":"19/08/2026 15h","Publish":true,"Next":["09/09/2026","14/10/2026"]}
 * ```
 * The parser is tolerant of format drift (LEX-25 AC10): a payload that is
 * not the expected JSON document at all raises `UNKNOWN_FORMAT`, while
 * missing or malformed individual fields degrade to `null`/`[]` instead of
 * failing the whole collection.
 */
import { parseRegistroBrDate } from "./dates.ts";
import { unknownFormat } from "./errors.ts";
import { RELEASE_COLLECTOR_VERSION } from "./version.ts";
import type { ReleaseCalendarRecord } from "../release-provider.ts";

export interface ParseReleaseCalendarInput {
  raw: string;
  fetchedAt: string;
}

export function parseReleaseCalendarV1(input: ParseReleaseCalendarInput): ReleaseCalendarRecord {
  const { raw, fetchedAt } = input;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw unknownFormat("calendar", "payload is not valid JSON", raw);
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw unknownFormat("calendar", "JSON root is not an object", raw);
  }

  const record = json as Record<string, unknown>;
  const startsRaw = typeof record.StartsAt === "string" ? record.StartsAt : null;
  const endsRaw = typeof record.EndsAt === "string" ? record.EndsAt : null;
  const publish = typeof record.Publish === "boolean" ? record.Publish : false;
  const next = Array.isArray(record.Next)
    ? record.Next.filter((value): value is string => typeof value === "string")
    : [];

  return {
    source: "release_collector",
    sourceVersion: RELEASE_COLLECTOR_VERSION,
    startsAt: startsRaw == null ? null : parseRegistroBrDate(startsRaw),
    endsAt: endsRaw == null ? null : parseRegistroBrDate(endsRaw),
    publish,
    next,
    raw,
    fetchedAt,
  };
}
