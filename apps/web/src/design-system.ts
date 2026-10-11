/**
 * DomainHunter design system (shared look across all pages).
 *
 * Concept: "O protocolo do registro" — the dashboard reads like the printed
 * ledger and rubber-stamped protocol of the Registro.br registry, the world
 * this product actually lives in. Monospace-first typography (the WHOIS /
 * ISAVAIL wire protocol is monospace text), cool technical paper, carbon-ink
 * rules, and a single vermilion protocol stamp reserved for critical signals.
 *
 * Every page renders through `pageShell` + `navBar` so the identity is one
 * coherent system instead of five drifted style blocks.
 */
export type NavKey = "domains" | "notifications" | "settings";
export type StampTone = "green" | "red" | "amber" | "blue" | "grey";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatDate(iso: string | null | undefined): string {
  if (iso == null) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (iso == null) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

/** Ink tone for a watch status — which rubber stamp gets pressed. */
export function statusTone(status: string): StampTone {
  switch (status) {
    case "AVAILABLE":
    case "RENEWED":
      return "green";
    case "CHECK_FAILED":
    case "COMPETITIVE_RELEASE":
      return "red";
    case "EXPIRATION_APPROACHING":
    case "POST_EXPIRATION_MONITORING":
    case "RELEASE_PENDING":
    case "RELEASE_PROCESS":
      return "amber";
    case "UNKNOWN":
    case "MONITORING_STOPPED":
      return "grey";
    default:
      return "blue";
  }
}

/** Rubber-stamp status label (the page's signature element). */
export function stamp(label: string, tone: StampTone): string {
  return `<span class="stamp stamp--${tone}">${escapeHtml(label)}</span>`;
}

/** Priority rendered as a ledger margin-note chip. */
export function priorityChip(label: string, priority: string): string {
  const tone =
    priority === "CRITICAL"
      ? "priority--critical"
      : priority === "HIGH"
        ? "priority--high"
        : priority === "MEDIUM"
          ? "priority--medium"
          : "priority--low";
  return `<span class="priority ${tone}">${escapeHtml(label)}</span>`;
}

export function noticeBanner(kind: "ok" | "error", message: string): string {
  return `<div class="notice notice--${kind}">${escapeHtml(message)}</div>`;
}

export function renderErrorPage(title: string, message: string): string {
  const body = `
  <header class="page-head">
    <h1>${escapeHtml(title)}</h1>
  </header>
  <p class="muted">${escapeHtml(message)}</p>
  <div class="actions">
    <a class="button" href="/domains">Voltar ao dashboard</a>
  </div>`;
  return pageShell({
    title: `${title} — DomainHunter`,
    active: "domains",
    actionBase: "",
    body,
  });
}

export function navBar(active: NavKey, actionBase: string): string {
  const items: { key: NavKey; label: string; href: string }[] = [
    { key: "domains", label: "Dashboard", href: `${actionBase}/domains` },
    {
      key: "notifications",
      label: "Notificações",
      href: `${actionBase}/notifications`,
    },
    { key: "settings", label: "Configurações", href: `${actionBase}/settings` },
  ];
  const links = items
    .map(
      (item) =>
        `<a href="${escapeHtml(item.href)}"${active === item.key ? ' class="is-active" aria-current="page"' : ""}>${escapeHtml(item.label)}</a>`,
    )
    .join("\n    ");
  return `<nav class="nav">
    <a class="nav__brand" href="${escapeHtml(actionBase)}/domains">domainhunter<span class="cursor" aria-hidden="true">▍</span></a>
    <div class="nav__links">
      ${links}
      <button type="button" class="nav__theme" data-theme-toggle aria-pressed="false"><span data-theme-label>Modo escuro</span></button>
      <form method="post" action="${escapeHtml(actionBase)}/logout" class="nav__logout">
        <button type="submit" aria-label="Sair">Sair</button>
      </form>
      <a class="nav__cta" href="${escapeHtml(actionBase)}/domains/new">+ Cadastrar domínio</a>
    </div>
  </nav>`;
}

export interface PageShellOptions {
  title: string;
  active: NavKey;
  actionBase: string;
  body: string;
  /** Narrower reading column (register / settings forms). */
  narrow?: boolean;
  /** Hide the app nav (login page for anonymous visitors). */
  showNav?: boolean;
  /** Extra <script> injected before </body>. */
  script?: string;
}

export function pageShell(options: PageShellOptions): string {
  const widthClass = options.narrow === true ? " container--narrow" : "";
  const nav =
    options.showNav === false ? "" : navBar(options.active, options.actionBase);
  const script = options.script ?? "";
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(options.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=Space+Mono:wght@700&display=swap"
  />
  <style>${STYLES}</style>
  <script>
    (() => {
      const STORAGE_KEY = "domainhunter-theme";
      let saved = null;
      try { saved = localStorage.getItem(STORAGE_KEY); } catch {}
      const prefersDark = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
      const theme = saved === "dark" || saved === "light" ? saved : (prefersDark ? "dark" : "light");
      document.documentElement.dataset.theme = theme;
      const labelFor = (current) => current === "dark" ? "Modo claro" : "Modo escuro";
      const sync = () => {
        const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
        for (const el of document.querySelectorAll("[data-theme-label]")) el.textContent = labelFor(current);
        for (const el of document.querySelectorAll("[data-theme-toggle]")) el.setAttribute("aria-pressed", String(current === "dark"));
      };
      document.addEventListener("click", (event) => {
        const button = event.target.closest("[data-theme-toggle]");
        if (!button) return;
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem(STORAGE_KEY, next); } catch {}
        sync();
      });
      sync();
    })();
  </script>
</head>
<body>
  ${nav}
  <main class="container${widthClass}">${options.body}</main>
  ${script}
</body>
</html>`;
}

export const STYLES = `
:root {
  color-scheme: light;
  --paper: #ECEDEA;
  --panel: #F6F6F4;
  --panel-deep: #E3E4DF;
  --ink: #1C2833;
  --ink-2: #57616B;
  --ink-3: #8A929C;
  --rule: #CFD2CC;
  --accent: #C2402B;
  --green: #24714A;
  --amber: #9C6B1F;
  --blue: #2E5D86;
  --font-display: "Space Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --font-body: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}

/*
 * Dark mode is the photographic negative of the same registry ledger: the
 * paper/ink polarity swaps, so every surface that already reads
 * background: var(--ink); color: var(--paper) inverts correctly with a
 * handful of token overrides. Deeper blue-black carbon, warm grey ink, and
 * brighter stamps kept legible on the night shift.
 */
[data-theme="dark"] {
  color-scheme: dark;
  --paper: #12161C;
  --panel: #1B2129;
  --panel-deep: #242C36;
  --ink: #E4E7E3;
  --ink-2: #A7B0BA;
  --ink-3: #6F7A87;
  --rule: #2C3540;
  --accent: #E25C42;
  --green: #45A06D;
  --amber: #DCA64A;
  --blue: #7FA8D2;
}
[data-theme="dark"] .notice--ok { background: rgba(69, 160, 109, 0.16); }
[data-theme="dark"] .notice--error { background: rgba(226, 92, 66, 0.16); }

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.55;
}
::selection { background: var(--ink); color: var(--paper); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* ---------- nav ---------- */
.nav {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 1.5rem;
  flex-wrap: wrap;
  padding: 0.7rem 1.5rem;
  background: var(--paper);
  border-bottom: 2px solid var(--ink);
}
.nav__brand {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 0.95rem;
  letter-spacing: -0.01em;
  color: var(--ink);
  text-decoration: none;
  white-space: nowrap;
}
.nav__brand .cursor { color: var(--accent); animation: blink 1.1s steps(2, start) infinite; }
.nav__links { display: flex; align-items: center; gap: 1.25rem; margin-left: auto; flex-wrap: wrap; }
.nav__links a { color: var(--ink-2); text-decoration: none; font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.09em; white-space: nowrap; }
.nav__links a:hover { color: var(--ink); }
.nav__links a.is-active {
  color: var(--ink);
  font-weight: 700;
  text-decoration: underline;
  text-decoration-color: var(--accent);
  text-decoration-thickness: 2px;
  text-underline-offset: 4px;
}
.nav__cta {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--paper);
  background: var(--ink);
  border: 2px solid var(--ink);
  padding: 0.4rem 0.7rem;
  text-decoration: none;
  white-space: nowrap;
}
.nav__cta:hover { background: var(--accent); border-color: var(--accent); }
.nav__logout button {
  font: inherit;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--ink-2);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}
.nav__logout button:hover { color: var(--accent); }
.nav__theme {
  font: inherit;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--ink-2);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  white-space: nowrap;
}
.nav__theme:hover { color: var(--ink); }

