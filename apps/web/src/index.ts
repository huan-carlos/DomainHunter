/**
 * DomainHunter web server (LEX-26, technical plan §11).
 *
 * Serves the dashboard pages with simple server-side rendering (no SPA).
 * Reads the API through `@domainhunter/web`'s `createApiClient`; actions are
 * POSTs handled here that proxy to the API and redirect back to the page.
 *
 * Env:
 *   PORT                    — listen port (default 8080)
 *   DOMAINHUNTER_API_URL    — API base URL (default http://127.0.0.1:3000)
 *   REGISTRO_BR_URL         — official registrar flow URL (RF-032)
 *   DOMAINHUNTER_PASSWORD   — dashboard password; when set, every page except
 *                             /login and /logout requires a valid session
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { ApiError, createApiClient, type DomainApiClient } from "./api.ts";
import {
  clearSessionCookie,
  deriveSecret,
  isAuthenticated,
  isSafeNextPath,
  issueSession,
  passwordMatches,
} from "./auth.ts";
import { validateBrDomain } from "./br-validation.ts";
import { renderErrorPage } from "./design-system.ts";
import { parseFilters } from "./domains.ts";
import { renderDomainPage } from "./domain-page.ts";
import { renderListPage } from "./list-page.ts";
import { renderLoginPage } from "./login-page.ts";
import { renderNotificationsPage } from "./notifications-page.ts";
import { renderRegisterForm, renderRegisterResult } from "./register-page.ts";
import { renderSettingsPage } from "./settings-page.ts";

export interface WebAppOptions {
  api: DomainApiClient;
  /** Same-origin prefix used to build action form targets. */
  actionBase?: string;
  /** Official registrar flow URL (RF-032). */
  registrarUrl?: string;
  /**
   * Dashboard password. When set, `/login` is served and every other route
   * requires a valid session cookie (see `auth.ts`).
   */
  authPassword?: string;
}

export interface WebApp {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

const MAX_BODY_BYTES = 16 * 1024;

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    connection: "close",
  });
  res.end(html);
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, { location, connection: "close" });
  res.end();
}

async function readFormBody(
  req: IncomingMessage,
): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("body too large");
      Object.assign(error, { code: "BODY_TOO_LARGE" });
      throw error;
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  const params = new URLSearchParams(raw);
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    result[key] = value;
  }
  return result;
}

/**
 * Build the web app handler. Defaults are wired from the environment so the
 * `npm start` path works out of the box; tests inject fakes.
 */
