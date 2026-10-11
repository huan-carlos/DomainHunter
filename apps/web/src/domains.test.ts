import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyFilters,
  DEFAULT_SORT,
  parseFilters,
  sortDomains,
  type DashboardFilters,
} from "./domains.ts";
import type { DomainWatchDto } from "./api.ts";

function watch(overrides: Partial<DomainWatchDto>): DomainWatchDto {
  return {
    id: "id",
    domain: "exemplo.com.br",
    status: "REGISTERED",
    rawLastStatus: null,
    priority: "LOW",
    monitoringState: "ACTIVE",
    phase: "A",
    createdAt: "2026-08-11T12:00:00.000Z",
    lastCheckAt: null,
    nextCheckAt: "2026-08-12T12:00:00.000Z",
    expirationAt: null,
    lastKnownOwner: null,
    lastKnownOwnerId: null,
    releaseStartAt: null,
    releaseEndAt: null,
    lastWhoisCheckAt: null,
    lastRdapCheckAt: null,
    lastIsavailCheckAt: null,
    lastSuccessfulCheckAt: null,
    availableSince: null,
    checkFailureCount: 0,
    clientVersions: null,
    ...overrides,
  };
}

function filters(
  overrides: Partial<DashboardFilters> = {},
): DashboardFilters {
  return {
    status: "all",
    priority: "all",
    sort: DEFAULT_SORT,
    query: "",
    ...overrides,
  };
}

test("parseFilters applies status, priority, sort and search query params", () => {
  const params = new URLSearchParams(
    "status=available&priority=CRITICAL&sort=expiration&dir=desc&q=meudominio",
  );
  assert.deepEqual(parseFilters(params), {
    status: "available",
    priority: "CRITICAL",
    sort: { key: "expiration", dir: "desc" },
    query: "meudominio",
  });
});

test("parseFilters falls back to defaults for unknown values", () => {
  const params = new URLSearchParams(
    "status=bogus&priority=wat&sort=nope&dir=sideways",
  );
  assert.deepEqual(parseFilters(params), {
    status: "all",
    priority: "all",
    sort: DEFAULT_SORT,
    query: "",
  });
});

test("parseFilters trims the search query", () => {
  const params = new URLSearchParams("q=  exemplo  ");
  assert.equal(parseFilters(params).query, "exemplo");
});

test("parseFilters defaults the sort to domain ascending", () => {
  const params = new URLSearchParams("status=release");
  assert.deepEqual(parseFilters(params).sort, { key: "domain", dir: "asc" });
});

test("sortDomains orders by domain name, pt-BR numeric aware, ascending", () => {
  const domains = [
    watch({ domain: "zebra.com.br" }),
    watch({ domain: "exemplo2.com.br" }),
    watch({ domain: "exemplo10.com.br" }),
    watch({ domain: "alfa.com.br" }),
  ];
  const result = sortDomains(domains, DEFAULT_SORT);
  assert.deepEqual(
    result.map((d) => d.domain),
    ["alfa.com.br", "exemplo2.com.br", "exemplo10.com.br", "zebra.com.br"],
  );
});

test("sortDomains honors the descending direction", () => {
  const domains = [
    watch({ domain: "alfa.com.br" }),
    watch({ domain: "zebra.com.br" }),
  ];
  const result = sortDomains(domains, { key: "domain", dir: "desc" });
  assert.deepEqual(
    result.map((d) => d.domain),
    ["zebra.com.br", "alfa.com.br"],
  );
});

test("sortDomains keeps empty expiration cells last in both directions", () => {
  const domains = [
    watch({ domain: "sem-data.com.br", expirationAt: null }),
    watch({ domain: "cedo.com.br", expirationAt: "2026-09-10T00:00:00.000Z" }),
    watch({ domain: "tarde.com.br", expirationAt: "2027-01-01T00:00:00.000Z" }),
  ];
  const asc = sortDomains(domains, { key: "expiration", dir: "asc" });
  assert.deepEqual(
    asc.map((d) => d.domain),
    ["cedo.com.br", "tarde.com.br", "sem-data.com.br"],
  );
  const desc = sortDomains(domains, { key: "expiration", dir: "desc" });
  assert.deepEqual(
    desc.map((d) => d.domain),
    ["tarde.com.br", "cedo.com.br", "sem-data.com.br"],
  );
});

