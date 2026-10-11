import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ISAVAIL_MAPPING_VERSION,
  mapIsavailStatusToDomainState,
} from "./isavail.ts";
import type { DomainWatchStatus } from "../entities/domain-watch.ts";

describe("mapIsavailStatusToDomainState (technical plan §308-328)", () => {
  it("maps status 0 (AVAILABLE) to AVAILABLE", () => {
    assert.equal(mapIsavailStatusToDomainState(0), "AVAILABLE");
  });

  it("maps status 1 (AVAILABLE_WITH_TICKET) to AVAILABLE", () => {
    assert.equal(mapIsavailStatusToDomainState(1), "AVAILABLE");
  });

  it("maps status 2 (REGISTERED) to REGISTERED", () => {
    assert.equal(mapIsavailStatusToDomainState(2), "REGISTERED");
  });

  it("maps status 3 (UNAVAILABLE/reserved) to REGISTERED", () => {
    assert.equal(mapIsavailStatusToDomainState(3), "REGISTERED");
  });

  it("maps status 5 (RELEASE_PROCESS_WAITING) to RELEASE_PENDING", () => {
    assert.equal(mapIsavailStatusToDomainState(5), "RELEASE_PENDING");
  });

  it("maps statuses 6/7 (release in progress) to RELEASE_PROCESS", () => {
    assert.equal(mapIsavailStatusToDomainState(6), "RELEASE_PROCESS");
    assert.equal(mapIsavailStatusToDomainState(7), "RELEASE_PROCESS");
  });

  it("maps status 9 (COMPETITIVE_RELEASE) to COMPETITIVE_RELEASE", () => {
    assert.equal(mapIsavailStatusToDomainState(9), "COMPETITIVE_RELEASE");
  });

  it("maps status 4 (INVALID_QUERY) to the technical CHECK_FAILED, never AVAILABLE", () => {
    assert.equal(mapIsavailStatusToDomainState(4), "CHECK_FAILED");
  });

  it("maps status 8 (ERROR) to the technical CHECK_FAILED, never AVAILABLE", () => {
    assert.equal(mapIsavailStatusToDomainState(8), "CHECK_FAILED");
  });

  it("maps unrecognized status codes to UNKNOWN, never AVAILABLE (RNF-020)", () => {
    for (const code of [-1, 10, 42, Number.NaN]) {
      const state = mapIsavailStatusToDomainState(code);
      assert.equal(state, "UNKNOWN");
      assert.notEqual(state, "AVAILABLE");
    }
  });

  it("never maps a non-0/1 code to AVAILABLE", () => {
    const codes = [2, 3, 4, 5, 6, 7, 8, 9];
    for (const code of codes) {
      assert.notEqual(mapIsavailStatusToDomainState(code), "AVAILABLE");
    }
  });

  it("produces only valid DomainWatchStatus values", () => {
    const valid: DomainWatchStatus[] = [
      "REGISTERED",
      "EXPIRATION_APPROACHING",
      "POST_EXPIRATION_MONITORING",
      "RELEASE_PENDING",
      "RELEASE_PROCESS",
      "AVAILABLE",
      "RENEWED",
      "UNKNOWN",
      "CHECK_FAILED",
      "COMPETITIVE_RELEASE",
      "MONITORING_STOPPED",
    ];
    for (let code = 0; code <= 9; code++) {
      assert.ok(valid.includes(mapIsavailStatusToDomainState(code)));
    }
  });

  it("is versioned so decisions are reproducible (RNF-016)", () => {
    assert.equal(ISAVAIL_MAPPING_VERSION, "isavail-map@v1");
  });
});
