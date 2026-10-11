import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DomainEventDto, DomainWatchDto } from "./api.ts";
import {
  confidenceLabel,
  confirmationSource,
  formatDateTime,
  phaseFrequencyLabel,
  renderDomainPage,
} from "./domain-page.ts";

function makeWatch(overrides: Partial<DomainWatchDto> = {}): DomainWatchDto {
  return {
    id: "watch-1",
    domain: "exemplo.com.br",
    status: "REGISTERED",
    rawLastStatus: "REGISTERED",
    priority: "MEDIUM",
    monitoringState: "ACTIVE",
    phase: "B",
    createdAt: "2026-08-11T12:00:00.000Z",
    lastCheckAt: "2026-08-11T12:00:00.000Z",
    nextCheckAt: "2026-08-11T18:00:00.000Z",
    expirationAt: "2026-09-01T00:00:00.000Z",
    lastKnownOwner: "Titular SA",
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

function makeEvent(overrides: Partial<DomainEventDto> = {}): DomainEventDto {
  return {
    id: "e1",
    type: "DOMAIN_STATUS_CHANGED",
    source: "isavail",
    sourceVersion: "isavail-client@v1",
    occurredAt: "2026-08-11T12:00:00.000Z",
    previousValue: "UNKNOWN",
    newValue: "REGISTERED",
    evidence: {},
    priority: null,
    ...overrides,
  };
}

describe("domain page helpers", () => {
  it("phaseFrequencyLabel names the phase cadence (RNF-021)", () => {
    assert.equal(phaseFrequencyLabel("A"), "Fase A — 1x/day");
    assert.equal(phaseFrequencyLabel("B"), "Fase B — 4x/day");
    assert.equal(phaseFrequencyLabel("E"), "Fase E — available (hold)");
  });

  it("formatDateTime formats ISO UTC in pt-BR", () => {
    assert.equal(formatDateTime("2026-08-11T12:00:00.000Z"), "11/08/2026, 12:00");
    assert.equal(formatDateTime(null), "—");
  });

  it("confirmationSource uses the last status-changing event's source", () => {
    const watch = makeWatch();
    const events = [
      makeEvent({ id: "a", type: "DOMAIN_CREATED_MONITOR", source: "system" }),
      makeEvent({ id: "b", type: "DOMAIN_STATUS_CHANGED", source: "whois", occurredAt: "2026-08-10T10:00:00.000Z" }),
      makeEvent({ id: "c", type: "DOMAIN_AVAILABLE", source: "isavail", occurredAt: "2026-08-11T12:00:00.000Z" }),
    ];
    assert.equal(confirmationSource(watch, events), "ISAVAIL");
  });

  it("confirmationSource falls back to system when no status event exists", () => {
    const watch = makeWatch();
    assert.equal(confirmationSource(watch, []), "Sistema");
  });

  it("confidenceLabel reflects failed checks", () => {
    assert.equal(confidenceLabel(makeWatch()), "Alta");
    assert.equal(confidenceLabel(makeWatch({ status: "CHECK_FAILED" })), "Baixa");
    assert.equal(confidenceLabel(makeWatch({ lastSuccessfulCheckAt: null })), "Sem consulta confirmada");
  });
});

describe("renderDomainPage", () => {
  it("renders all brief §21 sections", () => {
    const watch = makeWatch();
    const html = renderDomainPage({
      watch,
      events: [makeEvent()],
      actionBase: "",
      registrarUrl: "https://registro.br/dominio/",
    });
    assert.match(html, /Estado atual/);
    assert.match(html, /Datas/);
    assert.match(html, /Monitoramento/);
    assert.match(html, /Linha do tempo/);
    assert.match(html, /Registrar domínio/);
    assert.match(html, /exemplo\.com\.br/);
    assert.match(html, /Registrado/);
    assert.match(html, /Fase B — 4x\/day/);
    assert.match(html, /Fonte da confirmação/);
    assert.match(html, /Confiança/);
  });

  it("renders available state with priority and availableSince", () => {
    const watch = makeWatch({
      status: "AVAILABLE",
      priority: "CRITICAL",
      phase: "E",
      availableSince: "2026-08-11T12:00:00.000Z",
    });
    const html = renderDomainPage({ watch, events: [], actionBase: "", registrarUrl: "" });
    assert.match(html, /Disponível/);
    assert.match(html, /Crítica/);
    assert.match(html, /Disponível desde/);
    assert.match(html, /Fase E/);
  });

  it("escapes user-controlled values", () => {
    const watch = makeWatch({ domain: "<script>alert(1)</script>.com.br" });
    const html = renderDomainPage({ watch, events: [], actionBase: "", registrarUrl: "" });
    assert.ok(!html.includes("<script>alert(1)</script>"));
    assert.ok(html.includes("&lt;script&gt;"));
  });

  it("renders timeline entries with source and timestamp", () => {
    const watch = makeWatch();
    const events = [
      makeEvent({
        type: "DOMAIN_RENEWED",
        source: "whois",
        occurredAt: "2026-08-11T09:00:00.000Z",
        previousValue: "2027-01-01T00:00:00.000Z",
        newValue: "2028-09-10T00:00:00.000Z",
      }),
      makeEvent({
        type: "DOMAIN_CREATED_MONITOR",
        source: "system",
        occurredAt: "2026-08-11T12:00:00.000Z",
      }),
    ];
    const html = renderDomainPage({ watch, events, actionBase: "", registrarUrl: "" });
    assert.match(html, /Renovação detectada/);
    assert.match(html, /WHOIS/);
    assert.match(html, /Sistema/);
    assert.match(html, /11\/08\/2026, 09:00/);
    assert.match(html, /2027-01-01T00:00:00\.000Z → 2028-09-10T00:00:00\.000Z/);
  });

  it("renders notice and error banners", () => {
    const watch = makeWatch();
    const notice = renderDomainPage({ watch, events: [], actionBase: "", registrarUrl: "", notice: "Consulta enfileirada." });
    assert.match(notice, /Consulta enfileirada\./);
    const error = renderDomainPage({ watch, events: [], actionBase: "", registrarUrl: "", error: "monitoringState inválido." });
    assert.match(error, /monitoringState inválido\./);
  });
});
