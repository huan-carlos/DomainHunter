import { rdapTimeout, rdapRateLimit, rdapSourceUnavailable } from "./errors.ts";

/**
 * RDAP transport over HTTP(S): GET the Registro.br RDAP endpoint
 * (`https://rdap.registro.br/domain/{domain}`) and return the raw response
 * body plus status.
 *
 * The fetch function is injectable so contract tests can drive the real
 * HTTP path against a local server (or a fake fetch) without touching
 * rdap.registro.br.
 */

export interface RdapTransportOptions {
  /** Base URL of the RDAP service (defaults to https://rdap.registro.br). */
  baseUrl?: string;
  /** Timeout for the whole query round-trip. */
  timeoutMs?: number;
  /** Injectable fetch implementation for tests. */
  fetch?: typeof fetch;
  /** Extra headers to send with the request. */
  headers?: Record<string, string>;
}

export interface RdapTransportResult {
  status: number;
  body: string;
}

export async function queryRdapRaw(
  domain: string,
  options: RdapTransportOptions = {},
): Promise<RdapTransportResult> {
  const baseUrl = options.baseUrl ?? "https://rdap.registro.br";
  const timeoutMs = options.timeoutMs ?? 10_000;
  const doFetch = options.fetch ?? fetch;

  const url = `${baseUrl.replace(/\/+$/, "")}/domain/${encodeURIComponent(domain)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await doFetch(url, {
        method: "GET",
        headers: {
          accept: "application/rdap+json, application/json",
          "user-agent": `domainhunter-rdap-client@v1 (DomainHunter)`,
          ...options.headers,
        },
        signal: controller.signal,
      });
    } catch (err) {
      // The only abort we trigger is our own timeout.
      if (controller.signal.aborted) {
        throw rdapTimeout(domain);
      }
      throw rdapSourceUnavailable(domain, err);
    }

    const body = await response.text();

    if (response.status === 429) {
      throw rdapRateLimit(domain, response.status, body);
    }

    // Any non-2xx status that is not a "not found" (404, handled by the
    // parser) is a source failure the caller must never read as a verdict.
    if (response.status < 200 || response.status >= 300) {
      if (response.status !== 404) {
        throw rdapSourceUnavailable(domain, new Error(`HTTP ${response.status}`), body, response.status);
      }
    }

    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}
