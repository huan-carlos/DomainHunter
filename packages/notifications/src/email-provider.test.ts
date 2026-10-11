import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { smtpConfigFromEnv } from "./email-provider.ts";
import { InMemoryEmailProvider } from "./mock-email-provider.ts";
import { renderNotificationEmail } from "./template.ts";

describe("smtpConfigFromEnv (RNF-009)", () => {
  it("returns null when SMTP is not configured (dashboard-only mode)", () => {
    assert.equal(smtpConfigFromEnv({}), null);
  });

  it("reads credentials from env without hard-coding", () => {
    const config = smtpConfigFromEnv({
      DOMAINHUNTER_SMTP_HOST: "smtp.example.com",
      DOMAINHUNTER_SMTP_PORT: "465",
      DOMAINHUNTER_SMTP_SECURE: "true",
      DOMAINHUNTER_SMTP_USER: "user",
      DOMAINHUNTER_SMTP_PASS: "secret",
      DOMAINHUNTER_SMTP_FROM: "alerts@example.com",
    });
    assert.deepEqual(config, {
      host: "smtp.example.com",
      port: 465,
      secure: true,
      user: "user",
      pass: "secret",
      from: "alerts@example.com",
    });
  });

  it("defaults port/secure/from when not set", () => {
    const config = smtpConfigFromEnv({ DOMAINHUNTER_SMTP_HOST: "smtp.example.com" });
    assert.equal(config?.port, 587);
    assert.equal(config?.secure, false);
    assert.equal(config?.from, "domainhunter@domainhunter.local");
    assert.equal(config?.user, undefined);
  });
});

describe("InMemoryEmailProvider (RNF-017 mock)", () => {
  it("records sent messages", async () => {
    const provider = new InMemoryEmailProvider();
    await provider.send({ to: "a@b.c", subject: "s", text: "t" });
    assert.equal(provider.sent.length, 1);
    assert.equal(provider.sent[0]?.subject, "s");
  });

  it("fails the first N sends then succeeds (limited retry)", async () => {
    const provider = new InMemoryEmailProvider({ failCount: 2 });
    await assert.rejects(() => provider.send({ to: "a@b.c", subject: "s", text: "t" }));
    await assert.rejects(() => provider.send({ to: "a@b.c", subject: "s", text: "t" }));
    await provider.send({ to: "a@b.c", subject: "s", text: "t" });
    assert.equal(provider.sent.length, 1);
    assert.equal(provider.failures.length, 2);
  });

  it("always fails when configured", async () => {
    const provider = new InMemoryEmailProvider({ failAlways: true });
    await assert.rejects(() => provider.send({ to: "a@b.c", subject: "s", text: "t" }));
  });
});

describe("renderNotificationEmail", () => {
  it("renders subject, text and html for a domain event", () => {
    const email = renderNotificationEmail({
      domain: "exemplo.com.br",
      eventType: "DOMAIN_AVAILABLE",
      priority: "CRITICAL",
      occurredAt: "2026-08-11T12:00:00.000Z",
      status: "AVAILABLE",
    });
    assert.match(email.subject, /exemplo\.com\.br/);
    assert.match(email.subject, /disponível/);
    assert.match(email.text, /exemplo\.com\.br/);
    assert.match(email.html, /DOMAIN_AVAILABLE/);
  });
});