export function createWebApp(options: WebAppOptions): WebApp {
  const actionBase = (options.actionBase ?? "").replace(/\/+$/, "");
  const registrarUrl =
    options.registrarUrl ??
    process.env.REGISTRO_BR_URL ??
    "https://registro.br/dominio/";
  const authPassword = options.authPassword ?? null;
  const authSecret = authPassword != null ? deriveSecret(authPassword) : null;

  return {
    async handle(req, res): Promise<void> {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const path = url.pathname.replace(/\/+$/, "") || "/";
        const method = req.method ?? "GET";

        const isLoginRoute = path === "/login";
        const isLogoutRoute = path === "/logout" && method === "POST";
        if (
          authSecret != null &&
          !isLoginRoute &&
          !isLogoutRoute &&
          !isAuthenticated(req.headers.cookie, authSecret, Date.now())
        ) {
          const next = `${url.pathname}${url.search}`;
          const target =
            next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
          redirect(res, `${actionBase}${target}`);
          return;
        }

        if (method === "GET" && path === "/login") {
          if (authSecret == null) {
            redirect(res, `${actionBase}/domains`);
            return;
          }
          const rawNext = url.searchParams.get("next");
          const next =
            rawNext != null && isSafeNextPath(rawNext) ? rawNext : null;
          sendHtml(res, 200, renderLoginPage({ actionBase, next }));
          return;
        }

        if (method === "POST" && path === "/login") {
          if (authSecret == null) {
            redirect(res, `${actionBase}/domains`);
            return;
          }
          const form = await readFormBody(req);
          const password = form["password"] ?? "";
          const rawNext = form["next"] ?? "";
          const next =
            rawNext !== "" && isSafeNextPath(rawNext) ? rawNext : "/domains";
          if (authPassword != null && passwordMatches(password, authPassword)) {
            res.setHeader(
              "set-cookie",
              issueSession(authSecret, Date.now()).cookie,
            );
            redirect(res, `${actionBase}${next}`);
            return;
          }
          const nextAfterError = next === "/domains" ? null : next;
          sendHtml(
            res,
            401,
            renderLoginPage({
              actionBase,
              next: nextAfterError,
              error: "Senha incorreta. Tente novamente.",
            }),
          );
          return;
        }

        if (method === "POST" && path === "/logout") {
          res.setHeader("set-cookie", clearSessionCookie());
          redirect(res, `${actionBase}/login`);
          return;
        }

        if (method === "GET" && path === "/") {
          redirect(res, `${actionBase}/domains`);
          return;
        }

        if (method === "GET" && path === "/domains/new") {
          sendHtml(res, 200, renderRegisterForm({ actionBase }));
          return;
        }

        if (method === "POST" && path === "/domains") {
          const form = await readFormBody(req);
          const rawDomain = (form["domain"] ?? "").trim();
          const validation = validateBrDomain(rawDomain);
          if (!validation.valid) {
            sendHtml(
              res,
              400,
              renderRegisterForm({
                actionBase,
                value: rawDomain,
                error: validation.message,
              }),
            );
            return;
          }
          let outcome;
          try {
            outcome = await options.api.registerDomain(validation.normalized);
          } catch (error) {
            const message =
              error instanceof ApiError
                ? error.message
                : "Não foi possível cadastrar o domínio. Tente novamente.";
            sendHtml(
              res,
              502,
              renderRegisterForm({
                actionBase,
                value: rawDomain,
                error: message,
              }),
            );
            return;
          }
          if (outcome.kind === "already_watched") {
            sendHtml(
              res,
              409,
              renderRegisterForm({
                actionBase,
                value: rawDomain,
                error: `O domínio ${outcome.domain} já está sendo monitorado.`,
              }),
            );
            return;
          }
          sendHtml(
            res,
            201,
            renderRegisterResult({ ...outcome.result, actionBase }),
          );
          return;
        }

        if (method === "GET" && path === "/domains") {
          const { domains } = await options.api.listDomains();
          const filters = parseFilters(url.searchParams);
          sendHtml(res, 200, renderListPage({ domains, actionBase, filters }));
          return;
        }

        if (method === "GET" && path === "/notifications") {
          const notice = url.searchParams.get("notice");
          try {
            const { notifications } = await options.api.listNotifications();
            sendHtml(
              res,
              200,
              renderNotificationsPage({ notifications, actionBase, notice }),
            );
          } catch (error) {
            const message =
              error instanceof ApiError
                ? error.message
                : "Não foi possível carregar as notificações.";
            sendHtml(
              res,
              502,
              renderNotificationsPage({
                notifications: [],
                actionBase,
                error: message,
              }),
            );
          }
          return;
        }

        const notificationReadMatch = path.match(
          /^\/notifications\/([^/]+)\/read$/,
        );
        if (notificationReadMatch && method === "POST") {
          const id = decodeURIComponent(notificationReadMatch[1] ?? "");
          try {
            await options.api.markNotificationRead(id);
            redirect(res, `${actionBase}/notifications?notice=read`);
          } catch (error) {
            const message =
              error instanceof ApiError
                ? error.message
                : "Não foi possível marcar a notificação como lida.";
            sendHtml(
              res,
              502,
              renderNotificationsPage({
                notifications: [],
                actionBase,
                error: message,
              }),
            );
          }
          return;
        }

        if (method === "POST" && path === "/notifications/clear") {
          try {
            await options.api.clearNotifications();
            redirect(res, `${actionBase}/notifications?notice=cleared`);
          } catch (error) {
            const message =
              error instanceof ApiError
                ? error.message
                : "Não foi possível limpar as notificações.";
            sendHtml(
              res,
              502,
              renderNotificationsPage({
                notifications: [],
                actionBase,
                error: message,
              }),
            );
          }
          return;
        }

        if (method === "GET" && path === "/settings") {
          const notice = url.searchParams.get("notice");
          try {
            const settings = await options.api.getSettings();
            sendHtml(
              res,
              200,
              renderSettingsPage({ settings, actionBase, notice }),
            );
          } catch (error) {
            const message =
              error instanceof ApiError
                ? error.message
                : "Não foi possível carregar as configurações.";
            sendHtml(
              res,
              502,
              renderSettingsPage({
                settings: null,
                actionBase,
                error: message,
              }),
            );
          }
          return;
        }

        if (method === "POST" && path === "/settings") {
          const form = await readFormBody(req);
          const notificationEmail = (form["notificationEmail"] ?? "").trim();
          const rawDays = form["expirationNoticeDays"] ?? "";
          const expirationNoticeDays = Number(rawDays);
          if (
            !Number.isInteger(expirationNoticeDays) ||
            expirationNoticeDays < 1 ||
            expirationNoticeDays > 365
          ) {
            sendHtml(
              res,
              400,
              renderSettingsPage({
                settings: {
                  notificationEmail: notificationEmail || null,
                  expirationNoticeDays,
                },
                actionBase,
                value: notificationEmail,
                error:
                  "A antecedência deve ser um número inteiro entre 1 e 365 dias.",
              }),
            );
            return;
          }
          try {
            await options.api.saveSettings({
              notificationEmail: notificationEmail || null,
              expirationNoticeDays,
            });
            redirect(res, `${actionBase}/settings?notice=saved`);
          } catch (error) {
            const message =
              error instanceof ApiError
                ? error.message
                : "Não foi possível salvar as configurações.";
            sendHtml(
              res,
              502,
              renderSettingsPage({
                settings: {
                  notificationEmail: notificationEmail || null,
                  expirationNoticeDays,
                },
                actionBase,
                value: notificationEmail,
                error: message,
              }),
            );
          }
          return;
        }

        const domainsMatch = path.match(/^\/domains\/([^/]+)$/);
        if (domainsMatch && method === "GET") {
          const id = decodeURIComponent(domainsMatch[1] ?? "");
          const [watch, events] = await Promise.all([
            options.api.getDomain(id),
            options.api.getTimeline(id),
          ]);
          sendHtml(
            res,
            200,
            renderDomainPage({ watch, events, actionBase, registrarUrl }),
          );
          return;
        }

        const checkMatch = path.match(/^\/domains\/([^/]+)\/check$/);
        if (checkMatch && method === "POST") {
          const id = decodeURIComponent(checkMatch[1] ?? "");
          await options.api.requestCheck(id);
          redirect(
            res,
            `${actionBase}/domains/${encodeURIComponent(id)}?notice=check-queued`,
          );
          return;
        }

        const monitoringMatch = path.match(/^\/domains\/([^/]+)\/monitoring$/);
        if (monitoringMatch && method === "POST") {
          const id = decodeURIComponent(monitoringMatch[1] ?? "");
          const form = await readFormBody(req);
          const state = form["monitoringState"];
          if (state !== "ACTIVE" && state !== "PAUSED") {
            sendHtml(
              res,
              400,
              renderDomainPage({
                watch: await options.api.getDomain(id),
                events: await options.api.getTimeline(id),
                actionBase,
                registrarUrl,
                error: "monitoringState inválido.",
              }),
            );
            return;
          }
          await options.api.setMonitoringState(id, state);
          redirect(
            res,
            `${actionBase}/domains/${encodeURIComponent(id)}?notice=monitoring-${state.toLowerCase()}`,
          );
          return;
        }

        const deleteMatch = path.match(/^\/domains\/([^/]+)\/delete$/);
        if (deleteMatch && method === "POST") {
          const id = decodeURIComponent(deleteMatch[1] ?? "");
          await options.api.deleteDomain(id);
          redirect(res, `${actionBase}/domains?notice=deleted`);
          return;
        }

        sendHtml(
          res,
          404,
          renderErrorPage(
            "Página não encontrada",
            "O endereço solicitado não existe.",
          ),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendHtml(
          res,
          500,
          renderErrorPage("Erro interno", message.replaceAll("<", "&lt;")),
        );
      }
    },
  };
}

