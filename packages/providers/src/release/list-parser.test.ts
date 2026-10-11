import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseReleaseListV1 } from "./list-parser.ts";
import { ReleaseError } from "./errors.ts";
import { RELEASE_COLLECTOR_VERSION } from "./version.ts";
import { loadFixture } from "./fixtures/load.ts";

const SOURCE_URL = "https://registro.br/dominio/lista-processo-liberacao.txt";

describe("release list parser v1", () => {
  it("parses a release list with domains and header metadata (RNF-007)", () => {
    const record = parseReleaseListV1({
      raw: loadFixture("list-release.txt"),
      kind: "release",
      fetchedAt: "2026-08-11T12:00:00.000Z",
      sourceUrl: SOURCE_URL,
    });
    assert.equal(record.source, "release_collector");
    assert.equal(record.sourceVersion, RELEASE_COLLECTOR_VERSION);
    assert.equal(record.kind, "release");
    assert.equal(record.sourceUrl, SOURCE_URL);
    assert.equal(record.periodStart, "2026-08-12T18:00:00.000Z");
    assert.equal(record.periodEnd, "2026-08-19T18:00:00.000Z");
    assert.equal(record.generatedAt, "2026-08-10T13:00:08.000Z");
    assert.deepEqual(record.domains, ["008bank.com.br", "0034.com.br"]);
    assert.equal(record.isEmpty, false);
    assert.equal(record.raw, loadFixture("list-release.txt"));
  });

  it("normalizes domain names to lowercase", () => {
    const record = parseReleaseListV1({
      raw: "DomainHunter.com.br\nEXAMPLE.ORG.BR\n",
      kind: "eligible",
      fetchedAt: "2026-08-11T12:00:00.000Z",
      sourceUrl: SOURCE_URL,
    });
    assert.deepEqual(record.domains, ["domainhunter.com.br", "example.org.br"]);
  });

  it("parses an empty list (Arquivo vazio) as empty", () => {
    const record = parseReleaseListV1({
      raw: loadFixture("list-empty.txt"),
      kind: "release",
      fetchedAt: "2026-08-11T12:00:00.000Z",
      sourceUrl: SOURCE_URL,
    });
    assert.equal(record.isEmpty, true);
    assert.deepEqual(record.domains, []);
    assert.equal(record.generatedAt, "2026-08-11T19:00:00.000Z");
  });

  it("skips unrecognized non-domain content lines tolerantly (AC10)", () => {
    const record = parseReleaseListV1({
      raw: "observação: dados provisórios\ndomainhunter.com.br\n# Fim\n",
      kind: "release",
      fetchedAt: "2026-08-11T12:00:00.000Z",
      sourceUrl: SOURCE_URL,
    });
    assert.deepEqual(record.domains, ["domainhunter.com.br"]);
  });

  it("throws UNKNOWN_FORMAT for an HTML error page", () => {
    assert.throws(
      () =>
        parseReleaseListV1({
          raw: loadFixture("list-unknown-format.html"),
          kind: "release",
          fetchedAt: "2026-08-11T12:00:00.000Z",
          sourceUrl: SOURCE_URL,
        }),
      (err: unknown) => {
        assert.equal(ReleaseError.isReleaseError(err), true);
        if (ReleaseError.isReleaseError(err)) {
          assert.equal(err.code, "UNKNOWN_FORMAT");
          assert.equal(err.kind, "release");
        }
        return true;
      },
    );
  });

  it("throws UNKNOWN_FORMAT for content that matches no domain lines (AC10)", () => {
    assert.throws(
      () =>
        parseReleaseListV1({
          raw: "nothing that looks like a domain\nnot-a-domain\n",
          kind: "release",
          fetchedAt: "2026-08-11T12:00:00.000Z",
          sourceUrl: SOURCE_URL,
        }),
      (err: unknown) =>
        ReleaseError.isReleaseError(err) && err.code === "UNKNOWN_FORMAT",
    );
  });
});