/* ---------- layout ---------- */
.container { max-width: 1080px; margin: 0 auto; padding: 1.6rem 1.5rem 3rem; }
.container--narrow { max-width: 720px; }
.page-head { margin-bottom: 1.5rem; }
.back { color: var(--ink-2); text-decoration: none; font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.09em; }
.back:hover { color: var(--accent); }
.eyebrow { font-size: 0.625rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink-3); margin: 0 0 0.35rem; }
h1 {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(1.35rem, 3vw, 1.9rem);
  letter-spacing: -0.01em;
  margin: 0.35rem 0 0;
}
.card h2, .page-head h2 {
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--ink-2);
  margin: 0 0 0.9rem;
}

/* ---------- stamps / chips ---------- */
.stamp {
  display: inline-block;
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  line-height: 1.25;
  padding: 0.2rem 0.5rem;
  border: 2px solid currentColor;
  border-radius: 0;
  color: var(--ink-3);
  transform: rotate(-1.2deg);
  white-space: nowrap;
}
.stamp--green { color: var(--green); }
.stamp--red { color: var(--accent); }
.stamp--amber { color: var(--amber); }
.stamp--blue { color: var(--blue); }
.stamp--grey { color: var(--ink-2); }
.priority {
  display: inline-block;
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  line-height: 1.25;
  padding: 0.14rem 0.5rem 0.14rem 0.55rem;
  border-left: 3px solid currentColor;
  background: var(--panel);
  color: var(--ink-2);
  white-space: nowrap;
}
.priority--critical { color: var(--accent); }
.priority--high { color: var(--amber); }
.priority--medium { color: var(--blue); }
.priority--low { color: var(--ink-2); }

