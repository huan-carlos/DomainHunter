import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRegistroBrDate, parseIsoToUtc } from "./dates.ts";

describe("release dates", () => {
  it("parses a calendar datetime (dd/mm/yyyy hh) as America/Sao_Paulo → UTC", () => {
    assert.equal(parseRegistroBrDate("12/08/2026 15h"), "2026-08-12T18:00:00.000Z");
    assert.equal(parseRegistroBrDate("12/08/2026 09h"), "2026-08-12T12:00:00.000Z");
  });

  it("parses a calendar datetime with explicit minutes (colonnated)", () => {
    assert.equal(parseRegistroBrDate("12/08/2026 15h:30"), "2026-08-12T18:30:00.000Z");
  });

  it("returns null for an unparseable date instead of throwing (AC10)", () => {
    assert.equal(parseRegistroBrDate("12/08/2026"), null);
    assert.equal(parseRegistroBrDate("not-a-date"), null);
    assert.equal(parseRegistroBrDate(""), null);
  });

  it("normalizes ISO-8601 with the Brazil offset to UTC", () => {
    assert.equal(parseIsoToUtc("2026-08-12T15:00:00-03:00"), "2026-08-12T18:00:00.000Z");
    assert.equal(parseIsoToUtc("2026-08-11T16:00:00-03:00"), "2026-08-11T19:00:00.000Z");
  });

  it("accepts a Z-suffixed ISO-8601 timestamp", () => {
    assert.equal(parseIsoToUtc("2026-08-11T16:00:00Z"), "2026-08-11T16:00:00.000Z");
  });

  it("returns null for a malformed ISO-8601 timestamp", () => {
    assert.equal(parseIsoToUtc("12/08/2026 15h"), null);
    assert.equal(parseIsoToUtc("2026-08-12"), null);
  });
});