export function createWebServer(options: {
  port: number;
  host?: string;
  app: WebApp;
}): Server {
  return createServer((req, res) => {
    void options.app.handle(req, res);
  }).listen(options.port, options.host ?? "127.0.0.1");
}

/** Fallback password for the dashboard when DOMAINHUNTER_PASSWORD is unset. */
export const DEFAULT_AUTH_PASSWORD = "domainhunter";

/** Build the default app from the environment. */
export function createDefaultWebApp(options?: {
  api?: DomainApiClient;
}): WebApp {
  const apiBaseUrl =
    process.env.DOMAINHUNTER_API_URL ?? "http://127.0.0.1:3000";
  const appOptions: WebAppOptions = {
    api: options?.api ?? createApiClient({ baseUrl: apiBaseUrl }),
  };
  const authPassword = process.env.DOMAINHUNTER_PASSWORD;
  appOptions.authPassword =
    authPassword != null && authPassword !== ""
      ? authPassword
      : DEFAULT_AUTH_PASSWORD;
  return createWebApp(appOptions);
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? "127.0.0.1";
  const app = createDefaultWebApp();
  const server = createWebServer({ port, host, app });
  console.log(`domainhunter-web listening on http://${host}:${port}`);
  if (process.env.DOMAINHUNTER_PASSWORD == null) {
    console.log(
      `domainhunter-web: login ativo — senha padrão '${DEFAULT_AUTH_PASSWORD}' (defina DOMAINHUNTER_PASSWORD para usar outra)`,
    );
  }
  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
