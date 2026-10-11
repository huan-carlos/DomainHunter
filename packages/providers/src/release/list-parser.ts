/**
 * v1 parser for the Registro.br public release lists.
 *
 * Real payloads (2026-08-10):
 * ```
 * # Processo de liberação no período de 2026-08-12T15:00:00-03:00 a 2026-08-19T15:00:00-03:00
 * # Mais informações em https://registro.br/dominio/processo-de-liberacao/
 * # Arquivo gerado em 2026-08-10T10:00:08-03:00
 * 008bank.com.br
 * 0034.com.br
 * ```
 * and the empty-list form:
 * ```
 * # Arquivo vazio
 * # Mais informações em https://registro.br/dominio/processo-de-liberacao/
 * # Arquivo gerado em 2026-08-11T16:00:00-03:00
 * # Fim do arquivo
 * ```
 * Parsing is tolerant of format drift (LEX-25 AC10): header metadata degrades
 * to `null` when missing, unrecognized non-domain content lines are skipped,
 * and a payload that is fundamentally not a release list (e.g. an HTML error
 * page) raises `UNKNOWN_FORMAT` so the caller can record a technical error
 * without breaking monitoring.
 */
import { parseIsoToUtc } from "./dates.ts";
import { unknownFormat } from "./errors.ts";
import { RELEASE_COLLECTOR_VERSION } from "./version.ts";
import type { ReleaseListKind, ReleaseListRecord } from "../release-provider.ts";

export interface ParseReleaseListInput {
  raw: string;
  kind: ReleaseListKind;
  fetchedAt: string;
  sourceUrl: string;
}

const PERIOD_LINE = /no\s+per[ií]odo\s+de\s+(\S+)\s+a\s+(\S+)/i;
const GENERATED_LINE = /Arquivo\s+gerado\s+em\s+(\S+)/i;
const EMPTY_MARKER = /Arquivo\s+vazio/i;

const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)+\.br$/;

export function parseReleaseListV1(input: ParseReleaseListInput): ReleaseListRecord {
  const { raw, kind, fetchedAt, sourceUrl } = input;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.startsWith("<")) {
    throw unknownFormat(
      kind,
      "payload does not look like a plain text domain list",
      raw,
    );
  }

  const lines = trimmed.split(/\r?\n/);
  const comments: string[] = [];
  const contentLines: string[] = [];

  for (const line of lines) {
    const stripped = line.trim();
    if (stripped.length === 0) continue;
    if (stripped.startsWith("#")) {
      comments.push(stripped);
    } else {
      contentLines.push(stripped);
    }
  }

  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  let generatedAt: string | null = null;
  let isEmpty = false;

  for (const comment of comments) {
    const period = PERIOD_LINE.exec(comment);
    if (period && period[1] != null && period[2] != null) {
      periodStart = parseIsoToUtc(period[1]);
      periodEnd = parseIsoToUtc(period[2]);
    }
    const generated = GENERATED_LINE.exec(comment);
    if (generated && generated[1] != null) {
      generatedAt = parseIsoToUtc(generated[1]);
    }
    if (EMPTY_MARKER.test(comment)) {
      isEmpty = true;
    }
  }

  const domains: string[] = [];
  for (const line of contentLines) {
    const normalized = line.toLowerCase();
    if (DOMAIN_PATTERN.test(normalized)) {
      domains.push(normalized);
    }
  }

  if (!isEmpty && contentLines.length > 0 && domains.length === 0) {
    throw unknownFormat(
      kind,
      "content lines do not match the release list format",
      raw,
    );
  }

  if (isEmpty && domains.length === 0) {
    isEmpty = true;
  }

  return {
    source: "release_collector",
    sourceVersion: RELEASE_COLLECTOR_VERSION,
    kind,
    sourceUrl,
    periodStart,
    periodEnd,
    generatedAt,
    domains,
    isEmpty,
    raw,
    fetchedAt,
  };
}
