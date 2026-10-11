/**
 * Login page (password auth for the dashboard).
 *
 * Server-rendered access gate rendered on `/login`. Keeps the "protocolo do
 * registro" identity: brand query-line on top, a paper form card, and a
 * bottom-rule password field. Rendered without the app nav because it must
 * work for anonymous visitors.
 */
import { escapeHtml, pageShell } from "./design-system.ts";

export interface LoginPageProps {
  /** Base URL used to build the form action target. */
  actionBase: string;
  /** Path to return to after a successful login. */
  next?: string | null;
  /** Optional error message (wrong password). */
  error?: string | null;
}

export function renderLoginPage(props: LoginPageProps): string {
  const next = props.next ?? null;
  const error = props.error ?? null;
  const nextInput =
    next != null
      ? `<input type="hidden" name="next" value="${escapeHtml(next)}" />`
      : "";

  const body = `
  <section class="auth">
    <a class="auth__brand" href="${escapeHtml(props.actionBase)}/login">domainhunter<span class="cursor" aria-hidden="true">▍</span></a>
    <p class="eyebrow">Acesso restrito</p>
    <h1>Entrar</h1>
    <p class="muted">O painel de monitoramento exige senha. Informe-a para continuar.</p>
    ${error != null ? `<div class="notice notice--error" role="alert" data-testid="login-error">${escapeHtml(error)}</div>` : ""}
    <form method="post" action="${escapeHtml(props.actionBase)}/login" class="auth-form" data-testid="login-form">
      ${nextInput}
      <div class="field">
        <label for="password">Senha</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autocomplete="current-password"
          placeholder="••••••••"
          data-testid="login-password"
        />
      </div>
      <button type="submit" class="button" data-testid="login-submit">Entrar</button>
    </form>
  </section>`;

  return pageShell({
    title: "Entrar — DomainHunter",
    active: "domains",
    actionBase: props.actionBase,
    body,
    showNav: false,
  });
}
