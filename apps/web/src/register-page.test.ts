import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DomainWatchDto, InitialCheckDto } from "./api.ts";
import {
  initialCheckSummary,
  renderRegisterForm,
  renderRegisterResult,
} from "./register-page.ts";

function makeWatch(overrides: Partial<DomainWatchDto> = {}): DomainWatchDto {
  return {
    id: "watch-1",
    domain: "domainhunter.com.br",
    status: "REGISTERED",
    rawLastStatus: "REGISTERED",
    priority: "HIGH",
    monitoringState: "ACTIVE",
    phase: "A",
    createdAt: "2026-08-11T12:00:00.000Z",
    lastCheckAt: "2026-08-11T12:00:00.000Z",
    nextCheckAt: "2026-08-12T12:00:00.000Z",
    expirationAt: "2028-09-10T00:00:00.000Z",
    lastKnownOwner: "DomainHunter Tecnologia Ltda",
    lastKnownOwnerId: null,
    releaseStartAt: null,
    releaseEndAt: null,
    lastWhoisCheckAt: "2026-08-11T12:00:00.000Z",
    lastRdapCheckAt: "2026-08-11T12:00:00.000Z",
    lastIsavailCheckAt: "2026-08-11T12:00:00.000Z",
    lastSuccessfulCheckAt: "2026-08-11T12:00:00.000Z",
    availableSince: null,
    checkFailureCount: 0,
    clientVersions: null,
    ...overrides,
  };
}

function makeInitialCheck(overrides: Partial<InitialCheckDto> = {}): InitialCheckDto {
  return {
    succeeded: true,
    sources: { whois: "ok", rdap: "ok", isavail: "ok" },
    ...overrides,
  };
}

describe("renderRegisterForm", () => {
  it("renders the form with a .br placeholder and submit button", () => {
    const html = renderRegisterForm({ actionBase: "" });
    assert.match(html, /Cadastrar domínio/);
    assert.match(html, /name="domain"/);
    assert.match(html, /placeholder="exemplo\.com\.br"/);
    assert.match(html, /Cadastrar e consultar/);
    assert.match(html, /method="post"/);
    assert.match(html, /action="\/domains"/);
  });

  it("renders a validation error banner and keeps the submitted value", () => {
    const html = renderRegisterForm({ actionBase: "", value: "exemplo.com", error: "Apenas domínios .br são suportados." });
    assert.match(html, /Apenas domínios \.br são suportados\./);
    assert.match(html, /register-error/);
    assert.match(html, /value="exemplo\.com"/);
  });

  it("embeds client-side validation script", () => {
    const html = renderRegisterForm({ actionBase: "" });
    assert.match(html, /Apenas domínios \.br são suportados\./);
    assert.match(html, /addEventListener\("submit"/);
    assert.match(html, /Consultando…/);
  });
});

describe("renderRegisterResult", () => {
  it("shows the initial diagnostic: status, expiry, next check, phase", () => {
    const html = renderRegisterResult({
      watch: makeWatch(),
      initialCheck: makeInitialCheck(),
      actionBase: "",
    });
    assert.match(html, /cadastrado com sucesso/);
    assert.match(html, /domainhunter\.com\.br/);
    assert.match(html, /Registrado/);
    assert.match(html, /10\/09\/2028/);
    assert.match(html, /12\/08\/2026/);
    assert.match(html, /Fase de monitoramento/);
    assert.match(html, /diagnostic-status/);
    assert.match(html, /diagnostic-expiration/);
    assert.match(html, /diagnostic-next-check/);
    assert.match(html, /Ver página do domínio/);
    assert.match(html, /href="\/domains\/watch-1"/);
    assert.match(html, /Voltar à listagem/);
  });

  it("shows a technical diagnostic when the initial check failed", () => {
    const html = renderRegisterResult({
      watch: makeWatch({ status: "UNKNOWN", checkFailureCount: 1 }),
      initialCheck: makeInitialCheck({ succeeded: false, sources: { whois: "error", rdap: "error", isavail: "error" } }),
      actionBase: "",
    });
    assert.match(html, /Desconhecido/);
    assert.match(html, /Consulta inicial com falhas/);
  });
});

describe("initialCheckSummary", () => {
  it("summarizes a successful check", () => {
    assert.match(initialCheckSummary(makeInitialCheck()), /Consulta inicial concluída/);
    assert.match(initialCheckSummary(makeInitialCheck()), /WHOIS: OK/);
  });

  it("summarizes a failed check", () => {
    const summary = initialCheckSummary(makeInitialCheck({ succeeded: false, sources: { whois: "error", rdap: "error", isavail: "error" } }));
    assert.match(summary, /Consulta inicial com falhas/);
    assert.match(summary, /ISAVAIL: Falha/);
  });
});
