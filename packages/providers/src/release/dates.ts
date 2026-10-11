/**
 * Parsing helpers for Registro.br release publication dates.
 *
 * The calendar uses `dd/mm/yyyy hh\h` (e.g. `12/08/2026 15h`) and the list
 * headers use ISO-8601 with the Brazil offset (e.g.
 * `2026-08-12T15:00:00-03:00`). Both are interpreted as America/Sao_Paulo
 * local time — fixed UTC-3, no DST since 2019 — and normalized to ISO-8601
 * UTC. Parsing is tolerant: unparseable optional values return `null` rather
 * than failing the whole collection (LEX-25 AC10 — format drift must not
 * break monitoring).
 */

/** Parse `dd/mm/yyyy hh[h][:mm]` (e.g. `12/08/2026 15h`) to ISO-8601 UTC. */
export function parseRegistroBrDate(input: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2})h(?::(\d{2}))?$/.exec(input.trim());
  if (!match) return null;
  const [, day, month, year, hours, minutes] = match;
  const iso = `${year}-${month}-${day}T${hours}:${minutes ?? "00"}:00-03:00`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** Parse an ISO-8601 string (with any offset) to ISO-8601 UTC, or `null`. */
export function parseIsoToUtc(input: string): string | null {
  const trimmed = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(trimmed)) {
    return null;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
