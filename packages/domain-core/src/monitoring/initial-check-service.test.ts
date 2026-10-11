import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { NormalizedDomainInfo } from "../state-machine/normalize.ts";
import {
  createInitialCheckService,
  type InitialCheckOutcome,
  type InitialCheckProviders,
} from "./initial-check-service.ts";

const NOW = "2026-08-11T12:00:00.000Z";

interface WatchRow {
  id: string;
  status: string;
  rawLastStatus: string | null;
  expirationAt: string | null;
  lastKnownOwner: string | null;
  lastKnownOwnerId: string | null;
  availableSince: string | null;
  releaseStartAt: string | null;
  releaseEndAt: string | null;
  checkFailureCount: number;
  lastCheckAt: string | null;
  lastSuccessfulCheckAt: string | null;
  lastWhoisCheckAt: string | null;
  lastRdapCheckAt: string | null;
  lastIsavailCheckAt: string | null;
  nextCheckAt: string;
  phase: string;
  priority: string;
  clientVersions: Record<string, string> | null;
  domain: string;
}

interface EventRow {
  type: string;
  source: string;
  sourceVersion: string;
  occurredAt: string;
  previousValue: string | null;
  newValue: string | null;
  evidenceJson: string;
  priority: string | null;
}

/** Minimal in-memory repository doubles for the runner. */
function repoDeps() {
  let watch: WatchRow = {
    id: "w1",
    domain: "exemplo.com.br",
    status: "UNKNOWN",
    rawLastStatus: null,
    expirationAt: null,
    lastKnownOwner: null,
    lastKnownOwnerId: null,
    availableSince: null,
    releaseStartAt: null,
    releaseEndAt: null,
    checkFailureCount: 0,
    lastCheckAt: null,
    lastSuccessfulCheckAt: null,
    lastWhoisCheckAt: null,
    lastRdapCheckAt: null,
    lastIsavailCheckAt: null,
    nextCheckAt: NOW,
    phase: "A",
    priority: "LOW",
    clientVersions: null,
  };
  const events: EventRow[] = [];

  const watches = {
    findById: (id: string) => (id === watch.id ? { ...watch } : null),
    update: (id: string, patch: Partial<WatchRow>) => {
      watch = { ...watch, ...patch };
      return { ...watch };
    },
  };
  const store = {
    create: (input: EventRow) => {
      events.push(input);
      return { id: "e" + events.length, ...input };
    },
  };

  return {
    watches,
    store,
    get watch() {
      return watch;
    },
    get events() {
      return events;
    },
  };
}

function whoisObs(partial: Partial<NormalizedDomainInfo> = {}): NormalizedDomainInfo {
  return {
    source: "whois",
    sourceVersion: "whois-client@v1",
    domain: "exemplo.com.br",
    exists: true,
    owner: "Fulano de Tal",
    ownerId: null,
    createdAt: null,
    changedAt: null,
    expiresAt: "2028-09-10T00:00:00.000Z",
    status: [],
    nameServers: [],
    available: false,
    rawLastStatus: "REGISTERED",
    isavailStatusCode: null,
    releaseBeginAt: null,
    releaseEndAt: null,
    tickets: [],
    queriedAt: NOW,
    ...partial,
  };
}

function isavailObs(partial: Partial<NormalizedDomainInfo> = {}): NormalizedDomainInfo {
  return {
    source: "isavail",
    sourceVersion: "isavail-client@v1",
    domain: "exemplo.com.br",
    exists: false,
    owner: null,
    ownerId: null,
    createdAt: null,
    changedAt: null,
    expiresAt: null,
    status: [],
    nameServers: [],
    available: false,
    rawLastStatus: "REGISTERED",
    isavailStatusCode: 2,
    releaseBeginAt: null,
    releaseEndAt: null,
    tickets: [],
    queriedAt: NOW,
    ...partial,
  };
}

/** Raw record shapes the runner normalizes (WHOIS/RDAP/ISAVAIL contracts). */
function rawWhois(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sourceVersion: "whois-client@v1",
    domain: "exemplo.com.br",
    exists: true,
    owner: "Fulano de Tal",
    ownerId: null,
    createdAt: null,
    changedAt: null,
    expiresAt: "2028-09-10T00:00:00.000Z",
    status: [],
    nameServers: [],
    raw: "",
    queriedAt: NOW,
    ...partial,
  };
}

function rawIsavail(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sourceVersion: "isavail-client@v1",
    domain: "exemplo.com.br",
    statusCode: 2,
    status: "REGISTERED",
    available: false,
    expirationDate: null,
    nameServers: [],
    tickets: [],
    releaseBeginAt: null,
    releaseEndAt: null,
    acceptingNewTicketsUntil: null,
    message: null,
    raw: "",
    checkedAt: NOW,
    ...partial,
  };
}

