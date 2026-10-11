/**
 * DomainHunter dashboard (LEX-22, technical plan §11, product brief §20).
 *
 * Server-rendered list of monitored domains: table with Domínio | Estado |
 * Expiração | Processo | Próxima consulta | Prioridade, filters by state and
 * priority (brief §20) and a visual priority indicator (Crítica/Alta/Média).
 * Plain module + fetch (plan §11) — no SPA.
 */
import type { DomainWatchDto } from "./api.ts";
import type { DashboardFilters, SortKey } from "./domains.ts";
import { DEFAULT_FILTERS, applyFilters, sortDomains } from "./domains.ts";
import { PRIORITY_LABELS, STATUS_LABELS } from "./labels.ts";
import { STATUS_FILTERS, PRIORITY_FILTERS } from "./labels.ts";
import {
  escapeHtml,
  formatDate,
  formatDateTime,
  pageShell,
  priorityChip,
  statusTone,
  stamp,
} from "./design-system.ts";

export interface ListPageProps {
  domains: DomainWatchDto[];
  /** Base URL used to build links and the filter form target. */
  actionBase: string;
  notice?: string | null;
  error?: string | null;
  /** Active filters (from query params); defaults to all. */
  filters?: DashboardFilters;
}

function releaseWindow(domain: DomainWatchDto): string {
  if (domain.releaseStartAt == null && domain.releaseEndAt == null) return "—";
  const start = formatDate(domain.releaseStartAt);
  const end = formatDate(domain.releaseEndAt);
  if (start === "—") return end;
  if (end === "—") return start;
  if (start === end) return start;
  return `${start} → ${end}`;
}

function selectedOption(current: string, value: string): string {
  return current === value ? ' selected="selected"' : "";
}

/** Ledger columns, in display order; names map to `SortKey`. */
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "domain", label: "Domínio" },
  { key: "status", label: "Estado" },
  { key: "expiration", label: "Expiração" },
  { key: "process", label: "Processo" },
  { key: "nextCheck", label: "Próxima consulta" },
  { key: "priority", label: "Prioridade" },
];

function renderTableHead(filters: DashboardFilters, actionBase: string): string {
  const heads = COLUMNS.map((column) => {
    const isActive = filters.sort.key === column.key;
    const nextDir =
      isActive && filters.sort.dir === "asc" ? "desc" : "asc";
    const params = new URLSearchParams({
      status: filters.status,
      priority: filters.priority,
      sort: column.key,
      dir: nextDir,
    });
    if (filters.query !== "") params.set("q", filters.query);
    const href = `${actionBase}/domains?${params.toString()}`;
    const arrow = isActive
      ? ` <span class="sort-arrow" aria-hidden="true">${filters.sort.dir === "asc" ? "▲" : "▼"}</span>`
      : "";
    const ariaSort = isActive
      ? ` aria-sort="${filters.sort.dir === "asc" ? "ascending" : "descending"}"`
      : "";
    const className = isActive ? "sort-head is-active" : "sort-head";
    return `<th${ariaSort}><a class="${className}" href="${escapeHtml(href)}">${escapeHtml(column.label)}${arrow}</a></th>`;
  });
  return heads.join("\n      ");
}

