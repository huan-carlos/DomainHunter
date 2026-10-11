import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDatabase, migrate, SqliteDomainWatchRepository } from "@domainhunter/domain-core";
import { ReleaseError } from "@domainhunter/providers";
import type { ReleaseCollector, ReleaseListKind } from "@domainhunter/providers";
import { runReleaseScan } from "./release-scan.ts";

function textResponse(body: string) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response;
}

function fixtureCollector(): ReleaseCollector {
  const byUrl: Record<string, string> = {
    "https://registro.br/dominio/proclib-schedule.json": JSON.stringify({
      StartsAt: "12/08/2026 15h",
      EndsAt: "19/08/2026 15h",
      Publish: true,
      Next: [],
    }),
    "https://registro.br/dominio/lista-processo-liberacao.txt": "domainhunter.com.br\n",
    "https://registro.br/dominio/lista-processo-competitivo.txt": "# Arquivo vazio\n# Fim do arquivo\n",
    "https://registro.br/dominio/lista-competicao.txt": "# Arquivo vazio\n# Fim do arquivo\n",
  };
  return {
    fetchCalendar: async () => {
      const raw = byUrl["https://registro.br/dominio/proclib-schedule.json"]!;
      return {
        source: "release_collector",
        sourceVersion: "release-collector@v1",
        startsAt: "2026-08-12T18:00:00.000Z",
        endsAt: "2026-08-19T18:00:00.000Z",
        publish: true,
        next: [],
        raw,
        fetchedAt: "2026-08-11T12:00:00.000Z",
      };
    },
    fetchList: async (kind: ReleaseListKind) => {
      const urls: Record<ReleaseListKind, string> = {
        release: "https://registro.br/dominio/lista-processo-liberacao.txt",
        competitive: "https://registro.br/dominio/lista-processo-competitivo.txt",
        eligible: "https://registro.br/dominio/lista-competicao.txt",
      };
      const url = urls[kind];
      const raw = byUrl[url]!;
      return {
        source: "release_collector",
        sourceVersion: "release-collector@v1",
        kind,
        sourceUrl: url,
        periodStart: "2026-08-12T18:00:00.000Z",
        periodEnd: "2026-08-19T18:00:00.000Z",
        generatedAt: "2026-08-10T13:00:08.000Z",
        domains: kind === "release" ? ["domainhunter.com.br"] : [],
        isEmpty: kind !== "release",
        raw,
        fetchedAt: "2026-08-11T12:00:00.000Z",
      };
    },
  };
}

function seedWatch(db: ReturnType<typeof createInMemoryDatabase>, domain: string) {
  const watches = new SqliteDomainWatchRepository(db);
  return watches.create({
    domain,
    userId: null,
    status: "POST_EXPIRATION_MONITORING",
    priority: "MEDIUM",
    nextCheckAt: "2026-08-12T00:00:00.000Z",
  });
}

describe("runReleaseScan", () => {
  it("applies a published release list to a matching watch (AC07)", async () => {
    const db = createInMemoryDatabase();
    migrate(db);
    seedWatch(db, "domainhunter.com.br");

    const outcome = await runReleaseScan({
      db,
      collector: fixtureCollector(),
      clock: () => "2026-08-11T12:00:00.000Z",
    });

    assert.equal(outcome.technicalError, null);
    assert.equal(outcome.updatedWatches, 1);
    assert.equal(outcome.createdEvents.length, 1);

    const watch = new SqliteDomainWatchRepository(db).findByDomain("domainhunter.com.br");
    assert.equal(watch?.status, "RELEASE_PROCESS");
    assert.equal(watch?.priority, "HIGH");
    assert.equal(watch?.phase, "D");
    assert.ok(watch?.releaseProcessId);
  });

  it("records a technical error on unknown format without touching state (AC10/RN07)", async () => {
    const db = createInMemoryDatabase();
    migrate(db);
    const watch = seedWatch(db, "domainhunter.com.br");

    const failingCollector: ReleaseCollector = {
      fetchCalendar: async () => {
        throw new ReleaseError("UNKNOWN_FORMAT", "calendar payload is not the expected document", {
          kind: "calendar",
          raw: "<html>",
        });
      },
      fetchList: async () => {
        throw new Error("should not be called");
      },
    };

    const outcome = await runReleaseScan({ db, collector: failingCollector });

    assert.match(outcome.technicalError ?? "", /UNKNOWN_FORMAT/);
    assert.equal(outcome.updatedWatches, 0);
    const unchanged = new SqliteDomainWatchRepository(db).findById(watch.id);
    assert.equal(unchanged?.status, "POST_EXPIRATION_MONITORING");
  });

  it("returns a no-op when the calendar says the lists are not published", async () => {
    const db = createInMemoryDatabase();
    migrate(db);

    const collector: ReleaseCollector = {
      fetchCalendar: async () => ({
        source: "release_collector",
        sourceVersion: "release-collector@v1",
        startsAt: "2026-08-12T18:00:00.000Z",
        endsAt: "2026-08-19T18:00:00.000Z",
        publish: false,
        next: ["09/09/2026"],
        raw: "{}",
        fetchedAt: "2026-08-11T12:00:00.000Z",
      }),
      fetchList: async () => {
        throw new Error("should not be called");
      },
    };

    const outcome = await runReleaseScan({ db, collector });
    assert.equal(outcome.technicalError, null);
    assert.equal(outcome.updatedWatches, 0);
    assert.equal(outcome.processReference, null);
  });

  it("never throws — surfaces unexpected errors as technical errors", async () => {
    const db = createInMemoryDatabase();
    migrate(db);

    const collector: ReleaseCollector = {
      fetchCalendar: async () => {
        throw new Error("socket hang up");
      },
      fetchList: async () => {
        throw new Error("should not be called");
      },
    };

    const outcome = await runReleaseScan({ db, collector });
    assert.match(outcome.technicalError ?? "", /UNEXPECTED/);
  });
});
