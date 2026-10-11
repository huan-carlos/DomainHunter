import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { uuidv7 } from "./uuid.ts";

describe("uuidv7", () => {
  it("returns a UUID v7 shaped string", () => {
    const id = uuidv7();
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("is unique across calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    assert.equal(ids.size, 1000);
  });

  it("is time-ordered for increasing timestamps", () => {
    const a = uuidv7(1_000);
    const b = uuidv7(2_000);
    assert.ok(a < b);
  });
});
