import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BrDomainError, isValidBrDomain, normalizeBrDomain } from "./br-domain.ts";

describe("normalizeBrDomain", () => {
  it("lowercases and trims a bare domain", () => {
    assert.equal(normalizeBrDomain("  Exemplo.COM.BR  "), "exemplo.com.br");
  });

  it("strips scheme, path and trailing dot", () => {
    assert.equal(normalizeBrDomain("https://www.Exemplo.COM.BR/path?q=1"), "exemplo.com.br");
    assert.equal(normalizeBrDomain("http://exemplo.com.br."), "exemplo.com.br");
  });

  it("strips a leading www. to watch the registrable domain", () => {
    assert.equal(normalizeBrDomain("www.domainhunter.com.br"), "domainhunter.com.br");
    assert.equal(normalizeBrDomain("WWW.EXEMPLO.NET.BR"), "exemplo.net.br");
  });

  it("accepts a bare .br name", () => {
    assert.equal(normalizeBrDomain("registro.br"), "registro.br");
  });

  it("accepts state and category second-level domains", () => {
    assert.equal(normalizeBrDomain("escola.sp.gov.br"), "escola.sp.gov.br");
    assert.equal(normalizeBrDomain("foto.art.br"), "foto.art.br");
  });

  it("rejects an empty input", () => {
    assert.throws(
      () => normalizeBrDomain("   "),
      (error: unknown) => {
        assert.ok(error instanceof BrDomainError);
        if (error instanceof BrDomainError) assert.equal(error.code, "EMPTY_DOMAIN");
        return true;
      },
    );
  });

  it("rejects labels with invalid characters", () => {
    assert.throws(
      () => normalizeBrDomain("exa_mple.com.br"),
      (error: unknown) => {
        assert.ok(error instanceof BrDomainError);
        if (error instanceof BrDomainError) assert.equal(error.code, "INVALID_SYNTAX");
        return true;
      },
    );
    assert.throws(() => normalizeBrDomain("exemplo..br"));
    assert.throws(() => normalizeBrDomain("-exemplo.com.br"));
    assert.throws(() => normalizeBrDomain("exemplo-.com.br"));
  });

  it("rejects non-br TLDs", () => {
    assert.throws(
      () => normalizeBrDomain("example.com"),
      (error: unknown) => {
        assert.ok(error instanceof BrDomainError);
        if (error instanceof BrDomainError) assert.equal(error.code, "UNSUPPORTED_TLD");
        return true;
      },
    );
    assert.throws(() => normalizeBrDomain("example.org"));
    assert.throws(() => normalizeBrDomain("example.co.uk"));
  });

  it("rejects an unsupported .br second-level", () => {
    assert.throws(
      () => normalizeBrDomain("example.foo.br"),
      (error: unknown) => {
        assert.ok(error instanceof BrDomainError);
        if (error instanceof BrDomainError) assert.equal(error.code, "UNSUPPORTED_TLD");
        return true;
      },
    );
  });
});

describe("isValidBrDomain", () => {
  it("accepts valid .br domains and rejects others", () => {
    assert.equal(isValidBrDomain("domainhunter.com.br"), true);
    assert.equal(isValidBrDomain("http://www.DomainHunter.COM.BR/x"), true);
    assert.equal(isValidBrDomain("domainhunter.io"), false);
    assert.equal(isValidBrDomain(""), false);
    assert.equal(isValidBrDomain("a b.com.br"), false);
  });
});
