/**
 * Domain registration page (LEX-23, technical plan §11, product brief §12
 * AC01/AC02/AC03).
 *
 * Server-rendered pages (no SPA, plan §11): `renderRegisterForm` produces the
 * form with client-side `.br` validation (progressive enhancement via a tiny
 * inline script), and `renderRegisterResult` shows the initial diagnostic
 * returned by `POST /domains` — state, stored expiry (AC02) and next check
 * (AC03) — with navigation to the list and the domain page.
 */
import type { DomainWatchDto, InitialCheckDto } from "./api.ts";
import { validateBrDomain } from "./br-validation.ts";
import {
  escapeHtml,
  formatDateTime,
  pageShell,
  statusTone,
  stamp,
} from "./design-system.ts";

export interface RegisterFormProps {
  /** Base URL used to build the form action target (same-origin web server). */
  actionBase: string;
  /** Previously submitted value to keep in the field after an error. */
  value?: string;
  /** Optional error message rendered on top (validation or API failure). */
  error?: string | null;
}

export interface RegisterResultProps {
  watch: DomainWatchDto;
  initialCheck: InitialCheckDto;
  actionBase: string;
}

const STATUS_LABELS: Record<string, string> = {
  REGISTERED: "Registrado",
  EXPIRATION_APPROACHING: "Expiração próxima",
  POST_EXPIRATION_MONITORING: "Pós-expiração",
  RELEASE_PENDING: "Liberação pendente",
  RELEASE_PROCESS: "Em liberação",
  AVAILABLE: "Disponível",
  RENEWED: "Renovado",
  UNKNOWN: "Desconhecido",
  CHECK_FAILED: "Falha de consulta",
  COMPETITIVE_RELEASE: "Liberação competitiva",
  MONITORING_STOPPED: "Monitoramento encerrado",
};

function sourceLabel(status: string): string {
  if (status === "ok") return "OK";
  if (status === "error") return "Falha";
  return "Ignorada";
}

function sourceTone(status: string): "green" | "amber" | "blue" {
  if (status === "ok") return "green";
  if (status === "error") return "amber";
  return "blue";
}

/** Human-readable summary of the initial check source outcomes. */
export function initialCheckSummary(initialCheck: InitialCheckDto): string {
  const parts = (["whois", "rdap", "isavail"] as const)
    .map(
      (source) =>
        `${source.toUpperCase()}: ${sourceLabel(initialCheck.sources[source])}`,
    )
    .join(" · ");
  return initialCheck.succeeded
    ? `Consulta inicial concluída (${parts}).`
    : `Consulta inicial com falhas (${parts}).`;
}

/**
 * Render the registration form. Includes a small inline script that validates
 * `.br` syntax client-side before submit and blocks double submission while
 * the request is in flight (loading state).
 */
export function renderRegisterForm(props: RegisterFormProps): string {
  const action = `${props.actionBase}/domains`;
  const value = props.value ?? "";
  const error = props.error ?? null;
  const errorMessage =
    error == null
      ? null
      : validateBrDomain(value).valid
        ? error
        : `Domínio inválido: ${error}`;

  const notices =
    errorMessage != null
      ? `<div class="notice notice--error" role="alert" data-testid="register-error">${escapeHtml(errorMessage)}</div>`
      : "";

  const body = `
  <header class="page-head">
    <a class="back" href="${props.actionBase}/domains">← Todos os domínios</a>
    <p class="eyebrow">Novo monitoramento</p>
    <h1>Cadastrar domínio</h1>
  </header>
  ${notices}
  <section class="card form-card">
    <p class="hint">Monitore um domínio <strong>.br</strong> já registrado e receba o diagnóstico inicial: estado, expiração e próxima consulta.</p>
    <form method="post" action="${action}" data-testid="register-form">
      <div class="field">
        <label for="domain">Domínio</label>
        <input
          id="domain"
          name="domain"
          type="text"
          required
          autocomplete="off"
          spellcheck="false"
          placeholder="exemplo.com.br"
          value="${escapeHtml(value)}"
          data-testid="register-domain"
        />
        <p class="hint" id="domain-hint">Ex.: <code>exemplo.com.br</code> — apenas domínios .br.</p>
      </div>
      <button type="submit" class="button" id="register-submit" data-testid="register-submit">Cadastrar e consultar</button>
    </form>
  </section>`;

  const script = `
  <script>
    (() => {
      const form = document.getElementById("register-form");
      const input = document.getElementById("domain");
      const submit = document.getElementById("register-submit");
      if (!form || !input || !submit) return;
      const hint = document.getElementById("domain-hint");
      const setError = (message) => {
        let el = document.getElementById("client-error");
        if (!el) {
          el = document.createElement("p");
          el.className = "field-error";
          el.id = "client-error";
          el.setAttribute("role", "alert");
          input.parentElement.appendChild(el);
        }
        el.textContent = message;
      };
      form.addEventListener("submit", (event) => {
        const raw = input.value.trim();
        if (raw.length === 0) {
          event.preventDefault();
          setError("Informe um domínio.");
          input.focus();
          return;
        }
        if (!raw.toLowerCase().endsWith(".br")) {
          event.preventDefault();
          setError("Apenas domínios .br são suportados.");
          input.focus();
          return;
        }
        document.getElementById("client-error")?.remove();
        submit.disabled = true;
        submit.textContent = "Consultando…";
      });
      input.addEventListener("input", () => {
        document.getElementById("client-error")?.remove();
        if (hint) hint.style.display = "";
      });
    })();
  </script>`;

  return pageShell({
    title: "Cadastrar domínio — DomainHunter",
    active: "domains",
    actionBase: props.actionBase,
    narrow: true,
    body,
    script,
  });
}