/* ---------- notices ---------- */
.notice { border-left: 3px solid var(--ink-3); background: var(--panel); color: var(--ink-2); padding: 0.6rem 0.9rem; margin-bottom: 1.1rem; font-size: 0.75rem; }
.notice--ok { border-left-color: var(--green); background: #E6EFE9; color: var(--green); }
.notice--error { border-left-color: var(--accent); background: #F6E7E3; color: var(--accent); }

/* ---------- buttons ---------- */
.button {
  display: inline-block;
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--paper);
  background: var(--ink);
  border: 2px solid var(--ink);
  border-radius: 0;
  padding: 0.5rem 0.85rem;
  cursor: pointer;
  text-decoration: none;
}
.button:hover { background: var(--accent); border-color: var(--accent); }
.button:disabled { opacity: 0.45; cursor: not-allowed; }
.button--ghost { background: transparent; color: var(--ink); }
.button--ghost:hover { background: var(--ink); color: var(--paper); }
.button--danger { background: transparent; color: var(--accent); border-color: var(--accent); }
.button--danger:hover { background: var(--accent); color: var(--paper); }

/* ---------- ledger tables ---------- */
.table-wrap { background: var(--panel); border: 1px solid var(--rule); }
table.ledger { width: 100%; border-collapse: collapse; }
table.ledger th {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-3);
  text-align: left;
  padding: 0.6rem 0.9rem;
  border-bottom: 2px solid var(--ink);
  white-space: nowrap;
}
.sort-head { color: inherit; text-decoration: none; }
.sort-head:hover { color: var(--ink); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 4px; text-decoration-color: var(--ink-3); }
.sort-head.is-active { color: var(--ink); text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 4px; text-decoration-color: var(--accent); }
.sort-arrow { color: var(--accent); font-size: 0.5625rem; margin-left: 0.2em; }
table.ledger td { padding: 0.65rem 0.9rem; border-bottom: 1px solid var(--rule); font-size: 0.75rem; vertical-align: top; }
table.ledger tbody tr:hover { background: var(--panel-deep); }
table.ledger tbody tr:last-child td { border-bottom: none; }
.domain {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 0.82rem;
  letter-spacing: -0.01em;
  color: var(--ink);
  text-decoration: none;
  white-space: nowrap;
}
.domain::before { content: "▸"; color: var(--ink-3); font-family: var(--font-body); font-weight: 400; margin-right: 0.45em; }
a.domain:hover { text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; text-decoration-color: var(--accent); }
.raw { font-family: var(--font-body); font-size: 0.625rem; color: var(--ink-2); background: var(--paper); border: 1px solid var(--rule); padding: 0 0.3rem; }
.status { white-space: nowrap; }
.read-badge { color: var(--green); font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
table.ledger tr.unread td:first-child { border-left: 3px solid var(--accent); padding-left: calc(0.9rem - 3px); }

/* ---------- filters ---------- */
.filters {
  display: flex;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
  background: var(--panel);
  border: 1px solid var(--rule);
  border-bottom: 2px solid var(--ink);
  padding: 0.9rem 1rem;
  margin-bottom: 1.25rem;
}
.filter { display: flex; flex-direction: column; gap: 0.3rem; }
.filter__label { font-size: 0.625rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-3); }
select, .filters input[type="search"] {
  font-family: var(--font-body);
  font-size: 0.75rem;
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 0;
  padding: 0.45rem 0.6rem;
  min-width: 190px;
}
.filters input[type="search"] { min-width: 220px; }
.filters input[type="search"]::placeholder { color: var(--ink-3); }
.summary { color: var(--ink-2); font-size: 0.6875rem; margin: 0 0 0.9rem; }
.summary strong { color: var(--ink); }

