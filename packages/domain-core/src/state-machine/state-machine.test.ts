import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { NormalizedDomainInfo } from "./normalize.ts";
import {
  DOMAIN_STATE_MACHINE_VERSION,
  transitionDomainState,
  priorityForState,
  type DomainStateSnapshot,
  type DomainStateTransition,
} from "./state-machine.ts";

const NOW = "2026-08-11T00:00:00.000Z";

function whois(partial: Partial<NormalizedDomainInfo> = {}): NormalizedDomainInfo {
  return {
    source: "whois",
    sourceVersion: "whois-client@v1",
    domain: "exemplo.com.br",
    exists: true,
    owner: "Fulano de Tal",
    ownerId: null,
    createdAt: "2020-01-01T00:00:00.000Z",
    changedAt: null,
    expiresAt: null,
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

function isavail(partial: Partial<NormalizedDomainInfo> = {}): NormalizedDomainInfo {
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

function snapshot(partial: Partial<DomainStateSnapshot> = {}): DomainStateSnapshot {
  return {
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
    ...partial,
  };
}

function run(input: Omit<DomainStateTransition, "now">) {
  return transitionDomainState({ now: NOW, ...input });
}

function eventTypes(events: { type: string }[]): string[] {
  return events.map((e) => e.type);
}

describe("transitionDomainState — cadastral lifecycle", () => {
  it("moves UNKNOWN → REGISTERED from a confirmed whois expiry in the future", () => {
    const { next, events, stateChanged } = run({
      current: snapshot(),
      observations: [whois({ expiresAt: "2030-01-01T00:00:00.000Z" })],
    });
    assert.equal(next.status, "REGISTERED");
    assert.equal(stateChanged, true);
    assert.ok(eventTypes(events).includes("DOMAIN_STATUS_CHANGED"));
  });

  it("moves REGISTERED → EXPIRATION_APPROACHING within the 45-day window", () => {
    const { next, events } = run({
      current: snapshot({ status: "REGISTERED", expirationAt: "2026-09-01T00:00:00.000Z" }),
      observations: [whois({ expiresAt: "2026-09-01T00:00:00.000Z" })],
    });
    assert.equal(next.status, "EXPIRATION_APPROACHING");
    assert.ok(eventTypes(events).includes("DOMAIN_APPROACHING_EXPIRATION"));
  });

  it("moves EXPIRATION_APPROACHING → POST_EXPIRATION_MONITORING once the date passes", () => {
    const { next, events } = run({
      current: snapshot({
        status: "EXPIRATION_APPROACHING",
        expirationAt: "2026-08-01T00:00:00.000Z",
      }),
      observations: [whois({ expiresAt: "2026-08-01T00:00:00.000Z" })],
    });
    assert.equal(next.status, "POST_EXPIRATION_MONITORING");
    assert.ok(eventTypes(events).includes("DOMAIN_POST_EXPIRATION"));
  });

  it("treats expiry exactly at now as expired", () => {
    const { next } = run({
      current: snapshot({ status: "REGISTERED", expirationAt: NOW }),
      observations: [whois({ expiresAt: NOW })],
    });
    assert.equal(next.status, "POST_EXPIRATION_MONITORING");
  });

  it("does not move out of RELEASE_PROCESS on cadastral expiry data", () => {
    const { next } = run({
      current: snapshot({ status: "RELEASE_PROCESS", expirationAt: "2026-07-01T00:00:00.000Z" }),
      observations: [whois({ expiresAt: "2026-07-01T00:00:00.000Z" })],
    });
    assert.equal(next.status, "RELEASE_PROCESS");
  });
});

describe("transitionDomainState — renewal (AC04)", () => {
  it("signals DOMAIN_RENEWED on a positive confirmed expiry increase", () => {
    const { next, events } = run({
      current: snapshot({
        status: "REGISTERED",
        expirationAt: "2027-01-01T00:00:00.000Z",
      }),
      observations: [whois({ expiresAt: "2028-01-01T00:00:00.000Z" })],
    });
    assert.equal(next.status, "RENEWED");
    assert.equal(next.expirationAt, "2028-01-01T00:00:00.000Z");
    const renewed = events.find((e) => e.type === "DOMAIN_RENEWED");
    assert.ok(renewed);
    assert.equal(renewed!.previousValue, "2027-01-01T00:00:00.000Z");
    assert.equal(renewed!.newValue, "2028-01-01T00:00:00.000Z");
    assert.ok(eventTypes(events).includes("DOMAIN_EXPIRATION_CHANGED"));
  });

  it("does not signal a renewal when the expiry is unchanged", () => {
    const { next, events } = run({
      current: snapshot({ status: "REGISTERED", expirationAt: "2028-01-01T00:00:00.000Z" }),
      observations: [whois({ expiresAt: "2028-01-01T00:00:00.000Z" })],
    });
    assert.equal(next.status, "REGISTERED");
    assert.ok(!eventTypes(events).includes("DOMAIN_RENEWED"));
    assert.ok(!eventTypes(events).includes("DOMAIN_EXPIRATION_CHANGED"));
  });

  it("records an earlier expiry as EXPIRATION_CHANGED without RENEWED", () => {
    const { next, events } = run({
      current: snapshot({ status: "REGISTERED", expirationAt: "2028-01-01T00:00:00.000Z" }),
      observations: [whois({ expiresAt: "2027-01-01T00:00:00.000Z" })],
    });
    assert.equal(next.expirationAt, "2027-01-01T00:00:00.000Z");
    assert.ok(!eventTypes(events).includes("DOMAIN_RENEWED"));
    assert.ok(eventTypes(events).includes("DOMAIN_EXPIRATION_CHANGED"));
  });

  it("resolves RENEWED back to REGISTERED on the next stable check", () => {
    const { next, events } = run({
      current: snapshot({ status: "RENEWED", expirationAt: "2028-01-01T00:00:00.000Z" }),
      observations: [whois({ expiresAt: "2028-01-01T00:00:00.000Z" })],
    });
    assert.equal(next.status, "REGISTERED");
    assert.ok(!eventTypes(events).includes("DOMAIN_RENEWED"));
  });
});

describe("transitionDomainState — availability (AC05)", () => {
  it("reaches AVAILABLE only through a valid ISAVAIL response", () => {
    const { next, events, stateChanged } = run({
      current: snapshot({ status: "REGISTERED", expirationAt: "2030-01-01T00:00:00.000Z" }),
      observations: [isavail({ isavailStatusCode: 0, available: true, rawLastStatus: "AVAILABLE" })],
    });
    assert.equal(next.status, "AVAILABLE");
    assert.equal(stateChanged, true);
    assert.equal(next.availableSince, NOW);
    const available = events.find((e) => e.type === "DOMAIN_AVAILABLE");
    assert.ok(available);
    assert.equal(available!.priority, "CRITICAL");
  });

  it("records availableSince only once", () => {
    const first = run({
      current: snapshot({ status: "REGISTERED" }),
      observations: [isavail({ isavailStatusCode: 0, available: true })],
    }).next;
    const second = run({
      current: first,
      observations: [isavail({ isavailStatusCode: 0, available: true })],
    }).next;
    assert.equal(second.availableSince, NOW);
    assert.equal(second.status, "AVAILABLE");
  });

  it("never derives AVAILABLE from a cadastral reply (AC06)", () => {
    const { next, events } = run({
      current: snapshot(),
      observations: [whois({ exists: false, expiresAt: "2026-07-01T00:00:00.000Z", rawLastStatus: "NOT_FOUND" })],
    });
    assert.notEqual(next.status, "AVAILABLE");
    assert.equal(next.status, "POST_EXPIRATION_MONITORING");
    assert.ok(!eventTypes(events).includes("DOMAIN_AVAILABLE"));
  });
});

describe("transitionDomainState — expiry without availability (AC06)", () => {
  it("keeps the domain not-available when ISAVAIL still reports it registered after expiry", () => {
    const { next, events } = run({
      current: snapshot({
        status: "EXPIRATION_APPROACHING",
        expirationAt: "2026-08-01T00:00:00.000Z",
      }),
      observations: [
        whois({ expiresAt: "2026-08-01T00:00:00.000Z" }),
        isavail({ isavailStatusCode: 2, available: false, rawLastStatus: "REGISTERED" }),
      ],
    });
    assert.equal(next.status, "POST_EXPIRATION_MONITORING");
    assert.notEqual(next.status, "AVAILABLE");
    assert.ok(!eventTypes(events).includes("DOMAIN_AVAILABLE"));
  });

  it("never produces AVAILABLE when the expiry passed with no availability signal", () => {
    const { next } = run({
      current: snapshot({ status: "REGISTERED", expirationAt: "2026-08-01T00:00:00.000Z" }),
      observations: [whois({ expiresAt: "2026-08-01T00:00:00.000Z" })],
    });
    assert.equal(next.status, "POST_EXPIRATION_MONITORING");
    assert.notEqual(next.status, "AVAILABLE");
  });
});

describe("transitionDomainState — technical failure preserves confirmed state (RNF-001)", () => {
  it("keeps the confirmed state and increments failure count on a failed check", () => {
    const { next, events, stateChanged } = run({
      current: snapshot({ status: "REGISTERED", expirationAt: "2028-01-01T00:00:00.000Z" }),
      observations: [],
      checkFailed: true,
      checkFailureMessage: "timeout",
    });
    assert.equal(next.status, "REGISTERED");
    assert.equal(stateChanged, false);
    assert.equal(next.checkFailureCount, 1);
    const failed = events.find((e) => e.type === "CHECK_FAILED");
    assert.ok(failed);
    assert.equal(failed!.newValue, "timeout");
  });

  it("does not report AVAILABLE for an unknown ISAVAIL code", () => {
    const { next, events, stateChanged } = run({
      current: snapshot({ status: "REGISTERED", expirationAt: "2028-01-01T00:00:00.000Z" }),
      observations: [isavail({ isavailStatusCode: -1, available: false, rawLastStatus: "SOMETHING_WEIRD" })],
    });
    assert.equal(next.status, "REGISTERED");
    assert.equal(stateChanged, false);
    assert.ok(!eventTypes(events).includes("DOMAIN_AVAILABLE"));
  });

  it("keeps a confirmed AVAILABLE through a technical availability reply", () => {
    const { next, events } = run({
      current: snapshot({ status: "AVAILABLE", availableSince: NOW }),
      observations: [isavail({ isavailStatusCode: 8, available: false, rawLastStatus: "ERROR" })],
    });
    assert.equal(next.status, "AVAILABLE");
    assert.equal(next.availableSince, NOW);
    assert.ok(!eventTypes(events).includes("DOMAIN_AVAILABLE"));
  });

  it("keeps a confirmed AVAILABLE when no availability signal arrives", () => {
    const { next } = run({
      current: snapshot({ status: "AVAILABLE", availableSince: NOW }),
      observations: [whois({ expiresAt: "2030-01-01T00:00:00.000Z" })],
    });
    assert.equal(next.status, "AVAILABLE");
  });
});

describe("transitionDomainState — ISAVAIL release states", () => {
  it("maps status 5 to RELEASE_PENDING with DOMAIN_RELEASE_DETECTED", () => {
    const { next, events } = run({
      current: snapshot({ status: "POST_EXPIRATION_MONITORING", expirationAt: "2026-08-01T00:00:00.000Z" }),
      observations: [isavail({ isavailStatusCode: 5, available: false, rawLastStatus: "RELEASE_PROCESS_WAITING" })],
    });
    assert.equal(next.status, "RELEASE_PENDING");
    assert.ok(eventTypes(events).includes("DOMAIN_RELEASE_DETECTED"));
  });

  it("maps status 6 to RELEASE_PROCESS and records the release window", () => {
    const { next, events } = run({
      current: snapshot({ status: "RELEASE_PENDING" }),
      observations: [
        isavail({
          isavailStatusCode: 6,
          available: false,
          rawLastStatus: "AVAILABLE_RELEASE_IN_PROGRESS",
          releaseBeginAt: "2026-09-01T00:00:00.000Z",
          releaseEndAt: "2026-10-01T00:00:00.000Z",
        }),
      ],
    });
    assert.equal(next.status, "RELEASE_PROCESS");
    assert.equal(next.releaseStartAt, "2026-09-01T00:00:00.000Z");
    assert.equal(next.releaseEndAt, "2026-10-01T00:00:00.000Z");
    assert.ok(eventTypes(events).includes("DOMAIN_ENTERED_RELEASE"));
  });

  it("maps status 9 to COMPETITIVE_RELEASE with COMPETITIVE_PROCESS_DETECTED", () => {
    const { next, events } = run({
      current: snapshot({ status: "RELEASE_PROCESS" }),
      observations: [isavail({ isavailStatusCode: 9, available: false, rawLastStatus: "COMPETITIVE_RELEASE" })],
    });
    assert.equal(next.status, "COMPETITIVE_RELEASE");
    assert.ok(eventTypes(events).includes("COMPETITIVE_PROCESS_DETECTED"));
  });

  it("promotes a competitive release directly to AVAILABLE on a later valid reply", () => {
    const { next } = run({
      current: snapshot({ status: "COMPETITIVE_RELEASE" }),
      observations: [isavail({ isavailStatusCode: 0, available: true, rawLastStatus: "AVAILABLE" })],
    });
    assert.equal(next.status, "AVAILABLE");
  });
});

describe("transitionDomainState — leaving AVAILABLE", () => {
  it("drops AVAILABLE when ISAVAIL confirms the name is registered again", () => {
    const { next, events } = run({
      current: snapshot({ status: "AVAILABLE", availableSince: "2026-08-01T00:00:00.000Z" }),
      observations: [
        whois({ expiresAt: "2030-01-01T00:00:00.000Z" }),
        isavail({ isavailStatusCode: 2, available: false, rawLastStatus: "REGISTERED" }),
      ],
    });
    assert.equal(next.status, "REGISTERED");
    assert.equal(next.availableSince, null);
    assert.ok(eventTypes(events).includes("DOMAIN_UNAVAILABLE"));
    assert.ok(eventTypes(events).includes("DOMAIN_STATUS_CHANGED"));
  });
});

describe("transitionDomainState — raw status and metadata preservation", () => {
  it("preserves the ISAVAIL raw status in rawLastStatus", () => {
    const { next } = run({
      current: snapshot({ status: "REGISTERED" }),
      observations: [isavail({ isavailStatusCode: 2, available: false, rawLastStatus: "REGISTERED" })],
    });
    assert.equal(next.rawLastStatus, "REGISTERED");
  });

  it("records owner facts from cadastral sources", () => {
    const { next } = run({
      current: snapshot(),
      observations: [whois({ owner: "Fulano de Tal", expiresAt: "2030-01-01T00:00:00.000Z" })],
    });
    assert.equal(next.lastKnownOwner, "Fulano de Tal");
  });

  it("tracks per-source check timestamps", () => {
    const { next } = run({
      current: snapshot(),
      observations: [
        whois({ expiresAt: "2030-01-01T00:00:00.000Z" }),
        isavail({ isavailStatusCode: 2, available: false }),
      ],
    });
    assert.equal(next.lastWhoisCheckAt, NOW);
    assert.equal(next.lastIsavailCheckAt, NOW);
    assert.equal(next.lastSuccessfulCheckAt, NOW);
  });
});

describe("transitionDomainState — event evidence (AC10)", () => {
  it("attaches normalized evidence to every event", () => {
    const { events } = run({
      current: snapshot({ status: "REGISTERED", expirationAt: "2030-01-01T00:00:00.000Z" }),
      observations: [isavail({ isavailStatusCode: 0, available: true, rawLastStatus: "AVAILABLE" })],
    });
    for (const event of events) {
      const evidence = JSON.parse(event.evidenceJson);
      assert.ok(Array.isArray(evidence));
      assert.equal(evidence[0].domain, "exemplo.com.br");
      assert.equal(evidence[0].source, "isavail");
    }
  });
});

describe("priorityForState", () => {
  it("classifies AVAILABLE as CRITICAL and monitoring states below it", () => {
    assert.equal(priorityForState("AVAILABLE"), "CRITICAL");
    assert.equal(priorityForState("RELEASE_PROCESS"), "HIGH");
    assert.equal(priorityForState("POST_EXPIRATION_MONITORING"), "HIGH");
    assert.equal(priorityForState("EXPIRATION_APPROACHING"), "MEDIUM");
    assert.equal(priorityForState("REGISTERED"), "LOW");
  });
});

describe("transitionDomainState — contract", () => {
  it("is versioned and pure (no I/O)", () => {
    assert.equal(DOMAIN_STATE_MACHINE_VERSION, "state-machine@v1");
  });
});