/**
 * Render the initial diagnostic after a successful registration. Shows state,
 * expiry (AC02), next check (AC03), phase and the source outcomes, with
 * navigation to the list and to the new domain's detail page.
 */
export function renderRegisterResult(props: RegisterResultProps): string {
  const { watch, initialCheck, actionBase } = props;
  const id = encodeURIComponent(watch.id);
  const statusLabel = STATUS_LABELS[watch.status] ?? watch.status;

  const sourceRows = (["whois", "rdap", "isavail"] as const)
    .map(
      (source) =>
        `<div class="source-row"><dt>${source.toUpperCase()}</dt><dd>${stamp(sourceLabel(initialCheck.sources[source]), sourceTone(initialCheck.sources[source]))}</dd></div>`,
    )
    .join("");

  const body = `
  <header class="page-head">
    <a class="back" href="${actionBase}/domains">← Todos os domínios</a>
    <p class="eyebrow">Novo monitoramento</p>
    <h1>Monitoramento iniciado</h1>
  </header>
  <div class="notice notice--ok" data-testid="register-success">Domínio <strong>${escapeHtml(watch.domain)}</strong> cadastrado com sucesso.</div>

  <section class="card">
    <h2>Diagnóstico inicial</h2>
    <dl class="detail">
      <dt>Domínio</dt><dd>${escapeHtml(watch.domain)}</dd>
      <dt>Estado</dt><dd><span data-testid="diagnostic-status">${stamp(statusLabel, statusTone(watch.status))}</span></dd>
      <dt>Expiração</dt><dd data-testid="diagnostic-expiration">${escapeHtml(formatDateTime(watch.expirationAt))}</dd>
      <dt>Próxima consulta</dt><dd data-testid="diagnostic-next-check">${escapeHtml(formatDateTime(watch.nextCheckAt))}</dd>
      <dt>Fase de monitoramento</dt><dd>${escapeHtml(watch.phase)}</dd>
      <dt>Prioridade</dt><dd>${escapeHtml(watch.priority)}</dd>
      <dt>Consulta inicial</dt><dd data-testid="diagnostic-sources">${escapeHtml(initialCheckSummary(initialCheck))}</dd>
      ${watch.lastKnownOwner != null ? `<dt>Titular</dt><dd>${escapeHtml(watch.lastKnownOwner)}</dd>` : ""}
    </dl>
    ${sourceRows}
  </section>

  <section class="card">
    <h2>Próximos passos</h2>
    <div class="actions">
      <a class="button" href="${actionBase}/domains/${id}">Ver página do domínio</a>
      <a class="back" href="${actionBase}/domains">Voltar à listagem</a>
    </div>
  </section>`;

  return pageShell({
    title: `${watch.domain} cadastrado — DomainHunter`,
    active: "domains",
    actionBase,
    body,
  });
}
