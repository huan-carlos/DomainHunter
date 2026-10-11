import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import type { Socket } from "node:dgram";
import { queryIsavailRaw } from "./transport.ts";
import { IsavailError } from "./errors.ts";

/**
 * UDP contract tests for the ISAVAIL transport: query the local socket
 * exactly as the client would query avail.registro.br, then echo a
 * captured fixture back so the round-trip is exercised end-to-end.
 */

let server: Socket;
let port: number;
let received: Buffer[] = [];
let respondWith: Buffer | null = null;

before(async () => {
  server = createSocket("udp4");
  server.on("message", (msg, rinfo) => {
    received.push(msg);
    if (respondWith) {
      server.send(respondWith, rinfo.port, rinfo.address, () => {
        // ignore errors
      });
    }
  });
  await new Promise<void>((resolve) => server.bind(0, "127.0.0.1", () => resolve()));
  port = (server.address() as { port: number }).port;
});

after(() => {
  try {
    server.close();
  } catch {
    // already closed
  }
});

function testSocketFactory(): () => Socket {
  return () => createSocket("udp4");
}

describe("isavail transport", () => {
  it("sends the wire query and returns the echoed response", async () => {
    received = [];
    respondWith = Buffer.from("% Copyright registro.br\r\nST 0 123456789\r\ndomainhunter.com.br\r\n", "latin1");
    const raw = await queryIsavailRaw("domainhunter.com.br", "2 00000000000000000000 0 123456789 domainhunter.com.br 0", {
      host: "127.0.0.1",
      port,
      timeoutMs: 2_000,
      createSocket: testSocketFactory(),
    });
    assert.match(raw, /ST 0 123456789/);
    assert.equal(received.length, 1);
    assert.equal(received[0]!.toString("latin1"), "2 00000000000000000000 0 123456789 domainhunter.com.br 0");
  });

  it("throws ISAVAIL_TIMEOUT when no reply arrives (RNF-001)", async () => {
    received = [];
    respondWith = null;
    await assert.rejects(
      () =>
        queryIsavailRaw("domainhunter.com.br", "2 00000000000000000000 0 123456789 domainhunter.com.br 0", {
          host: "127.0.0.1",
          port,
          timeoutMs: 300,
          maxAttempts: 1,
          createSocket: testSocketFactory(),
        }),
      (err: unknown) => {
        assert.equal(IsavailError.isIsavailError(err), true);
        if (IsavailError.isIsavailError(err)) {
          assert.equal(err.code, "ISAVAIL_TIMEOUT");
          assert.equal(err.domain, "domainhunter.com.br");
        }
        return true;
      },
    );
  });

  it("re-sends up to maxAttempts before failing with ISAVAIL_TIMEOUT", async () => {
    received = [];
    respondWith = null;
    await assert.rejects(() =>
      queryIsavailRaw("domainhunter.com.br", "q", {
        host: "127.0.0.1",
        port,
        timeoutMs: 100,
        maxAttempts: 3,
        createSocket: testSocketFactory(),
      }),
    );
    assert.equal(received.length, 3);
  });
});
