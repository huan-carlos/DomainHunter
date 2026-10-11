export type WatchStatus =
  | "REGISTERED"
  | "EXPIRATION_APPROACHING"
  | "POST_EXPIRATION_MONITORING"
  | "RELEASE_PENDING"
  | "RELEASE_PROCESS"
  | "AVAILABLE"
  | "RENEWED"
  | "UNKNOWN"
  | "CHECK_FAILED"
  | "COMPETITIVE_RELEASE"
  | "MONITORING_STOPPED";

export type WatchPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type StatusFilterKey =
  | "all"
  | "approaching"
  | "post_expiration"
  | "release"
  | "competitive"
  | "available"
  | "errors";

export type PriorityFilterKey = "all" | WatchPriority;

export const STATUS_LABELS: Record<WatchStatus, string> = {
  REGISTERED: "Registrado",
  EXPIRATION_APPROACHING: "Próximo da expiração",
  POST_EXPIRATION_MONITORING: "Pós-expiração",
  RELEASE_PENDING: "Liberação pendente",
  RELEASE_PROCESS: "Em liberação",
  AVAILABLE: "Disponível",
  RENEWED: "Renovado",
  UNKNOWN: "Desconhecido",
  CHECK_FAILED: "Erro de monitoramento",
  COMPETITIVE_RELEASE: "Competitivo",
  MONITORING_STOPPED: "Monitoramento interrompido",
};

export const PRIORITY_LABELS: Record<WatchPriority, string> = {
  CRITICAL: "Crítica",
  HIGH: "Alta",
  MEDIUM: "Média",
  LOW: "Baixa",
};

export const STATUS_FILTERS: { key: StatusFilterKey; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "approaching", label: "Próximos da expiração" },
  { key: "post_expiration", label: "Pós-expiração" },
  { key: "release", label: "Em liberação" },
  { key: "competitive", label: "Competitivos" },
  { key: "available", label: "Disponíveis" },
  { key: "errors", label: "Erros de monitoramento" },
];

export const PRIORITY_FILTERS: { key: PriorityFilterKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "CRITICAL", label: "Crítica" },
  { key: "HIGH", label: "Alta" },
  { key: "MEDIUM", label: "Média" },
  { key: "LOW", label: "Baixa" },
];

export const STATUS_BUCKETS: Record<StatusFilterKey, WatchStatus[]> = {
  all: [
    "REGISTERED",
    "EXPIRATION_APPROACHING",
    "POST_EXPIRATION_MONITORING",
    "RELEASE_PENDING",
    "RELEASE_PROCESS",
    "AVAILABLE",
    "RENEWED",
    "UNKNOWN",
    "CHECK_FAILED",
    "COMPETITIVE_RELEASE",
    "MONITORING_STOPPED",
  ],
  approaching: ["EXPIRATION_APPROACHING"],
  post_expiration: ["POST_EXPIRATION_MONITORING"],
  release: ["RELEASE_PENDING", "RELEASE_PROCESS"],
  competitive: ["COMPETITIVE_RELEASE"],
  available: ["AVAILABLE"],
  errors: ["CHECK_FAILED", "UNKNOWN"],
};

const STATUS_FILTER_KEYS: readonly string[] = STATUS_FILTERS.map((f) => f.key);
const PRIORITY_FILTER_KEYS: readonly string[] = PRIORITY_FILTERS.map((f) => f.key);

export function isStatusFilterKey(value: string | null): value is StatusFilterKey {
  return value != null && STATUS_FILTER_KEYS.includes(value);
}

export function isPriorityFilterKey(value: string | null): value is PriorityFilterKey {
  return value != null && PRIORITY_FILTER_KEYS.includes(value);
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as WatchStatus] ?? status;
}

export function priorityLabel(priority: string): string {
  return PRIORITY_LABELS[priority as WatchPriority] ?? priority;
}
