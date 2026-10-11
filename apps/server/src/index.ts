import { createServer, type Server } from "node:http";
import {
  createDatabase,
  defaultDatabasePath,
  migrate,
  SqliteDomainEventRepository,
  SqliteDomainWatchRepository,
  SqliteNotificationRepository,
  SqliteNotificationSettingsRepository,
  SqliteScheduledJobRepository,
} from "@domainhunter/domain-core";
import {
  createIsavailClientV1,
  createRdapClientV1,
  createWhoisClientV1,
} from "@domainhunter/providers";
import { createDomainApp, type DomainApp } from "./http/app.ts";

export interface LexServerOptions {
  port: number;
  host?: string;
  /** The application handler to serve (built via `createDefaultApp`). */
  app: DomainApp;
}

export function createLexServer({
  port,
  host = "127.0.0.1",
  app,
}: LexServerOptions): Server {
  return createServer((req, res) => {
    void app.handle(req, res);
  }).listen(port, host);
}

/**
 * Build the DomainHunter API with real provider clients and the database
 * configured through `DOMAINHUNTER_DB_PATH` (defaults to a persisted
 * `data/domainhunter.sqlite` at the repo root).
 */
export function createDefaultApp(options?: {
  databasePath?: string;
  clock?: () => string;
}): DomainApp {
  const db = createDatabase(
    options?.databasePath ??
      process.env.DOMAINHUNTER_DB_PATH ??
      defaultDatabasePath(),
  );
  migrate(db);
  return createDomainApp({
    watches: new SqliteDomainWatchRepository(db),
    events: new SqliteDomainEventRepository(db),
    jobs: new SqliteScheduledJobRepository(db),
    notifications: new SqliteNotificationRepository(db),
    settings: new SqliteNotificationSettingsRepository(db),
    providers: {
      whois: createWhoisClientV1(),
      rdap: createRdapClientV1(),
      isavail: createIsavailClientV1(),
    },
    ...(options?.clock != null ? { clock: options.clock } : {}),
  });
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";
  const app = createDefaultApp();
  const server = createLexServer({ port, host, app });
  console.log(`domainhunter-server listening on http://${host}:${port}`);
  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
