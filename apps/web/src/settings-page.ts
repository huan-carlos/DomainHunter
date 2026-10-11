/**
 * Notification settings page (RF-021, LEX-28, technical plan §9/§11).
 *
 * Server-rendered form to configure the alert email address and the
 * expiration notice lead time (antecedência). Reads current settings from the
 * API and saves them via a POST handled by the web server (which proxies to
 * PUT /settings).
 */
import type { NotificationSettingsDto } from "./api.ts";
import { escapeHtml, pageShell } from "./design-system.ts";

export interface SettingsPageProps {
  /** Current settings; null signals the loading state. */
  settings: NotificationSettingsDto | null;
  /** Base URL used to build the form action target. */
  actionBase: string;
  /** Optional success/notice message. */
  notice?: string | null;
  /** Optional error message rendered on top. */
  error?: string | null;
  /** Previously submitted email to keep in the field after an error. */
  value?: string;
}

export function renderSettingsPage(props: SettingsPageProps): string {
  const { settings, actionBase } = props;
  const notice = props.notice ?? null;
  const error = props.error ?? null;
  const noticeText = notice === "saved" ? "Configurações salvas." : notice;

  let content: string;
  if (settings == null) {
    content = `<div class="loading" data-testid="settings-loading">Carregando configurações…</div>`;
  } else {
    const emailValue = escapeHtml(
      props.value ?? settings.notificationEmail ?? "",
    );
    content = `
  <form method="post" action="${escapeHtml(actionBase)}/settings" class="settings" data-testid="settings-form">
    <label>
      <span>E-mail para alertas</span>
      <input type="email" name="notificationEmail" value="${emailValue}" placeholder="alertas@exemplo.com.br" autocomplete="email" />
      <span class="field-hint">Deixe em branco para desativar alertas por e-mail (RNF-010).</span>
    </label>
    <label>
      <span>Antecedência do aviso de expiração (dias)</span>
      <input type="number" name="expirationNoticeDays" min="1" max="365" value="${settings.expirationNoticeDays}" required />
      <span class="field-hint">Quantos dias antes da expiração você quer ser avisado (RF-021).</span>
    </label>
    <button type="submit" class="button" data-testid="settings-save">Salvar configurações</button>
  </form>`;
  }

  const notices =
    (noticeText != null
      ? `<div class="notice notice--ok">${escapeHtml(noticeText)}</div>`
      : "") +
    (error != null
      ? `<div class="notice notice--error" data-testid="settings-error">${escapeHtml(error)}</div>`
      : "");

  const body = `
  <header class="page-head">
    <a class="back" href="${escapeHtml(actionBase)}/domains">← Dashboard</a>
    <h1>Configurações de alertas</h1>
  </header>
  ${notices}
  ${content}`;

  return pageShell({
    title: "DomainHunter — Configurações",
    active: "settings",
    actionBase,
    narrow: true,
    body,
  });
}
