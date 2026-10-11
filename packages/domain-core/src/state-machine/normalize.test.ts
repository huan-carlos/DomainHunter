import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DOMAIN_NORMALIZATION_VERSION,
  normalizeIsavailRecord,
  normalizeRdapResult,
  normalizeWhoisRecord,
} from "./normalize.ts";

const WHOIS = {
  sourceVersion: "whois-client@v1",
  domain: "exemplo.com.br",
  exists: true,
  owner: "Fulano de Tal",
  ownerId: "000.000.000-00",
  createdAt: "2020-01-01T00:00:00.000Z",
  changedAt: "2024-05-05T00:00:00.000Z",
  expiresAt: "2026-12-31T00:00:00.000Z",
  status: ["published"],
  nameServers: ["ns1.dominio.com.br"],
  raw: "raw whois",
  queriedAt: "2026-08-11T00:00:00.000Z",
};

describe("normalizeWhoisRecord", () => {
  it("maps a whois record into the common model", () => {
    const n = normalizeWhoisRecord(WHOIS);
    assert.equal(n.source, "whois");
    assert.equal(n.sourceVersion, "whois-client@v1");
    assert.equal(n.domain, "exemplo.com.br");
    assert.equal(n.exists, true);
    assert.equal(n.owner, "Fulano de Tal");
    assert.equal(n.ownerId, "000.000.000-00");
    assert.equal(n.expiresAt, "2026-12-31T00:00:00.000Z");
    assert.equal(n.createdAt, "2020-01-01T00:00:00.000Z");
    assert.deepEqual(n.status, ["published"]);
    assert.equal(n.rawLastStatus, "published");
  });

  it("never marks a cadastral source as available (AC06)", () => {
    const n = normalizeWhoisRecord(WHOIS);
    assert.equal(n.available, false);
    assert.equal(n.isavailStatusCode, null);
  });

  it("marks non-existent domains with NOT_FOUND raw status", () => {
    const n = normalizeWhoisRecord({ ...WHOIS, exists: false, status: [] });
    assert.equal(n.exists, false);
    assert.equal(n.rawLastStatus, "NOT_FOUND");
  });

  it("falls back to REGISTERED raw status when no status codes are published", () => {
    const n = normalizeWhoisRecord({ ...WHOIS, status: [] });
    assert.equal(n.rawLastStatus, "REGISTERED");
  });

  it("is versioned (RNF-016)", () => {
    assert.equal(DOMAIN_NORMALIZATION_VERSION, "domain-normalization@v1");
  });
});

const RDAP = {
  sourceVersion: "rdap-client@v1",
  domain: "exemplo.com.br",
  exists: true,
  createdAt: "2020-01-01T00:00:00.000Z",
  changedAt: "2024-05-05T00:00:00.000Z",
  expiresAt: "2026-12-31T00:00:00.000Z",
  status: ["active"],
  nameServers: ["ns1.dominio.com.br"],
  raw: {},
  queriedAt: "2026-08-11T00:00:00.000Z",
};

describe("normalizeRdapResult", () => {
  it("maps an rdap result into the common model", () => {
    const n = normalizeRdapResult(RDAP);
    assert.equal(n.source, "rdap");
    assert.equal(n.expiresAt, "2026-12-31T00:00:00.000Z");
    assert.deepEqual(n.status, ["active"]);
    assert.equal(n.rawLastStatus, "active");
  });

  it("is never a source of availability", () => {
    const n = normalizeRdapResult(RDAP);
    assert.equal(n.available, false);
  });

  it("surfaces NOT_FOUND for missing domains", () => {
    const n = normalizeRdapResult({ ...RDAP, exists: false, status: [] });
    assert.equal(n.rawLastStatus, "NOT_FOUND");
  });
});

describe("normalizeIsavailRecord", () => {
  const base = {
    sourceVersion: "isavail-client@v1",
    domain: "exemplo.com.br",
    statusCode: 0,
    status: "AVAILABLE",
    available: true,
    expirationDate: null,
    nameServers: [],
    tickets: [],
    releaseBeginAt: null,
    releaseEndAt: null,
    acceptingNewTicketsUntil: null,
    message: null,
    raw: "ST 0 1 exemplo.com.br",
    checkedAt: "2026-08-11T00:00:00.000Z",
  };

  it("carries the availability verdict and raw status", () => {
    const n = normalizeIsavailRecord(base);
    assert.equal(n.source, "isavail");
    assert.equal(n.available, true);
    assert.equal(n.rawLastStatus, "AVAILABLE");
    assert.equal(n.isavailStatusCode, 0);
    assert.equal(n.queriedAt, "2026-08-11T00:00:00.000Z");
  });

  it("preserves the expiration date published for registered names", () => {
    const n = normalizeIsavailRecord({
      ...base,
      statusCode: 2,
      status: "REGISTERED",
      available: false,
      expirationDate: "2026-12-31T00:00:00.000Z",
      nameServers: ["ns1.dominio.com.br"],
    });
    assert.equal(n.available, false);
    assert.equal(n.expiresAt, "2026-12-31T00:00:00.000Z");
  });

  it("carries release process dates and tickets", () => {
    const n = normalizeIsavailRecord({
      ...base,
      statusCode: 6,
      status: "AVAILABLE_RELEASE_IN_PROGRESS",
      available: false,
      releaseBeginAt: "2026-09-01T00:00:00.000Z",
      releaseEndAt: "2026-10-01T00:00:00.000Z",
      tickets: ["ticket-1"],
    });
    assert.equal(n.available, false);
    assert.equal(n.releaseBeginAt, "2026-09-01T00:00:00.000Z");
    assert.equal(n.releaseEndAt, "2026-10-01T00:00:00.000Z");
    assert.deepEqual(n.tickets, ["ticket-1"]);
  });

  it("never normalizes a technical/unknown reply as available", () => {
    for (const statusCode of [3, 4, 5, 8, 9]) {
      const n = normalizeIsavailRecord({ ...base, statusCode, status: "X", available: false });
      assert.equal(n.available, false, `status ${statusCode} must not be available`);
    }
  });
});