function renderFilterBar(
  filters: DashboardFilters,
  actionBase: string,
): string {
  const statusOptions = STATUS_FILTERS.map(
    (option) =>
      `<option value="${option.key}"${selectedOption(filters.status, option.key)}>${escapeHtml(option.label)}</option>`,
  ).join("");
  const priorityOptions = PRIORITY_FILTERS.map(
    (option) =>
      `<option value="${option.key}"${selectedOption(filters.priority, option.key)}>${escapeHtml(option.label)}</option>`,
  ).join("");

  return `<form class="filters" method="get" action="${escapeHtml(actionBase)}/domains">
    <label class="filter">
      <span class="filter__label">Buscar</span>
      <input type="search" name="q" value="${escapeHtml(filters.query)}" placeholder="Nome do domínio" data-testid="filter-query" />
    </label>
    <label class="filter">
      <span class="filter__label">Estado</span>
      <select name="status" data-testid="filter-status">${statusOptions}</select>
    </label>
    <label class="filter">
      <span class="filter__label">Prioridade</span>
      <select name="priority" data-testid="filter-priority">${priorityOptions}</select>
    </label>
    <input type="hidden" name="sort" value="${filters.sort.key}" />
    <input type="hidden" name="dir" value="${filters.sort.dir}" />
    <input type="hidden" name="q" value="${escapeHtml(filters.query)}" />
    <button type="submit" class="button" data-testid="filter-apply">Aplicar</button>
    <a class="button button--ghost" href="${escapeHtml(actionBase)}/domains">Limpar</a>
  </form>`;
}

function renderStatusCell(domain: DomainWatchDto): string {
  const label = STATUS_LABELS[domain.status] ?? domain.status;
  const rawStatus = escapeHtml(domain.status);
  const raw =
    domain.rawLastStatus != null && domain.rawLastStatus !== domain.status
      ? ` <code class="raw" title="status bruto">${escapeHtml(domain.rawLastStatus)}</code>`
      : "";
  return `<span class="status" title="${rawStatus}">${stamp(label, statusTone(domain.status))}</span>${raw}`;
}

function renderTable(
  domains: DomainWatchDto[],
  actionBase: string,
  filters: DashboardFilters,
): string {
  if (domains.length === 0) {
    return `<div class="empty" data-testid="empty-state">Nenhum domínio encontrado com os filtros selecionados.</div>`;
  }
  const rows = domains
    .map((domain) => {
      const id = encodeURIComponent(domain.id);
      const process = releaseWindow(domain);
      return `<tr data-domain="${escapeHtml(domain.domain)}">
        <td class="domain-cell"><a class="domain" href="${escapeHtml(actionBase)}/domains/${id}">${escapeHtml(domain.domain)}</a></td>
        <td>${renderStatusCell(domain)}</td>
        <td>${escapeHtml(formatDate(domain.expirationAt))}</td>
        <td>${escapeHtml(process)}</td>
        <td>${escapeHtml(formatDateTime(domain.nextCheckAt))}</td>
        <td>${priorityChip(PRIORITY_LABELS[domain.priority] ?? domain.priority, domain.priority)}</td>
      </tr>`;
    })
    .join("\n");

  return `<div class="table-wrap">
<table class="ledger domains" data-testid="domains-table">
  <thead>
    <tr>
      ${renderTableHead(filters, actionBase)}
    </tr>
  </thead>
  <tbody>${rows}
  </tbody>
</table>
</div>`;
}

export function renderListPage(props: ListPageProps): string {
  const { domains, actionBase } = props;
  const notice = props.notice ?? null;
  const error = props.error ?? null;
  const noticeText = notice === "deleted" ? "Monitoramento encerrado." : notice;
  const filters = props.filters ?? DEFAULT_FILTERS;
  const filtered = sortDomains(applyFilters(domains, filters), filters.sort);

  const notices =
    (noticeText != null
      ? `<div class="notice notice--ok">${escapeHtml(noticeText)}</div>`
      : "") +
    (error != null
      ? `<div class="notice notice--error" data-testid="api-error">${escapeHtml(error)}</div>`
      : "");

  const body = `
  <header class="page-head">
    <p class="eyebrow">Painel de monitoramento · .br</p>
    <h1>Domínios monitorados</h1>
  </header>
  ${notices}
  ${renderFilterBar(filters, actionBase)}
  <p class="summary" data-testid="summary">${filtered.length} de ${domains.length} domínio(s) monitorados</p>
  ${renderTable(filtered, actionBase, filters)}`;

  return pageShell({
    title: "DomainHunter — Dashboard",
    active: "domains",
    actionBase,
    body,
  });
}
