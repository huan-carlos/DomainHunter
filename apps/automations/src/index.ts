import { defaultDatabasePath } from "@domainhunter/domain-core";
import { createWorker } from "./worker.ts";

const databasePath = process.env.DOMAINHUNTER_DB_PATH ?? defaultDatabasePath();
const pollIntervalMs = Number(process.env.DOMAINHUNTER_POLL_MS ?? "5000");
const workerId = process.env.DOMAINHUNTER_WORKER_ID ?? "automations-1";

const worker = createWorker({ databasePath, pollIntervalMs, workerId });

worker.start();

process.on("SIGINT", () => {
  void worker.stop().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void worker.stop().then(() => process.exit(0));
});