/* ---------- cards ---------- */
.card { background: var(--panel); border: 1px solid var(--rule); border-top: 3px solid var(--ink); padding: 1.1rem 1.25rem; margin-bottom: 1.25rem; }
dl.detail { margin: 0; display: grid; grid-template-columns: max-content 1fr; column-gap: 1.75rem; }
dl.detail dt {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-3);
  padding: 0.4rem 0;
  border-bottom: 1px dashed var(--rule);
}
dl.detail dd { margin: 0; padding: 0.4rem 0; border-bottom: 1px dashed var(--rule); font-size: 0.75rem; }
dl.detail > :last-child { border-bottom: none; }
.muted { color: var(--ink-3); font-size: 0.75rem; }

/* ---------- hero (domain query line) ---------- */
.hero { margin-bottom: 1.5rem; padding-bottom: 1.1rem; border-bottom: 2px solid var(--ink); }
.hero__query {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(1.5rem, 5vw, 2.4rem);
  letter-spacing: -0.01em;
  line-height: 1.15;
  margin: 0.5rem 0 0.25rem;
  word-break: break-word;
  animation: rise 380ms ease-out both;
}
.hero__query .prompt { color: var(--ink-3); font-family: var(--font-body); font-weight: 400; }
.hero__query .cursor { color: var(--accent); animation: blink 1.1s steps(2, start) infinite; }
.hero__meta { display: flex; flex-wrap: wrap; gap: 0.9rem 1.75rem; margin-top: 0.9rem; }
.hero__fact { display: flex; flex-direction: column; gap: 0.1rem; }
.hero__fact dt { font-size: 0.5625rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: var(--ink-3); }
.hero__fact dd { margin: 0; font-size: 0.75rem; font-weight: 600; }

/* ---------- timeline (protocol log) ---------- */
.timeline { list-style: none; margin: 0; padding: 0 0 0 1.1rem; position: relative; }
.timeline::before { content: ""; position: absolute; left: 0.28rem; top: 0.3rem; bottom: 0.3rem; width: 2px; background: var(--rule); }
.timeline-item { position: relative; display: grid; grid-template-columns: auto 7.5rem 1fr auto; gap: 0.9rem; align-items: baseline; padding: 0.55rem 0; border-bottom: 1px dashed var(--rule); font-size: 0.75rem; }
.timeline-item:last-child { border-bottom: none; }
.timeline-item::before { content: ""; position: absolute; left: -1.1rem; top: 1.05rem; width: 0.72rem; border-top: 2px solid var(--rule); }
.timeline-item time { color: var(--ink-3); white-space: nowrap; }
.timeline-source { color: var(--blue); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.625rem; }
.timeline-type { color: var(--ink); }
.timeline-change { color: var(--amber); }

