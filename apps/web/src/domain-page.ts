/**
 * Domain detail page renderer (LEX-26, technical plan §11, product brief §21).
 *
 * Pure functions: given a watch and its event timeline (fetched from the API)
 * they produce the server-rendered HTML for `/domains/:id`. No I/O, no
 * framework — plain module + fetch (plan §11).
 *
 * The page is built on the "protocolo do registro" system: the domain name is
 * the hero query line (as if typed into whois.registro.br), state reads as a
 * rubber stamp, and the event timeline is a teletype protocol log.
 */
import {
  DEFAULT_PHASE_FREQUENCIES,
  type DomainWatchStatus,
  type MonitoringPhase,
  type WatchPriority,
} from "@domainhunter/domain-core";
import type { DomainEventDto, DomainWatchDto } from "./api.ts";
import {
  escapeHtml,
  formatDateTime,
  pageShell,
  priorityChip,
  statusTone,
  stamp,
} from "./design-system.ts";

export { formatDateTime } from "./design-system.ts";

export interface DomainPageProps {
  watch: DomainWatchDto;
  events: DomainEventDto[];
  /** Base URL used to build the action form targets (same-origin web server). */
  actionBase: string;
  /** Official registrar flow URL ("Registrar domínio", RF-032). */
  registrarUrl: string;
  /** Optional success/notice message rendered on top (e.g. "check queued"). */
  notice?: string | null;
  /** Optional error message rendered on top. */
  error?: string | null;
}

export const STATUS_LABELS: Record<DomainWatchStatus, string> = {
  REGISTERED: "Registrado",
  EXPIRATION_APPROACHING: "Expiração próxima",
  POST_EXPIRATION_MONITORING: "Pós-expiração (monitorando)",
  RELEASE_PENDING: "Liberação pendente",
  RELEASE_PROCESS: "Em processo de liberação",
  AVAILABLE: "Disponível",
  RENEWED: "Renovado",
  UNKNOWN: "Desconhecido",
  CHECK_FAILED: "Falha de consulta",
  COMPETITIVE_RELEASE: "Liberação competitiva",
  MONITORING_STOPPED: "Monitoramento encerrado",
};

export const PRIORITY_LABELS: Record<WatchPriority, string> = {
  CRITICAL: "Crítica",
  HIGH: "Alta",
  MEDIUM: "Média",
  LOW: "Baixa",
};

export const SOURCE_LABELS: Record<string, string> = {
  whois: "WHOIS",
  rdap: "RDAP",
  isavail: "ISAVAIL",
  release_collector: "Coletor de liberação",
  system: "Sistema",
  user: "Usuário",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  DOMAIN_CREATED_MONITOR: "Monitoramento iniciado",
  DOMAIN_STATUS_CHANGED: "Estado alterado",
  DOMAIN_RENEWED: "Renovação detectada",
  DOMAIN_EXPIRATION_CHANGED: "Expiração alterada",
  DOMAIN_APPROACHING_EXPIRATION: "Expiração próxima",
  DOMAIN_POST_EXPIRATION: "Entrou em pós-expiração",
  DOMAIN_RELEASE_DETECTED: "Liberação detectada",
  DOMAIN_ENTERED_RELEASE: "Em processo de liberação",
  CANDIDATURE_WINDOW_OPEN: "Janela de candidatura aberta",
  CANDIDATURE_WINDOW_CLOSED: "Janela de candidatura fechada",
  COMPETITIVE_PROCESS_DETECTED: "Processo competitivo detectado",
  RELEASE_RESULT_PUBLISHED: "Resultado da liberação publicado",
  DOMAIN_AVAILABLE: "Disponível para registro",
  DOMAIN_UNAVAILABLE: "Indisponível",
  CHECK_SUCCEEDED: "Consulta bem-sucedida",
  CHECK_FAILED: "Falha de consulta",
  NOTIFICATION_SENT: "Notificação enviada",
  EXPIRATION_APPROACHING: "Expiração próxima",
  RELEASE_DETECTED: "Liberação detectada",
  RELEASE_CANDIDATURE_OPEN: "Candidatura aberta",
  RELEASE_COMPETITIVE: "Liberação competitiva",
  RELEASE_CLOSED: "Liberação encerrada",
};

const MONITORING_LABELS: Record<string, string> = {
  ACTIVE: "Monitorando",
  PAUSED: "Pausado",
  STOPPED: "Encerrado",
};

/** Label for the frequency policy of a phase (RNF-021, plan §7). */
export function phaseFrequencyLabel(phase: MonitoringPhase): string {
  const frequency =
    DEFAULT_PHASE_FREQUENCIES[phase] ?? DEFAULT_PHASE_FREQUENCIES.A;
  return `Fase ${phase} — ${frequency.label}`;
}

