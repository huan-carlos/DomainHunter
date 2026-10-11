import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchReleaseText } from "./transport.ts";
import { ReleaseError } from "./errors.ts";
function jsonResponse(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    headers: init.headers ?? {},
  } as unknown as Response;
}

describe("release transport", () => {
  it("decodes the response body as Latin-1 so accented headers survive (RNF-007)", async () => {
    const latin1Bytes = new Uint8Array([0x69, 0x6e, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0xe7, 0xf5, 0x65, 0x73]);
    const response = {
      ok: true,
      status: 200,
      arrayBuffer: async () => latin1Bytes.buffer,
    } as unknown as Response;
    const text = await fetchReleaseText("release", "https://registro.br/lista.txt", {
      fetcher: async () => response,
    });
    assert.equal(text, "informações");
  });

  it("returns the raw body for a 200 response", async () => {
    const body = "domainhunter.com.br\nother.com.br\n";
    const text = await fetchReleaseText("release", "https://registro.br/lista.txt", {
      fetcher: async () => jsonResponse(body),
    });
    assert.equal(text, body);
  });

  it("surfaces RATE_LIMIT for a 429 response", async () => {
    await assert.rejects(
      () =>
        fetchReleaseText("release", "https://registro.br/lista.txt", {
          fetcher: async () => jsonResponse("", { status: 429 }),
        }),
      (err: unknown) => ReleaseError.isReleaseError(err) && err.code === "RATE_LIMIT",
    );
  });

  it("surfaces SOURCE_UNAVAILABLE for a non-2xx response", async () => {
    await assert.rejects(
      () =>
        fetchReleaseText("release", "https://registro.br/lista.txt", {
          fetcher: async () => jsonResponse("oops", { status: 503 }),
        }),
      (err: unknown) => ReleaseError.isReleaseError(err) && err.code === "SOURCE_UNAVAILABLE",
    );
  });

  it("surfaces RELEASE_TIMEOUT when the fetch exceeds the timeout", async () => {
    await assert.rejects(
      () =>
        fetchReleaseText("release", "https://registro.br/lista.txt", {
          timeoutMs: 50,
          fetcher: async (_url, init) => {
            await new Promise<void>((resolve) => {
              init.signal.addEventListener("abort", () => resolve());
            });
            const abortError = new Error("This operation was aborted");
            abortError.name = "AbortError";
            throw abortError;
          },
        }),
      (err: unknown) => ReleaseError.isReleaseError(err) && err.code === "RELEASE_TIMEOUT",
    );
  });

  it("rethrows identifiable release errors unchanged", async () => {
    await assert.rejects(
      () =>
        fetchReleaseText("release", "https://registro.br/lista.txt", {
          fetcher: async () => {
            throw new ReleaseError("UNKNOWN_FORMAT", "boom", { kind: "release" });
          },
        }),
      (err: unknown) => ReleaseError.isReleaseError(err) && err.code === "UNKNOWN_FORMAT",
    );
  });
});
