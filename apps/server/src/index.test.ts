import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import { createDefaultApp, createLexServer } from "./index.ts";

async function startServer(): Promise<{ server: Server; port: number }> {
  const server = createLexServer({
    port: 0,
    app: createDefaultApp({ databasePath: ":memory:" }),
  });
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, port: address.port };
}

test("GET /health returns 200 ok", async () => {
  const { server, port } = await startServer();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status?: string };
    assert.equal(body.status, "ok");
  } finally {
    server.close();
  }
});

test("GET /unknown returns 404", async () => {
  const { server, port } = await startServer();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});
