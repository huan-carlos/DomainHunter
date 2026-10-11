import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { createInMemoryDatabase, migrate } from "../db/connection.ts";
import { SqliteDomainWatchRepository } from "../repositories/domain-watch-repository.ts";
import { SqliteReleaseProcessRepository } from "../repositories/release-process-repository.ts";
import { SqliteDomainEventRepository } from "../repositories/domain-event-repository.ts";
import {
  createReleaseScanService,
  releaseProcessReference,
  type ReleaseCalendarLike,
  type ReleasePublicationInput,
} from "./release-scan-service.ts";
import type { ReleaseListLike } from "./release-decision.ts";

function watchRow(db: DatabaseSync, domain: string, status = "POST_EXPIRATION_MONITORING", priority = "MEDIUM") {
  db.prepare(
    `INSERT INTO domain_watches
       (id, domain, user_id, status, raw_last_status, priority, monitoring_state, created_at,
        last_check_at, next_check_at, expiration_at, last_known_owner, last_known_owner_id,
        release_process_id, release_start_at, release_end_at, last_whois_check_at, last_rdap_check_at,
        last_isavail_check_at, last_successful_check_at, available_since, check_failure_count,
        phase, client_versions, deleted_at)
     VALUES (?, ?, NULL, ?, NULL, ?, 'ACTIVE', '2026-08-11T10:00:00.000Z', NULL,
        '2026-08-12T00:00:00.000Z', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, 0, 'C', NULL, NULL)`
  ).run(`watch-${domain}`, domain, status, priority);
}

const listOf = (kind: ReleaseListLike["kind"], domains: string[]): ReleaseListLike => ({
  kind,
  domains,
  periodStart: "2026-08-12T18:00:00.000Z",
  periodEnd: "2026-08-19T18:00:00.000Z",
  generatedAt: "2026-08-10T13:00:08.000Z",
  sourceUrl: `https://registro.br/dominio/${kind}.txt`,
  sourceVersion: "release-collector@v1",
});

const calendar: ReleaseCalendarLike = {
  startsAt: "2026-08-12T18:00:00.000Z",
  endsAt: "2026-08-19T18:00:00.000Z",
  publish: true,
  next: [],
  sourceVersion: "release-collector@v1",
  raw: '{"StartsAt":"12/08/2026 15h"}',
};

describe("release scan service", () => {
  let db: DatabaseSync;
  let watches: SqliteDomainWatchRepository;
  let processes: SqliteReleaseProcessRepository;
  let events: SqliteDomainEventRepository;
  let service: ReturnType<typeof createReleaseScanService>;

  beforeEach(() => {
    db = createInMemoryDatabase();
    migrate(db);
    watches = new SqliteDomainWatchRepository(db);
    processes = new SqliteReleaseProcessRepository(db);
    events = new SqliteDomainEventRepository(db);
    service = createReleaseScanService({
      watches,
      processes,
      events,
      clock: () => "2026-08-11T12:00:00.000Z",
    });
  });

  it("derives a stable process reference from the period", () => {
    const input: ReleasePublicationInput = { calendar, lists: [listOf("release", [])] };
    assert.equal(
      releaseProcessReference(input.calendar, input.lists),
      "release-process@2026-08-12T18:00:00.000Z",
    );
  });

  it("updates a watch found in the release list to RELEASE_PROCESS and emits an event", () => {
    watchRow(db, "example.com.br");
    const input: ReleasePublicationInput = {
      calendar,
      lists: [listOf("release", ["example.com.br"])],
    };

    const result = service.apply(input);

    assert.equal(result.process?.status, "DETECTED");
    const watch = watches.findByDomain("example.com.br");
    assert.equal(watch?.status, "RELEASE_PROCESS");
    assert.equal(watch?.priority, "HIGH");
    assert.equal(watch?.phase, "D");
    assert.equal(watch?.releaseProcessId, result.process?.id);
    assert.equal(watch?.releaseStartAt, "2026-08-12T18:00:00.000Z");
    assert.equal(result.updatedWatches.length, 1);
    assert.equal(result.createdEvents.length, 1);
    assert.equal(result.createdEvents[0]?.type, "DOMAIN_ENTERED_RELEASE");
    assert.equal(result.createdEvents[0]?.source, "release_collector");
    assert.equal(result.createdEvents[0]?.sourceVersion, "release-collector@v1");
    assert.equal(result.createdEvents[0]?.priority, "HIGH");
    assert.equal(result.createdEvents[0]?.evidenceJson.includes("example.com.br"), true);
  });

  it("detects a competitive process and elevates priority to CRITICAL (AC08)", () => {
    watchRow(db, "domainhunter.com.br", "RELEASE_PENDING", "HIGH");
    const input: ReleasePublicationInput = {
      calendar,
      lists: [
        listOf("release", ["other.com.br"]),
        listOf("competitive", ["domainhunter.com.br"]),
      ],
    };

    const result = service.apply(input);

    const watch = watches.findByDomain("domainhunter.com.br");
    assert.equal(watch?.status, "COMPETITIVE_RELEASE");
    assert.equal(watch?.priority, "CRITICAL");
    assert.equal(result.createdEvents[0]?.type, "COMPETITIVE_PROCESS_DETECTED");
  });

  it("does not create duplicate events on a re-scan of the same publication (RNF-003)", () => {
    watchRow(db, "example.com.br");
    const input: ReleasePublicationInput = {
      calendar,
      lists: [listOf("release", ["example.com.br"])],
    };

    service.apply(input);
    const second = service.apply(input);

    assert.equal(second.updatedWatches.length, 1);
    assert.equal(second.createdEvents.length, 0);
    assert.equal(events.findByDomainWatchId("watch-example.com.br").length, 1);
  });

  it("leaves watches that are not in any list untouched", () => {
    watchRow(db, "example.com.br");
    watchRow(db, "other.com.br");
    const input: ReleasePublicationInput = {
      calendar,
      lists: [listOf("release", ["example.com.br"])],
    };

    const result = service.apply(input);

    assert.equal(result.updatedWatches.length, 1);
    assert.equal(watches.findByDomain("other.com.br")?.status, "POST_EXPIRATION_MONITORING");
    assert.equal(watches.findByDomain("other.com.br")?.releaseProcessId, null);
  });

  it("persists an empty-list publication as a DETECTED process without watch changes", () => {
    const input: ReleasePublicationInput = {
      calendar,
      lists: [listOf("release", [])],
    };
    const result = service.apply(input);
    assert.equal(result.process?.status, "DETECTED");
    assert.equal(result.updatedWatches.length, 0);
  });
});