/** Source of the last confirmation that produced the current state. */
export function confirmationSource(
  watch: DomainWatchDto,
  events: DomainEventDto[],
): string {
  const statusEvents = events.filter((event) =>
    [
      "DOMAIN_STATUS_CHANGED",
      "DOMAIN_AVAILABLE",
      "DOMAIN_UNAVAILABLE",
      "DOMAIN_RENEWED",
      "DOMAIN_ENTERED_RELEASE",
      "DOMAIN_RELEASE_DETECTED",
    ].includes(event.type),
  );
  const last = statusEvents[statusEvents.length - 1];
  return SOURCE_LABELS[last?.source ?? "system"] ?? last?.source ?? "—";
}

/** Confidence in the current state (brief §21 "confiança/qualidade"). */
export function confidenceLabel(watch: DomainWatchDto): string {
  if (watch.status === "CHECK_FAILED" || watch.status === "UNKNOWN")
    return "Baixa";
  if (watch.lastSuccessfulCheckAt == null) return "Sem consulta confirmada";
  return "Alta";
}

function statusBadge(status: DomainWatchStatus): string {
  return stamp(STATUS_LABELS[status] ?? status, statusTone(status));
}

function monitoringBadge(state: string): string {
  const label = MONITORING_LABELS[state] ?? state;
  const tone =
    state === "ACTIVE" ? "green" : state === "PAUSED" ? "amber" : "grey";
  return stamp(label, tone);
}

function dataRow(label: string, value: string): string {
  return `<dt>${escapeHtml(label)}</dt><dd>${value}</dd>`;
}

function timelineRow(event: DomainEventDto): string {
  const source = SOURCE_LABELS[event.source] ?? event.source;
  const change =
    event.previousValue != null || event.newValue != null
      ? `<span class="timeline-change">${escapeHtml(event.previousValue ?? "—")} → ${escapeHtml(event.newValue ?? "—")}</span>`
      : "";
  return `<li class="timeline-item">
    <time>${escapeHtml(formatDateTime(event.occurredAt))}</time>
    <span class="timeline-source">${escapeHtml(source)}</span>
    <span class="timeline-type">${escapeHtml(EVENT_TYPE_LABELS[event.type] ?? event.type)}</span>
    ${change}
  </li>`;
}

function monitoringActions(watch: DomainWatchDto, actionBase: string): string {
  const id = encodeURIComponent(watch.id);
  const paused = watch.monitoringState === "PAUSED";
  return `<form method="post" action="${actionBase}/domains/${id}/check" class="inline-form">
      <button type="submit" class="button" ${watch.monitoringState === "STOPPED" ? "disabled" : ""}>Consultar agora</button>
    </form>
    <form method="post" action="${actionBase}/domains/${id}/monitoring" class="inline-form">
      <input type="hidden" name="monitoringState" value="${paused ? "ACTIVE" : "PAUSED"}" />
      <button type="submit" class="button button--ghost" ${watch.monitoringState === "STOPPED" ? "disabled" : ""}>${paused ? "Retomar" : "Pausar"}</button>
    </form>
    <form method="post" action="${actionBase}/domains/${id}/delete" class="inline-form" data-confirm="Encerrar o monitoramento deste domínio?">
      <button type="submit" class="button button--danger">Encerrar monitoramento</button>
    </form>`;
}

/**
 * Render the full domain detail page.
 */