/* ---------- forms ---------- */
.field { margin-bottom: 1rem; }
.field > label { display: block; font-size: 0.625rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-2); margin-bottom: 0.35rem; }
.field input[type="text"], .field input[type="email"], .field input[type="number"], .field input[type="password"] {
  font-family: var(--font-body);
  font-size: 0.85rem;
  color: var(--ink);
  width: 100%;
  padding: 0.5rem 0.1rem;
  border: none;
  border-bottom: 2px solid var(--ink);
  border-radius: 0;
  background: transparent;
}
.field input::placeholder { color: var(--ink-3); }
.field input:focus { border-bottom-color: var(--accent); }
.field-error { color: var(--accent); font-size: 0.75rem; font-weight: 700; margin-top: 0.35rem; }
.hint, .field-hint { color: var(--ink-3); font-size: 0.6875rem; margin-top: 0.35rem; }
.form-card form { margin-top: 0.5rem; }
.actions { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; }
.source-row { display: flex; gap: 1rem; align-items: baseline; margin-top: 0.9rem; padding-top: 0.9rem; border-top: 1px dashed var(--rule); }
.source-row dt { font-size: 0.625rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-3); min-width: 6rem; }
.source-row dd { margin: 0; }

/* ---------- auth ---------- */
.auth { max-width: 400px; margin: 8vh auto 0; }
.auth__brand {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 1.15rem;
  letter-spacing: -0.01em;
  color: var(--ink);
  text-decoration: none;
  display: inline-block;
  margin-bottom: 2rem;
}
.auth__brand .cursor { color: var(--accent); animation: blink 1.1s steps(2, start) infinite; }
.auth-form {
  background: var(--panel);
  border: 1px solid var(--rule);
  border-top: 3px solid var(--ink);
  padding: 1.5rem 1.25rem 1.25rem;
  margin-top: 1.25rem;
}
.auth-form .button { width: 100%; }

/* ---------- states ---------- */
.empty, .loading { padding: 2.5rem 1rem; text-align: center; color: var(--ink-3); font-size: 0.75rem; }
.inline { display: inline; }
.inline-form { display: inline-block; margin-right: 0.5rem; margin-bottom: 0.5rem; }

/* ---------- settings ---------- */
form.settings { display: flex; flex-direction: column; gap: 1.1rem; background: var(--panel); border: 1px solid var(--rule); border-top: 3px solid var(--ink); padding: 1.25rem; }
form.settings label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.625rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-2); }
form.settings input { font-family: var(--font-body); font-size: 0.85rem; color: var(--ink); width: 100%; padding: 0.5rem 0.1rem; border: none; border-bottom: 2px solid var(--ink); border-radius: 0; background: transparent; }
form.settings input:focus { border-bottom-color: var(--accent); }
form.settings input::placeholder { color: var(--ink-3); }
form.settings input:invalid { border-bottom-color: var(--accent); }
form.settings .field-hint { font-weight: 400; text-transform: none; letter-spacing: 0; }

/* ---------- motion ---------- */
@keyframes blink { 50% { opacity: 0; } }
@keyframes rise { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .cursor, .nav__brand .cursor, .hero__query .cursor { animation: none; }
  .hero__query { animation: none; }
}

/* ---------- responsive ---------- */
@media (max-width: 640px) {
  .nav { padding: 0.6rem 1rem; gap: 0.9rem; }
  .container { padding: 1.1rem 1rem 2.5rem; }
  .filter { width: 100%; }
  select, .filters input[type="search"] { width: 100%; min-width: 0; }
  .filters { align-items: stretch; }
  dl.detail { grid-template-columns: 1fr; row-gap: 0; }
  dl.detail dt { padding-top: 0.8rem; }
  .timeline-item { grid-template-columns: 1fr; gap: 0.1rem; }
  .timeline-item time { font-size: 0.625rem; }
  .timeline-source { margin-top: 0.15rem; }
  .domain { white-space: normal; }
  .table-wrap { overflow-x: auto; }
  table.ledger { min-width: 760px; }
}
`;
