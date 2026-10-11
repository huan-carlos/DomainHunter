import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_SECONDS,
  deriveSecret,
  isAuthenticated,
  isSafeNextPath,
  issueSession,
  passwordMatches,
  readAuthToken,
} from "./auth.ts";

const secret = deriveSecret("correct horse battery staple");
const NOW = 1_700_000_000_000;

describe("passwordMatches", () => {
  it("accepts the right password and rejects any other", () => {
    assert.ok(passwordMatches("s3cr3t", "s3cr3t"));
    assert.ok(!passwordMatches("s3cr3t", "s3cr3T"));
    assert.ok(!passwordMatches("", "s3cr3t"));
  });
});

describe("readAuthToken", () => {
  it("extracts the session cookie among others", () => {
    assert.equal(
      readAuthToken("other=1; domainhunter_session=abc.def; foo=2"),
      "abc.def",
    );
    assert.equal(readAuthToken(undefined), null);
    assert.equal(readAuthToken("foo=bar"), null);
  });
});

describe("isAuthenticated", () => {
  it("accepts a freshly issued session", () => {
    const { token } = issueSession(secret, NOW);
    assert.ok(
      isAuthenticated(`domainhunter_session=${token}`, secret, NOW + 1000),
    );
  });

  it("rejects a tampered signature", () => {
    const { token } = issueSession(secret, NOW);
    const issuedAt = token.split(".")[0];
    const forged = `${issuedAt}.${"0".repeat(64)}`;
    assert.ok(
      !isAuthenticated(`domainhunter_session=${forged}`, secret, NOW + 1000),
    );
  });

  it("rejects an expired session", () => {
    const { token } = issueSession(secret, NOW);
    const later = NOW + SESSION_SECONDS * 1000 + 1;
    assert.ok(!isAuthenticated(`domainhunter_session=${token}`, secret, later));
  });

  it("rejects a session issued in the future", () => {
    const { token } = issueSession(secret, NOW);
    assert.ok(
      !isAuthenticated(`domainhunter_session=${token}`, secret, NOW - 1),
    );
  });

  it("rejects malformed tokens", () => {
    assert.ok(
      !isAuthenticated("domainhunter_session=not-a-token", secret, NOW),
    );
    assert.ok(!isAuthenticated("domainhunter_session=abc", secret, NOW));
  });
});

describe("isSafeNextPath", () => {
  it("allows same-origin relative paths", () => {
    assert.ok(isSafeNextPath("/domains"));
    assert.ok(isSafeNextPath("/domains?status=all"));
    assert.ok(isSafeNextPath("/domains/watch-1"));
  });

  it("rejects absolute and backslash paths", () => {
    assert.ok(!isSafeNextPath("https://evil.com"));
    assert.ok(!isSafeNextPath("//evil.com"));
    assert.ok(!isSafeNextPath("\\evil.com"));
    assert.ok(!isSafeNextPath(""));
  });
});
