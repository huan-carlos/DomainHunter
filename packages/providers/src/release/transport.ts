/**
 * Release collection transport over HTTPS.
 *
 * Fetches the official Registro.br calendar (proclib-schedule.json) and the
 * public list files over HTTPS with an injectable fetcher and a timeout. The
 * payloads are decoded as Latin-1: the list files are served as ISO-8859-1
 * (accented header lines such as `informações` and `período` would be
 * corrupted by UTF-8 decoding). The fetcher is injectable so contract tests
 * can drive the real HTTP path against a local server without touching
 * registro.br (LEX-25 AC09 — no scraping, official URLs only).
 */
import { rateLimit, releaseTimeout, sourceUnavailable, ReleaseError } from "./errors.ts";

export type ReleaseFetcher = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<Response>;

export interface ReleaseTransportOptions {
  /** Timeout for the whole fetch round-trip in milliseconds (defaults to 15s). */
  timeoutMs?: number;
  /** Injectable fetcher for tests (defaults to the global `fetch`). */
  fetcher?: ReleaseFetcher;
}

export async function fetchReleaseText(
  kind: string,
  url: string,
  options: ReleaseTransportOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const fetcher: ReleaseFetcher =
    options.fetcher ?? ((u: string, init: { signal: AbortSignal }) => fetch(u, init));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { signal: controller.signal });
    if (response.status === 429) {
      throw rateLimit(kind);
    }
    if (!response.ok) {
      throw sourceUnavailable(kind, new Error(`HTTP ${response.status} for ${url}`));
    }
    const buffer = await response.arrayBuffer();
    return new TextDecoder("latin1").decode(buffer);
  } catch (error) {
    if (error instanceof ReleaseError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw releaseTimeout(kind);
    }
    throw sourceUnavailable(kind, error);
  } finally {
    clearTimeout(timer);
  }
}
