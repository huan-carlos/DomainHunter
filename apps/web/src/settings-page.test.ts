import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderSettingsPage } from "./settings-page.ts";

describe("renderSettingsPage", () => {
  it("shows the loading state when settings are null", () => {
    const html = renderSettingsPage({ settings: null, actionBase: "" });
    assert.match(html, /Carregando configurações/);
    assert.match(html, /settings-loading/);
  });

  it("renders the email and antecedent fields from current settings (RF-021)", () => {
    const html = renderSettingsPage({
      settings: { notificationEmail: "alertas@domainhunter.local", expirationNoticeDays: 30 },
      actionBase: "",
    });
    assert.match(html, /E-mail para alertas/);
    assert.match(html, /alertas@domainhunter\.local/);
    assert.match(html, /Antecedência do aviso de expiração/);
    assert.match(html, /value="30"/);
    assert.match(html, /settings-form/);
  });

  it("renders the form action pointing to the settings route", () => {
    const html = renderSettingsPage({
      settings: { notificationEmail: null, expirationNoticeDays: 45 },
      actionBase: "/base",
    });
    assert.match(html, /action="\/base\/settings"/);
  });

  it("renders an error message when provided", () => {
    const html = renderSettingsPage({
      settings: { notificationEmail: null, expirationNoticeDays: 45 },
      actionBase: "",
      error: "Falha ao salvar",
    });
    assert.match(html, /Falha ao salvar/);
    assert.match(html, /settings-error/);
  });

  it("prefills the value after a validation error", () => {
    const html = renderSettingsPage({
      settings: { notificationEmail: null, expirationNoticeDays: 45 },
      actionBase: "",
      value: "email-invalido",
    });
    assert.match(html, /email-invalido/);
  });
});
