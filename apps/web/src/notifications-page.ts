/**
 * Dashboard notifications panel (RF-020, LEX-28, technical plan §11, product
 * brief §19).
 *
 * Server-rendered list of dashboard notifications: priority, event type,
 * watched domain and timestamp, with actions to mark a notification as read
 * and to clear the panel. Handles loading/error/empty states explicitly
 * (plan §11: fetch + SSR, no SPA).
 */
import type { NotificationDto } from "./api.ts";
import {
  escapeHtml,
  formatDateTime,
  pageShell,
  priorityChip,
} from "./design-system.ts";

export interface NotificationsPageProps {
  /** Notifications (already fetched); null signals the loading state. */
  notifications: NotificationDto[] | null;
  /** Base URL used to build action form targets. */
  actionBase: string;
  /** Optional success/notice message. */
  notice?: string | null;
  /** Optional error message rendered on top. */
  error?: string | null;
}

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

export const PRIORITY_LABELS: Record<string, string> = {
  CRITICAL: "Crítica",
  HIGH: "Alta",
  MEDIUM: "Média",
  LOW: "Baixa",
};

function eventLabel(eventType: string | null): string {
  if (eventType == null) return "—";
  return (
    EVENT_TYPE_LABELS[eventType] ?? eventType.replaceAll("_", " ").toLowerCase()
  );
}

export function renderNotificationsPage(props: NotificationsPageProps): string {
  const { notifications, actionBase } = props;
  const notice = props.notice ?? null;
  const error = props.error ?? null;
  const noticeText =
    notice === "read"
      ? "Notificação marcada como lida."
      : notice === "cleared"
        ? "Notificações limpas."
        : notice;

  let content: string;
  if (notifications == null) {
    content = `<div class="loading" data-testid="notifications-loading">Carregando notificações…</div>`;
  } else if (notifications.length === 0) {
    content = `<div class="empty" data-testid="notifications-empty">Nenhuma notificação.</div>`;
  } else {
    const rows = notifications
      .map((notification) => {
        const id = encodeURIComponent(notification.id);
        const read = notification.readAt != null;
        const domain =
          notification.domain != null
            ? `<a class="domain" href="${escapeHtml(actionBase)}/domains/${encodeURIComponent(notification.domainId)}">${escapeHtml(notification.domain)}</a>`
            : '<span class="muted">—</span>';
        const readBadge = read
          ? `<span class="read-badge" data-testid="read-${id}">Lida</span>`
          : `<form method="post" action="${escapeHtml(actionBase)}/notifications/${id}/read" class="inline">
               <button type="submit" class="button button--ghost">Marcar como lida</button>
             </form>`;
        return `<tr class="${read ? "read" : "unread"}" data-notification="${escapeHtml(notification.id)}">
          <td>${priorityChip(PRIORITY_LABELS[notification.priority] ?? notification.priority, notification.priority)}</td>
          <td>${escapeHtml(eventLabel(notification.eventType))}</td>
          <td class="domain">${domain}</td>
          <td>${escapeHtml(formatDateTime(notification.createdAt))}</td>
          <td>${readBadge}</td>
        </tr>`;
      })
      .join("\n");

    content = `
  <div class="table-wrap">
    <table class="ledger notifications" data-testid="notifications-table">
      <thead>
        <tr>
          <th>Prioridade</th>
          <th>Tipo</th>
          <th>Domínio</th>
          <th>Quando</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${rows}
      </tbody>
    </table>
  </div>
  <form method="post" action="${escapeHtml(actionBase)}/notifications/clear" class="actions" style="margin-top: 1rem;">
    <button type="submit" class="button button--ghost" data-testid="clear-notifications">Limpar notificações</button>
  </form>`;
  }

  const notices =
    (noticeText != null
      ? `<div class="notice notice--ok">${escapeHtml(noticeText)}</div>`
      : "") +
    (error != null
      ? `<div class="notice notice--error" data-testid="notifications-error">${escapeHtml(error)}</div>`
      : "");

  const body = `
  <header class="page-head">
    <a class="back" href="${escapeHtml(actionBase)}/domains">← Dashboard</a>
    <h1>Notificações</h1>
  </header>
  ${notices}
  ${content}`;

  return pageShell({
    title: "DomainHunter — Notificações",
    active: "notifications",
    actionBase,
    body,
  });
}
