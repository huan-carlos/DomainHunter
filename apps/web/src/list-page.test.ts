import { test } from "node:test";
import assert from "node:assert/strict";
import { renderListPage } from "./list-page.ts";
import { DEFAULT_SORT } from "./domains.ts";
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

test("renderListPage renders the full table with the required columns", () => {
  const domains = [
    watch({
      domain: "exemplo.com.br",
      status: "AVAILABLE",
      priority: "CRITICAL",
      expirationAt: "2026-09-10T00:00:00.000Z",
    }),
    watch({ domain: "segundo.com.br", status: "REGISTERED", priority: "MEDIUM" }),
  ];
  const html = renderListPage({ domains, actionBase: "" });
  assert.match(html, /Domínio/);
  assert.match(html, /Estado/);
  assert.match(html, /Expiração/);
  assert.match(html, /Processo/);
  assert.match(html, /Próxima consulta/);
  assert.match(html, /Prioridade/);
  assert.match(html, /exemplo\.com\.br/);
  assert.match(html, /segundo\.com\.br/);
  assert.match(html, /10\/09\/2026/);
});

test("renderListPage shows a visual priority indicator for Crítica/Alta/Média", () => {
  const domains = [
    watch({ domain: "a.com.br", status: "AVAILABLE", priority: "CRITICAL" }),
    watch({ domain: "b.com.br", status: "RELEASE_PROCESS", priority: "HIGH" }),
    watch({ domain: "c.com.br", status: "EXPIRATION_APPROACHING", priority: "MEDIUM" }),
  ];
  const html = renderListPage({ domains, actionBase: "" });
  assert.match(html, /priority--critical/);
  assert.match(html, /priority--high/);
  assert.match(html, /priority--medium/);
  assert.match(html, /Crítica/);
  assert.match(html, /Alta/);
  assert.match(html, /Média/);
});

test("renderListPage preserves the raw status when it differs from the friendly label", () => {
  const domains = [watch({ domain: "exemplo.com.br", status: "REGISTERED", rawLastStatus: "E" })];
  const html = renderListPage({ domains, actionBase: "" });
  assert.match(html, /Registrado/);
  assert.match(html, /title="status bruto"/);
  assert.match(html, />E<\/code>/);
});

test("renderListPage applies filters to the visible rows", () => {
  const domains = [
    watch({ domain: "disponivel.com.br", status: "AVAILABLE", priority: "CRITICAL" }),
    watch({ domain: "registrado.com.br", status: "REGISTERED", priority: "LOW" }),
  ];
  const html = renderListPage({
    domains,
    actionBase: "",
    filters: { status: "available", priority: "CRITICAL", sort: DEFAULT_SORT, query: "" },
  });
  assert.match(html, /disponivel\.com\.br/);
  assert.doesNotMatch(html, /registrado\.com\.br/);
  assert.match(html, /1 de 2 domínio\(s\) monitorados/);
});

test("renderListPage shows a friendly empty state", () => {
  const html = renderListPage({
    domains: [],
    actionBase: "",
    filters: { status: "available", priority: "all", sort: DEFAULT_SORT, query: "" },
  });
  assert.match(html, /Nenhum domínio encontrado com os filtros selecionados/);
  assert.match(html, /0 de 0 domínio\(s\) monitorados/);
});

test("renderListPage surfaces the API error banner", () => {
  const html = renderListPage({
    domains: [],
    actionBase: "",
    error: "Não foi possível acessar a API",
  });
  assert.match(html, /api-error/);
  assert.match(html, /Não foi possível acessar a API/);
});

test("renderListPage links to the registration form", () => {
  const html = renderListPage({ domains: [], actionBase: "/web" });
  assert.match(html, /href="\/web\/domains\/new"/);
  assert.match(html, /Cadastrar domínio/);
});

test("renderListPage marks the active sort column with an arrow and aria-sort", () => {
  const html = renderListPage({ domains: [watch({})], actionBase: "" });
  assert.match(html, /<a class="sort-head is-active" href="[^"]*sort=domain&amp;dir=desc">Domínio <span class="sort-arrow"/);
  assert.match(html, /aria-sort="ascending"/);
});

test("renderListPage sort headers preserve the active filters", () => {
  const html = renderListPage({
    domains: [watch({ status: "AVAILABLE", priority: "CRITICAL" })],
    actionBase: "/web",
    filters: {
      status: "available",
      priority: "CRITICAL",
      sort: { key: "expiration", dir: "asc" },
      query: "",
    },
  });
  const expirationHead = /href="\/web\/domains\?status=available&amp;priority=CRITICAL&amp;sort=expiration&amp;dir=desc">Expiração/;
  assert.match(html, expirationHead);
  assert.match(html, /aria-sort="ascending"/);
});

test("renderListPage carries the active sort through the filter form", () => {
  const html = renderListPage({
    domains: [watch({ status: "RELEASE_PROCESS" })],
    actionBase: "",
    filters: {
      status: "release",
      priority: "all",
      sort: { key: "nextCheck", dir: "desc" },
      query: "",
    },
  });
  assert.match(html, /<input type="hidden" name="sort" value="nextCheck"/);
  assert.match(html, /<input type="hidden" name="dir" value="desc"/);
  assert.match(html, /aria-sort="descending"/);
});

test("renderListPage renders rows in the default domain A-Z order", () => {
  const domains = [
    watch({ domain: "zebra.com.br" }),
    watch({ domain: "alfa.com.br" }),
  ];
  const html = renderListPage({ domains, actionBase: "" });
  assert.ok(html.indexOf("alfa.com.br") < html.indexOf("zebra.com.br"));
});

test("renderListPage renders the name search field preserving its value", () => {
  const html = renderListPage({
    domains: [watch({})],
    actionBase: "",
    filters: {
      status: "all",
      priority: "all",
      sort: DEFAULT_SORT,
      query: "meudominio",
    },
  });
  assert.match(html, /<input type="search" name="q" value="meudominio" placeholder="Nome do domínio" data-testid="filter-query"/);
});

test("renderListPage filters rows by the name search query", () => {
  const domains = [
    watch({ domain: "meudominio.com.br" }),
    watch({ domain: "outra.co.br" }),
  ];
  const html = renderListPage({
    domains,
    actionBase: "",
    filters: {
      status: "all",
      priority: "all",
      sort: DEFAULT_SORT,
      query: "meudominio",
    },
  });
  assert.match(html, /meudominio\.com\.br/);
  assert.doesNotMatch(html, /outra\.co\.br/);
  assert.match(html, /1 de 2 domínio\(s\) monitorados/);
});

test("renderListPage sort headers preserve the active search query", () => {
  const html = renderListPage({
    domains: [watch({ domain: "meudominio.com.br" })],
    actionBase: "/web",
    filters: {
      status: "all",
      priority: "all",
      sort: { key: "domain", dir: "asc" },
      query: "meudominio",
    },
  });
  assert.match(html, /href="\/web\/domains\?status=all&amp;priority=all&amp;sort=domain&amp;dir=desc&amp;q=meudominio"/);
});
