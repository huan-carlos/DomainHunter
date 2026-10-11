import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type Database = DatabaseSync;

/** Monorepo root: this file lives at packages/domain-core/src/db/. */
function monorepoRoot(): string {
  return resolve(__dirname, "..", "..", "..", "..");
}

/**
 * Default SQLite file so watches survive restarts without any config.
 * Shared by `server` and `automations` (same absolute path, no CWD drift).
 */
export function defaultDatabasePath(): string {
  return join(monorepoRoot(), "data", "domainhunter.sqlite");
}

export function createDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  return new DatabaseSync(path);
}

export function createInMemoryDatabase(): DatabaseSync {
  return createDatabase(":memory:");
}

export function migrate(db: DatabaseSync): void {
  db.exec(readFileSync(join(__dirname, "schema.sql"), "utf8"));
}
