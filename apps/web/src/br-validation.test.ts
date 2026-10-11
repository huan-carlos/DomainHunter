import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidBrDomain, validateBrDomain } from "./br-validation.ts";

test("accepts a valid registrable .br domain", () => {
  const result = validateBrDomain("exemplo.com.br");
  assert.equal(result.valid, true);
  if (result.valid) assert.equal(result.normalized, "exemplo.com.br");
});

test("normalizes scheme, www and case", () => {
  const result = validateBrDomain("https://www.Exemplo.COM.BR/path");
  assert.equal(result.valid, true);
  if (result.valid) assert.equal(result.normalized, "exemplo.com.br");
});

test("accepts a bare state-level domain (sp.br)", () => {
  const result = validateBrDomain("exemplo.sp.br");
  assert.equal(result.valid, true);
  if (result.valid) assert.equal(result.normalized, "exemplo.sp.br");
});

test("rejects empty input", () => {
  const result = validateBrDomain("   ");
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.code, "EMPTY_DOMAIN");
});

test("rejects a non-.br TLD", () => {
  const result = validateBrDomain("exemplo.com");
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.code, "UNSUPPORTED_TLD");
});

test("rejects an unsupported .br second-level", () => {
  const result = validateBrDomain("exemplo.xyz.br");
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.code, "UNSUPPORTED_TLD");
});

test("rejects invalid label syntax", () => {
  const result = validateBrDomain("exa mplo.com.br");
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.code, "INVALID_SYNTAX");
});

test("isValidBrDomain mirrors validateBrDomain", () => {
  assert.equal(isValidBrDomain("exemplo.com.br"), true);
  assert.equal(isValidBrDomain("exemplo.com"), false);
  assert.equal(isValidBrDomain(""), false);
});
