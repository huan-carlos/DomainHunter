import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeDedupKey, timeBucket } from "./dedup.ts";

describe("computeDedupKey", () => {
  const input = {
    domainWatchId: "watch-1",
    eventType: "DOMAIN_AVAILABLE",
    occurredAt: "2026-08-11T12:34:56.000Z",
  };

  it("is deterministic for the same watch/event/bucket (RNF-003)", () => {
    assert.equal(computeDedupKey(input), computeDedupKey(input));
  });

  it("differs when the event type changes", () => {
    assert.notEqual(
      computeDedupKey(input),
      computeDedupKey({ ...input, eventType: "DOMAIN_RENEWED" }),
    );
  });

  it("differs when the domain watch changes", () => {
    assert.notEqual(
      computeDedupKey(input),
      computeDedupKey({ ...input, domainWatchId: "watch-2" }),
    );
  });

  it("collapses events within the same bucket (reprocessing is idempotent)", () => {
    const a = computeDedupKey({ ...input, occurredAt: "2026-08-11T12:10:00.000Z" });
    const b = computeDedupKey({ ...input, occurredAt: "2026-08-11T12:50:00.000Z" });
    assert.equal(a, b);
  });

  it("changes across buckets (new state period is notifiable)", () => {
    const a = computeDedupKey({ ...input, occurredAt: "2026-08-11T11:59:59.000Z" });
    const b = computeDedupKey({ ...input, occurredAt: "2026-08-11T12:00:00.000Z" });
    assert.notEqual(a, b);
  });

  it("is a sha256 hex digest", () => {
    assert.match(computeDedupKey(input), /^[0-9a-f]{64}$/);
  });
});

describe("timeBucket", () => {
  it("floors a timestamp to the hour by default", () => {
    assert.equal(timeBucket("2026-08-11T12:34:56.000Z"), "2026-08-11T12:00:00.000Z");
  });

  it("respects a custom bucket width", () => {
    assert.equal(
      timeBucket("2026-08-11T12:34:56.000Z", 24 * 60 * 60 * 1000),
      "2026-08-11T00:00:00.000Z",
    );
  });
});
