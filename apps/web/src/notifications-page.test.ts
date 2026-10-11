import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { NotificationDto } from "./api.ts";
import { renderNotificationsPage } from "./notifications-page.ts";

const FIXED_NOW = "2026-08-11T12:00:00.000Z";

function makeNotification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: "n1",
    domainId: "watch-1",
    domain: "domainhunter.com.br",
    eventType: "DOMAIN_AVAILABLE",
    priority: "CRITICAL",
    channel: "dashboard",
    status: "SENT",
    readAt: null,
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

describe("renderNotificationsPage", () => {
  it("shows the loading state when notifications are null", () => {
    const html = renderNotificationsPage({ notifications: null, actionBase: "" });
    assert.match(html, /Carregando notificações/);
    assert.match(html, /notifications-loading/);
  });

  it("shows the empty state when there are no notifications", () => {
    const html = renderNotificationsPage({ notifications: [], actionBase: "" });
    assert.match(html, /Nenhuma notificação/);
    assert.match(html, /notifications-empty/);
  });

  it("renders priority, type, domain and timestamp (RF-020)", () => {
    const html = renderNotificationsPage({
      notifications: [makeNotification()],
      actionBase: "",
    });
    assert.match(html, /Crítica/);
    assert.match(html, /Disponível para registro/);
    assert.match(html, /domainhunter\.com\.br/);
    assert.match(html, /notifications-table/);
    assert.match(html, /Marcar como lida/);
  });

  it("renders a read notification without the mark-as-read action", () => {
    const html = renderNotificationsPage({
      notifications: [makeNotification({ readAt: FIXED_NOW })],
      actionBase: "",
    });
    assert.match(html, /Lida/);
    assert.doesNotMatch(html, /Marcar como lida/);
  });

  it("renders the clear action and an error message when provided", () => {
    const html = renderNotificationsPage({
      notifications: [makeNotification()],
      actionBase: "",
      error: "API indisponível",
    });
    assert.match(html, /Limpar notificações/);
    assert.match(html, /API indisponível/);
    assert.match(html, /notifications-error/);
  });
});
