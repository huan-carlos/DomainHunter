import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { createWhoisClientV1 } from "./client.ts";
import { WhoisError } from "./errors.ts";
import { loadFixture } from "./fixtures/load.ts";

interface TestServer {
  port: number;
  close: () => Promise<void>;
}

function startServer(handler: (socket: Socket) => void): Promise<TestServer> {
  const server: Server = createServer(handler);
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve({
        port,
        close: () =>
          new Promise((res) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => res());
          }),
      });
    });
  });
}

function respondWith(fixture: string) {
  return (socket: Socket): void => {
    socket.on("data", () => {
      socket.write(fixture);
      socket.end();
    });
  };
}

const registeredFixture = loadFixture("registered");
const notFoundFixture = loadFixture("not-found");
const rateLimitFixture = loadFixture("rate-limit");
const invalidFixture = loadFixture("invalid");

const servers: TestServer[] = [];

after(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

describe("whois client v1 transport (contract tests over real TCP)", () => {
  it("queries a registered domain and returns the parsed, typed record", async () => {
    const server = await startServer(respondWith(registeredFixture));
    servers.push(server);

    const client = createWhoisClientV1({
      host: "127.0.0.1",
      port: server.port,
      timeoutMs: 2000,
      clock: () => "2026-08-11T19:00:00.000Z",
    });

    const record = await client.query("domainhunter.com.br");
    assert.equal(record.exists, true);
    assert.equal(record.sourceVersion, "whois-client@v1");
    assert.equal(record.expiresAt, "2028-09-10T00:00:00.000Z");
    assert.equal(record.raw, registeredFixture);
  });

  it("returns a non-existent record for a 'no match' reply", async () => {
    const server = await startServer(respondWith(notFoundFixture));
    servers.push(server);

    const client = createWhoisClientV1({
      host: "127.0.0.1",
      port: server.port,
      timeoutMs: 2000,
    });

    const record = await client.query("nao-existe.com.br");
    assert.equal(record.exists, false);
    assert.equal(record.expiresAt, null);
  });

  it("surfaces RATE_LIMIT for a rate-limited reply", async () => {
    const server = await startServer(respondWith(rateLimitFixture));
    servers.push(server);

    const client = createWhoisClientV1({
      host: "127.0.0.1",
      port: server.port,
      timeoutMs: 2000,
    });

    await assert.rejects(client.query("domainhunter.com.br"), (err: unknown) => {
      assert.ok(err instanceof WhoisError);
      assert.equal(err.code, "RATE_LIMIT");
      return true;
    });
  });

  it("surfaces PARSER_ERROR for an invalid response", async () => {
    const server = await startServer(respondWith(invalidFixture));
    servers.push(server);

    const client = createWhoisClientV1({
      host: "127.0.0.1",
      port: server.port,
      timeoutMs: 2000,
    });

    await assert.rejects(client.query("domainhunter.com.br"), (err: unknown) => {
      assert.ok(err instanceof WhoisError);
      assert.equal(err.code, "PARSER_ERROR");
      return true;
    });
  });

  it("surfaces WHOIS_TIMEOUT when the server never answers", async () => {
    const server = await startServer(() => {
      // Accept the connection and hold it open without responding.
    });
    servers.push(server);

    const client = createWhoisClientV1({
      host: "127.0.0.1",
      port: server.port,
      timeoutMs: 120,
    });

    await assert.rejects(client.query("domainhunter.com.br"), (err: unknown) => {
      assert.ok(err instanceof WhoisError);
      assert.equal(err.code, "WHOIS_TIMEOUT");
      return true;
    });
  });

  it("surfaces SOURCE_UNAVAILABLE when the port is refused", async () => {
    const server = await startServer(() => {});
    const closedPort = server.port;
    await server.close();

    const client = createWhoisClientV1({
      host: "127.0.0.1",
      port: closedPort,
      timeoutMs: 1000,
    });

    await assert.rejects(client.query("domainhunter.com.br"), (err: unknown) => {
      assert.ok(err instanceof WhoisError);
      assert.equal(err.code, "SOURCE_UNAVAILABLE");
      return true;
    });
  });

  it("uses the default Registro.br endpoint (whois.registro.br:43)", () => {
    const client = createWhoisClientV1();
    const probe = createWhoisClientV1({ host: "whois.registro.br", port: 43 });
    assert.ok(client);
    assert.ok(probe);
  });
});
