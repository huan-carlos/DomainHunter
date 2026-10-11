/**
 * Minimal notification email template (technical plan §9, RNF-010). The MVP
 * keeps it simple: a plain-text body plus a small HTML wrapper. No customer
 * data beyond the domain name and the event summary.
 */

export interface NotificationEmailTemplateInput {
  domain: string;
  eventType: string;
  priority: string | null;
  occurredAt: string;
  status: string;
}

const EVENT_LABELS: Record<string, string> = {
  DOMAIN_AVAILABLE: "domínio disponível para registro",
  DOMAIN_ENTERED_RELEASE: "entrou em processo de liberação",
  COMPETITIVE_PROCESS_DETECTED: "processo competitivo detectado",
  DOMAIN_RELEASE_DETECTED: "apareceu na lista de liberação",
  DOMAIN_RENEWED: "renovação detectada",
  DOMAIN_EXPIRATION_CHANGED: "data de expiração alterada",
  DOMAIN_APPROACHING_EXPIRATION: "expiração se aproximando",
  DOMAIN_POST_EXPIRATION: "período pós-expiração",
};

function eventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType.toLowerCase().replaceAll("_", " ");
}

export function renderNotificationEmail(
  input: NotificationEmailTemplateInput,
): { subject: string; text: string; html: string } {
  const label = eventLabel(input.eventType);
  const subject = `[DomainHunter] ${input.domain} — ${label}`;
  const priorityLabel = input.priority ?? "baixa";
  const text = [
    `DomainHunter — alerta de monitoramento`,
    ``,
    `Domínio: ${input.domain}`,
    `Evento: ${input.eventType}`,
    `Prioridade: ${priorityLabel}`,
    `Estado: ${input.status}`,
    `Quando: ${input.occurredAt}`,
    ``,
    `Acesse o dashboard para mais detalhes e evidências.`,
  ].join("\n");

  const html = `<h2>DomainHunter — alerta de monitoramento</h2>
<table>
  <tr><th align="left">Domínio</th><td>${escapeHtml(input.domain)}</td></tr>
  <tr><th align="left">Evento</th><td>${escapeHtml(input.eventType)}</td></tr>
  <tr><th align="left">Prioridade</th><td>${escapeHtml(priorityLabel)}</td></tr>
  <tr><th align="left">Estado</th><td>${escapeHtml(input.status)}</td></tr>
  <tr><th align="left">Quando</th><td>${escapeHtml(input.occurredAt)}</td></tr>
</table>
<p>Acesse o dashboard para mais detalhes e evidências.</p>`;

  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