function providersOf(records: NormalizedDomainInfo[]): InitialCheckProviders {
  const providers: InitialCheckProviders = {};
  if (records.some((r) => r.source === "whois")) {
    providers.whois = async () =>
      rawWhois({
        exists: records.find((r) => r.source === "whois")!.exists,
        expiresAt: records.find((r) => r.source === "whois")!.expiresAt,
        owner: records.find((r) => r.source === "whois")!.owner,
        rawLastStatus: records.find((r) => r.source === "whois")!.rawLastStatus,
      }) as never;
  }
  if (records.some((r) => r.source === "rdap")) {
    providers.rdap = async () =>
      ({
        sourceVersion: "rdap-client@v1",
        domain: "exemplo.com.br",
        exists: false,
        createdAt: null,
        changedAt: null,
        expiresAt: null,
        status: [],
        nameServers: [],
        raw: {},
        queriedAt: NOW,
      }) as never;
  }
  if (records.some((r) => r.source === "isavail")) {
    providers.isavail = async () =>
      rawIsavail({
        available: records.find((r) => r.source === "isavail")!.available,
        statusCode: records.find((r) => r.source === "isavail")!.isavailStatusCode ?? 2,
        status: records.find((r) => r.source === "isavail")!.rawLastStatus ?? "REGISTERED",
        expirationDate: records.find((r) => r.source === "isavail")!.expiresAt,
      }) as never;
  }
  return providers;
}

async function run(providers: InitialCheckProviders): Promise<{
  outcome: InitialCheckOutcome;
  watch: WatchRow;
  events: EventRow[];
}> {
  const repo = repoDeps();
  const service = createInitialCheckService({
    watches: repo.watches as never,
    events: repo.store as never,
    clock: () => NOW,
  });
  const outcome = await service.run({ watchId: "w1", providers });
  return { outcome, watch: repo.watch, events: repo.events };
}

describe("createInitialCheckService", () => {
  it("stores the cadastral expiry and computes next_check_at for a registered domain (AC02/AC03)", async () => {
    const { outcome, watch, events } = await run(
      providersOf([whoisObs(), isavailObs()]),
    );
    assert.equal(outcome.watch?.status, "REGISTERED");
    assert.equal(watch.expirationAt, "2028-09-10T00:00:00.000Z");
    assert.equal(watch.lastKnownOwner, "Fulano de Tal");
    assert.equal(watch.phase, "A");
    assert.equal(watch.nextCheckAt, "2026-08-12T12:00:00.000Z"); // +24h
    assert.deepEqual(watch.clientVersions, {
      whois: "whois-client@v1",
      isavail: "isavail-client@v1",
    });
    assert.deepEqual(outcome.sources, { whois: "ok", rdap: "skipped", isavail: "ok" });
    assert.ok(events.some((e) => e.type === "DOMAIN_STATUS_CHANGED"));
  });

  it("reaches AVAILABLE only through a valid ISAVAIL reply (AC05)", async () => {
    const { watch, outcome } = await run(
      providersOf([
        whoisObs({ exists: false, expiresAt: null, rawLastStatus: "NOT_FOUND" }),
        isavailObs({ available: true, isavailStatusCode: 0, rawLastStatus: "AVAILABLE" }),
      ]),
    );
    assert.equal(outcome.watch?.status, "AVAILABLE");
    assert.equal(watch.priority, "CRITICAL");
    assert.equal(watch.phase, "E");
    assert.ok(watch.availableSince);
  });

  it("never produces AVAILABLE from an expiry date when ISAVAIL fails (AC06)", async () => {
    const failing = async (): Promise<never> => {
      throw new Error("ISAVAIL_TIMEOUT");
    };
    const { watch, outcome } = await run({
      whois: async () => whoisObs() as never,
      isavail: failing as never,
    });
    assert.notEqual(outcome.watch?.status, "AVAILABLE");
    assert.equal(watch.status, "REGISTERED");
    assert.equal(watch.expirationAt, "2028-09-10T00:00:00.000Z");
    assert.equal(watch.checkFailureCount, 0);
    assert.equal(outcome.sources.isavail, "error");
    assert.equal(outcome.technicalFailure, false);
  });

  it("preserves the confirmed state and records CHECK_FAILED when every source fails (RN07/AC09)", async () => {
    const failing = async (): Promise<never> => {
      throw new Error("SOURCE_UNAVAILABLE");
    };
    const { watch, events, outcome } = await run({
      whois: failing as never,
      rdap: failing as never,
      isavail: failing as never,
    });
    assert.equal(outcome.watch?.status, "UNKNOWN");
    assert.equal(watch.checkFailureCount, 1);
    assert.equal(outcome.technicalFailure, true);
    assert.ok(events.some((e) => e.type === "CHECK_FAILED"));
  });
});