test("sortDomains orders by priority rank, critical first", () => {
  const domains = [
    watch({ domain: "media.com.br", priority: "MEDIUM" }),
    watch({ domain: "critica.com.br", priority: "CRITICAL" }),
    watch({ domain: "baixa.com.br", priority: "LOW" }),
    watch({ domain: "alta.com.br", priority: "HIGH" }),
  ];
  const result = sortDomains(domains, { key: "priority", dir: "asc" });
  assert.deepEqual(
    result.map((d) => d.domain),
    ["critica.com.br", "alta.com.br", "media.com.br", "baixa.com.br"],
  );
});

test("sortDomains orders by friendly status label", () => {
  const domains = [
    watch({ domain: "disponivel.com.br", status: "AVAILABLE" }),
    watch({ domain: "registrado.com.br", status: "REGISTERED" }),
    watch({ domain: "erro.com.br", status: "CHECK_FAILED" }),
  ];
  const result = sortDomains(domains, { key: "status", dir: "asc" });
  assert.deepEqual(
    result.map((d) => d.domain),
    ["disponivel.com.br", "erro.com.br", "registrado.com.br"],
  );
});

test("sortDomains does not mutate the input array", () => {
  const original = [watch({ domain: "b.com.br" }), watch({ domain: "a.com.br" })];
  const snapshot = original.map((d) => d.domain);
  sortDomains(original, DEFAULT_SORT);
  assert.deepEqual(
    original.map((d) => d.domain),
    snapshot,
  );
});

test("applyFilters keeps only matching priority when priority is set", () => {
  const domains = [
    watch({ domain: "crit.com.br", priority: "CRITICAL", status: "AVAILABLE" }),
    watch({ domain: "low.com.br", priority: "LOW", status: "AVAILABLE" }),
  ];
  const result = applyFilters(domains, filters({ status: "available", priority: "CRITICAL" }));
  assert.deepEqual(result.map((d) => d.domain), ["crit.com.br"]);
});

test("applyFilters buckets release statuses (RELEASE_PENDING + RELEASE_PROCESS)", () => {
  const domains = [
    watch({ domain: "pending.com.br", status: "RELEASE_PENDING" }),
    watch({ domain: "process.com.br", status: "RELEASE_PROCESS" }),
    watch({ domain: "available.com.br", status: "AVAILABLE" }),
  ];
  const result = applyFilters(domains, filters({ status: "release" }));
  assert.deepEqual(result.map((d) => d.domain), ["pending.com.br", "process.com.br"]);
});

test("applyFilters buckets errors (CHECK_FAILED + UNKNOWN)", () => {
  const domains = [
    watch({ domain: "failed.com.br", status: "CHECK_FAILED" }),
    watch({ domain: "unknown.com.br", status: "UNKNOWN" }),
    watch({ domain: "ok.com.br", status: "REGISTERED" }),
  ];
  const result = applyFilters(domains, filters({ status: "errors" }));
  assert.deepEqual(result.map((d) => d.domain), ["failed.com.br", "unknown.com.br"]);
});

test("applyFilters with status all and priority all returns everything", () => {
  const domains = [
    watch({ domain: "a.com.br", status: "AVAILABLE", priority: "CRITICAL" }),
    watch({ domain: "b.com.br", status: "REGISTERED", priority: "LOW" }),
  ];
  const result = applyFilters(domains, filters());
  assert.equal(result.length, 2);
});

test("applyFilters keeps only domains matching the search query, case-insensitive", () => {
  const domains = [
    watch({ domain: "meudominio.com.br" }),
    watch({ domain: "outra.co.br" }),
    watch({ domain: "sub.meudominio.com.br" }),
  ];
  const result = applyFilters(domains, filters({ query: "MEUDOMINIO" }));
  assert.deepEqual(
    result.map((d) => d.domain),
    ["meudominio.com.br", "sub.meudominio.com.br"],
  );
});

test("applyFilters combines the search query with status and priority filters", () => {
  const domains = [
    watch({ domain: "critica.com.br", status: "AVAILABLE", priority: "CRITICAL" }),
    watch({ domain: "critica-alta.com.br", status: "AVAILABLE", priority: "HIGH" }),
    watch({ domain: "critica-registrada.com.br", status: "REGISTERED", priority: "CRITICAL" }),
  ];
  const result = applyFilters(
    domains,
    filters({ query: "critica", status: "available", priority: "CRITICAL" }),
  );
  assert.deepEqual(result.map((d) => d.domain), ["critica.com.br"]);
});

test("applyFilters with an empty query does not filter by name", () => {
  const domains = [
    watch({ domain: "a.com.br", status: "AVAILABLE" }),
    watch({ domain: "b.com.br", status: "REGISTERED" }),
  ];
  const result = applyFilters(domains, filters({ query: "" }));
  assert.equal(result.length, 2);
});
