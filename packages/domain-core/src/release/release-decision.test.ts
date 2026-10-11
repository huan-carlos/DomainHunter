import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decideReleaseTransition,
  RELEASE_KIND_TO_STATE,
  RELEASE_KIND_TO_PRIORITY,
  type ReleaseListLike,
} from "./release-decision.ts";

const list = (kind: ReleaseListLike["kind"], domains: string[]): ReleaseListLike => ({
  kind,
  domains,
  periodStart: null,
  periodEnd: null,
  generatedAt: null,
  sourceUrl: `https://registro.br/dominio/${kind}.txt`,
  sourceVersion: "release-collector@v1",
});

describe("release decision", () => {
  it("returns null when the domain is not in the list", () => {
    const decision = decideReleaseTransition("REGISTERED", "LOW", "example.com.br", list("release", ["other.com.br"]));
    assert.equal(decision, null);
  });

  it("maps the release list to RELEASE_PROCESS with HIGH priority", () => {
    const decision = decideReleaseTransition("POST_EXPIRATION_MONITORING", "MEDIUM", "example.com.br", list("release", ["example.com.br"]));
    assert.ok(decision);
    assert.equal(decision.nextStatus, "RELEASE_PROCESS");
    assert.equal(decision.priority, "HIGH");
    assert.equal(decision.statusChanged, true);
    assert.equal(decision.priorityElevated, true);
    assert.deepEqual(decision.eventTypes, ["DOMAIN_ENTERED_RELEASE"]);
  });

  it("maps the eligible list to RELEASE_PENDING (CANDIDATURE_WINDOW_OPEN)", () => {
    const decision = decideReleaseTransition("POST_EXPIRATION_MONITORING", "MEDIUM", "example.com.br", list("eligible", ["example.com.br"]));
    assert.ok(decision);
    assert.equal(decision.nextStatus, "RELEASE_PENDING");
    assert.deepEqual(decision.eventTypes, ["CANDIDATURE_WINDOW_OPEN"]);
  });

  it("detects a competitive process with CRITICAL priority (AC08)", () => {
    const decision = decideReleaseTransition("RELEASE_PENDING", "HIGH", "example.com.br", list("competitive", ["example.com.br"]));
    assert.ok(decision);
    assert.equal(decision.nextStatus, "COMPETITIVE_RELEASE");
    assert.equal(decision.priority, "CRITICAL");
    assert.equal(decision.priorityElevated, true);
    assert.deepEqual(decision.eventTypes, ["COMPETITIVE_PROCESS_DETECTED"]);
  });

  it("does not claim priority elevation when the watch is already CRITICAL", () => {
    const decision = decideReleaseTransition("COMPETITIVE_RELEASE", "CRITICAL", "example.com.br", list("competitive", ["example.com.br"]));
    assert.ok(decision);
    assert.equal(decision.statusChanged, false);
    assert.equal(decision.priorityElevated, false);
  });

  it("keeps the target state/priority tables exhaustive over all kinds", () => {
    for (const kind of ["release", "eligible", "competitive"] as const) {
      assert.ok(RELEASE_KIND_TO_STATE[kind]);
      assert.ok(RELEASE_KIND_TO_PRIORITY[kind]);
    }
  });
});