export function renderDomainPage(props: DomainPageProps): string {
  const { watch, events, actionBase, registrarUrl } = props;
  const notice = props.notice ?? null;
  const error = props.error ?? null;
  const id = encodeURIComponent(watch.id);

  const noticeText =
    notice === "check-queued"
      ? "Consulta enfileirada."
      : notice === "monitoring-active"
        ? "Monitoramento retomado."
        : notice === "monitoring-paused"
          ? "Monitoramento pausado."
          : notice;

  const monitoringRows = [
    dataRow(
      "Última consulta WHOIS",
      escapeHtml(formatDateTime(watch.lastWhoisCheckAt)),
    ),
    dataRow(
      "Última consulta RDAP",
      escapeHtml(formatDateTime(watch.lastRdapCheckAt)),
    ),
    dataRow(
      "Última consulta ISAVAIL",
      escapeHtml(formatDateTime(watch.lastIsavailCheckAt)),
    ),
    dataRow("Próxima consulta", escapeHtml(formatDateTime(watch.nextCheckAt))),
    dataRow(
      "Política de frequência",
      escapeHtml(phaseFrequencyLabel(watch.phase)),
    ),
  ].join("");

  const releaseRows =
    watch.releaseStartAt != null || watch.releaseEndAt != null
      ? [
          dataRow(
            "Início do processo de liberação",
            escapeHtml(formatDateTime(watch.releaseStartAt)),
          ),
          dataRow(
            "Fim do processo de liberação",
            escapeHtml(formatDateTime(watch.releaseEndAt)),
          ),
        ].join("")
      : `<p class="muted">Sem processo de liberação associado.</p>`;

  const timelineHtml =
    events.length > 0
      ? `<ol class="timeline">${events.map(timelineRow).join("")}</ol>`
      : `<p class="muted">Nenhum evento registrado.</p>`;

  const notices =
    (noticeText != null
      ? `<div class="notice notice--ok">${escapeHtml(noticeText)}</div>`
      : "") +
    (error != null
      ? `<div class="notice notice--error">${escapeHtml(error)}</div>`
      : "");

  const domainEscaped = escapeHtml(watch.domain);
  const body = `
  <header class="page-head">
    <a class="back" href="${actionBase}/domains">← Todos os domínios</a>
  </header>
  ${notices}

  <section class="hero" aria-label="Estado atual de ${domainEscaped}">
    <div class="hero__stamps">${statusBadge(watch.status)} ${monitoringBadge(watch.monitoringState)}</div>
    <h1 class="hero__query"><span class="prompt">&gt;</span> <span class="type">${domainEscaped}</span><span class="cursor" aria-hidden="true">▍</span></h1>
    <dl class="hero__meta">
      <div class="hero__fact"><dt>Prioridade</dt><dd>${priorityChip(PRIORITY_LABELS[watch.priority] ?? watch.priority, watch.priority)}</dd></div>
      <div class="hero__fact"><dt>Fonte da confirmação</dt><dd>${escapeHtml(confirmationSource(watch, events))}</dd></div>
      <div class="hero__fact"><dt>Última consulta</dt><dd>${escapeHtml(formatDateTime(watch.lastCheckAt))}</dd></div>
      <div class="hero__fact"><dt>Confiança</dt><dd>${escapeHtml(confidenceLabel(watch))}</dd></div>
    </dl>
  </section>

  <section class="card">
    <h2>Estado atual</h2>
    <dl class="detail">
      ${dataRow("Status", statusBadge(watch.status))}
      ${watch.rawLastStatus != null ? dataRow("Status bruto observado", escapeHtml(watch.rawLastStatus)) : ""}
      ${watch.lastKnownOwner != null ? dataRow("Titular", escapeHtml(watch.lastKnownOwner)) : ""}
      ${watch.lastKnownOwnerId != null ? dataRow("Identificador do titular", escapeHtml(watch.lastKnownOwnerId)) : ""}
    </dl>
  </section>

  <section class="card">
    <h2>Datas</h2>
    <dl class="detail">
      ${dataRow("Criação do monitoramento", escapeHtml(formatDateTime(watch.createdAt)))}
      ${dataRow("Última alteração", escapeHtml(formatDateTime(watch.lastCheckAt)))}
      ${dataRow("Expiração", escapeHtml(formatDateTime(watch.expirationAt)))}
      ${watch.availableSince != null ? dataRow("Disponível desde", escapeHtml(formatDateTime(watch.availableSince))) : ""}
    </dl>
  </section>

  <section class="card">
    <h2>Monitoramento</h2>
    <dl class="detail">${monitoringRows}</dl>
  </section>

  ${watch.releaseStartAt != null || watch.releaseEndAt != null ? `<section class="card"><h2>Processo de liberação</h2><dl class="detail">${releaseRows}</dl></section>` : ""}

  <section class="card">
    <h2>Ações</h2>
    ${monitoringActions(watch, actionBase)}
    <div class="actions">
      <a class="button button--ghost" href="${escapeHtml(registrarUrl)}" target="_blank" rel="noopener noreferrer">Registrar domínio (Registro.br) ↗</a>
    </div>
  </section>

  <section class="card">
    <h2>Linha do tempo</h2>
    ${timelineHtml}
  </section>`;

  const script = `
  <script>
    for (const form of document.querySelectorAll("form[data-confirm]")) {
      form.addEventListener("submit", (event) => {
        if (!window.confirm(form.dataset.confirm)) event.preventDefault();
      });
    }
    (() => {
      const target = document.querySelector(".hero__query .type");
      if (!target) return;
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const text = target.textContent;
      target.textContent = "";
      let index = 0;
      const timer = window.setInterval(() => {
        target.textContent = text.slice(0, index + 1);
        index += 1;
        if (index >= text.length) window.clearInterval(timer);
      }, 36);
    })();
  </script>`;

  return pageShell({
    title: `${watch.domain} — DomainHunter`,
    active: "domains",
    actionBase,
    body,
    script,
  });
}
