import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPriorityFilterKey,
  isStatusFilterKey,
  priorityLabel,
  statusLabel,
  STATUS_FILTERS,
  PRIORITY_FILTERS,
} from "./labels.ts";
import type { PriorityFilterKey, StatusFilterKey } from "./labels.ts";

test("statusLabel returns a friendly pt-BR label for known states", () => {
  assert.equal(statusLabel("REGISTERED"), "Registrado");
  assert.equal(statusLabel("EXPIRATION_APPROACHING"), "Próximo da expiração");
  assert.equal(statusLabel("POST_EXPIRATION_MONITORING"), "Pós-expiração");
  assert.equal(statusLabel("RELEASE_PENDING"), "Liberação pendente");
  assert.equal(statusLabel("RELEASE_PROCESS"), "Em liberação");
  assert.equal(statusLabel("AVAILABLE"), "Disponível");
  assert.equal(statusLabel("COMPETITIVE_RELEASE"), "Competitivo");
  assert.equal(statusLabel("CHECK_FAILED"), "Erro de monitoramento");
});

test("statusLabel falls back to the raw status for unknown states", () => {
  assert.equal(statusLabel("SOMETHING_NEW"), "SOMETHING_NEW");
});

test("priorityLabel returns friendly pt-BR labels", () => {
  assert.equal(priorityLabel("CRITICAL"), "Crítica");
  assert.equal(priorityLabel("HIGH"), "Alta");
  assert.equal(priorityLabel("MEDIUM"), "Média");
  assert.equal(priorityLabel("LOW"), "Baixa");
});

test("isStatusFilterKey accepts only defined filter keys", () => {
  assert.ok(isStatusFilterKey("available"));
  assert.ok(isStatusFilterKey("errors"));
  assert.equal(isStatusFilterKey("bogus"), false);
  assert.equal(isStatusFilterKey(null), false);
});

test("isPriorityFilterKey accepts only defined filter keys", () => {
  assert.ok(isPriorityFilterKey("all"));
  assert.ok(isPriorityFilterKey("CRITICAL"));
  assert.equal(isPriorityFilterKey("critical"), false);
  assert.equal(isPriorityFilterKey(null), false);
});

test("filter lists cover the brief §20 buckets", () => {
  const statusKeys = STATUS_FILTERS.map((f) => f.key);
  const expectedStatusKeys: StatusFilterKey[] = [
    "all",
    "approaching",
    "post_expiration",
    "release",
    "competitive",
    "available",
    "errors",
  ];
  for (const key of expectedStatusKeys) {
    assert.ok(statusKeys.includes(key), `missing status filter ${key}`);
  }
  const priorityKeys = PRIORITY_FILTERS.map((f) => f.key);
  const expectedPriorityKeys: PriorityFilterKey[] = ["all", "CRITICAL", "HIGH", "MEDIUM", "LOW"];
  for (const key of expectedPriorityKeys) {
    assert.ok(priorityKeys.includes(key), `missing priority filter ${key}`);
  }
});
