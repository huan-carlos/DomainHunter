import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRdapClientV1 } from "./client.ts";
import { RdapError } from "./errors.ts";
import { loadFixture } from "./fixtures/load.ts";

const QUERIED_AT = "2026-08-11T19:00:00.000Z";

describe("rdap client v1 (contract tests over real HTTP)", () => {
  let server: Server;
  let baseUrl: string;
  let handler: (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ) => void;

  before(async () => {
    server = createServer((req, res) => handler(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  function stubHandler(
    next: (
      req: import("node:http").IncomingMessage,
      res: import("node:http").ServerResponse,
    ) => void,
  ) {
    handler = next;
  }

  it("returns a normalized typed result for a registered domain", async () => {
    const raw = loadFixture("registered");
    stubHandler((req, res) => {
      assert.equal(req.url, "/domain/domainhunter.com.br");
      res.writeHead(200, { "content-type": "application/rdap+json" });
      res.end(raw);
    });

    const client = createRdapClientV1({
      baseUrl,
      clock: () => QUERIED_AT,
    });

    const result = await client.query("domainhunter.com.br");

    assert.equal(result.source, "rdap");
    assert.equal(result.sourceVersion, "rdap-client@v1");
    assert.equal(result.domain, "domainhunter.com.br");
    assert.equal(result.exists, true);
    assert.equal(result.ldhName, "domainhunter.com.br");
    assert.equal(result.createdAt, "2022-04-15T12:00:00Z");
    assert.equal(result.expiresAt, "2028-09-10T12:00:00Z");
    assert.equal(result.queriedAt, QUERIED_AT);
    assert.equal(result.raw, raw);
  });

  it("treats HTTP 404 as a non-existent record", async () => {
    stubHandler((_req, res) => {
      res.writeHead(404, { "content-type": "application/rdap+json" });
      res.end();
    });

    const client = createRdapClientV1({ baseUrl, clock: () => QUERIED_AT });

    const result = await client.query("nao-existe-domainhunter-test.com.br");

    assert.equal(result.exists, false);
    assert.equal(result.domain, "nao-existe-domainhunter-test.com.br");
    assert.equal(result.handle, null);
    assert.deepEqual(result.status, []);
  });

  it("surfaces RDAP_TIMEOUT when the server never answers", async () => {
    stubHandler(() => {
      // Never respond: let the client timeout fire.
    });

    const client = createRdapClientV1({ baseUrl, timeoutMs: 50, clock: () => QUERIED_AT });

    await assert.rejects(
      () => client.query("domainhunter.com.br"),
      (err: unknown) => {
        assert.ok(err instanceof RdapError);
        assert.equal(err.code, "RDAP_TIMEOUT");
        assert.equal(err.domain, "domainhunter.com.br");
        return true;
      },
    );
  });

  it("surfaces PARSER_ERROR for a malformed JSON response", async () => {
    stubHandler((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{ this is not json");
    });

    const client = createRdapClientV1({ baseUrl, clock: () => QUERIED_AT });

    await assert.rejects(
      () => client.query("domainhunter.com.br"),
      (err: unknown) => {
        assert.ok(err instanceof RdapError);
        assert.equal(err.code, "PARSER_ERROR");
        return true;
      },
    );
  });

  it("surfaces SOURCE_UNAVAILABLE for a non-2xx/404 HTTP status", async () => {
    stubHandler((_req, res) => {
      res.writeHead(503, { "content-type": "text/plain" });
      res.end("service unavailable");
    });

    const client = createRdapClientV1({ baseUrl, clock: () => QUERIED_AT });

    await assert.rejects(
      () => client.query("domainhunter.com.br"),
      (err: unknown) => {
        assert.ok(err instanceof RdapError);
        assert.equal(err.code, "SOURCE_UNAVAILABLE");
        assert.equal(err.status, 503);
        return true;
      },
    );
  });

  it("surfaces RATE_LIMIT on HTTP 429", async () => {
    stubHandler((_req, res) => {
      res.writeHead(429, { "content-type": "text/plain" });
      res.end("too many requests");
    });

    const client = createRdapClientV1({ baseUrl, clock: () => QUERIED_AT });

    await assert.rejects(
      () => client.query("domainhunter.com.br"),
      (err: unknown) => {
        assert.ok(err instanceof RdapError);
        assert.equal(err.code, "RATE_LIMIT");
        return true;
      },
    );
  });

  it("uses the default Registro.br endpoint", async () => {
    const client = createRdapClientV1();
    assert.equal(typeof client.query, "function");
  });
});
