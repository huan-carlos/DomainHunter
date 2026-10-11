import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseReleaseCalendarV1 } from "./calendar-parser.ts";
import { ReleaseError } from "./errors.ts";
import { RELEASE_COLLECTOR_VERSION } from "./version.ts";
import { loadFixture } from "./fixtures/load.ts";

describe("release calendar parser v1", () => {
  it("parses a published calendar with audit fields (RNF-007, RNF-018)", () => {
    const record = parseReleaseCalendarV1({
      raw: loadFixture("calendar.json"),
      fetchedAt: "2026-08-11T12:00:00.000Z",
    });
    assert.equal(record.source, "release_collector");
    assert.equal(record.sourceVersion, RELEASE_COLLECTOR_VERSION);
    assert.equal(record.publish, true);
    assert.equal(record.startsAt, "2026-08-12T18:00:00.000Z");
    assert.equal(record.endsAt, "2026-08-19T18:00:00.000Z");
    assert.deepEqual(record.next, ["09/09/2026", "14/10/2026"]);
    assert.equal(record.fetchedAt, "2026-08-11T12:00:00.000Z");
    assert.equal(record.raw, loadFixture("calendar.json"));
  });

  it("parses a calendar that is not yet published", () => {
    const record = parseReleaseCalendarV1({
      raw: loadFixture("calendar-not-published.json"),
      fetchedAt: "2026-08-11T12:00:00.000Z",
    });
    assert.equal(record.publish, false);
    assert.deepEqual(record.next, ["09/09/2026", "14/10/2026"]);
  });

  it("tolerates missing optional fields instead of failing (LEX-25 AC10)", () => {
    const record = parseReleaseCalendarV1({
      raw: '{"Publish":true}',
      fetchedAt: "2026-08-11T12:00:00.000Z",
    });
    assert.equal(record.publish, true);
    assert.equal(record.startsAt, null);
    assert.equal(record.endsAt, null);
    assert.deepEqual(record.next, []);
  });

  it("degrades malformed dates to null without breaking the record", () => {
    const record = parseReleaseCalendarV1({
      raw: '{"StartsAt":"12/08/2026","Publish":true}',
      fetchedAt: "2026-08-11T12:00:00.000Z",
    });
    assert.equal(record.startsAt, null);
    assert.equal(record.publish, true);
  });

  it("throws UNKNOWN_FORMAT for a payload that is not JSON (AC10)", () => {
    assert.throws(
      () =>
        parseReleaseCalendarV1({
          raw: "<html>error</html>",
          fetchedAt: "2026-08-11T12:00:00.000Z",
        }),
      (err: unknown) => {
        assert.equal(ReleaseError.isReleaseError(err), true);
        if (ReleaseError.isReleaseError(err)) {
          assert.equal(err.code, "UNKNOWN_FORMAT");
          assert.equal(err.kind, "calendar");
        }
        return true;
      },
    );
  });

  it("throws UNKNOWN_FORMAT for a JSON root that is not an object", () => {
    assert.throws(
      () => parseReleaseCalendarV1({ raw: "[1,2]", fetchedAt: "2026-08-11T12:00:00.000Z" }),
      (err: unknown) => ReleaseError.isReleaseError(err) && err.code === "UNKNOWN_FORMAT",
    );
  });
});
