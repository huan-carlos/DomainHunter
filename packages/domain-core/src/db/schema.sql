-- DomainHunter SQLite schema (initial migration).
-- Conventions: dates are UTC ISO-8601; `id` is UUID v7; `user_id` is NULL for
-- the single-user MVP (RNF-024, multiuser-ready).
-- Source: LEX-14 technical plan, section 5.

CREATE TABLE IF NOT EXISTS release_processes (
  id TEXT PRIMARY KEY,
  source_reference TEXT NOT NULL,
  start_at TEXT,
  end_at TEXT,
  publication_at TEXT,
  candidature_window_start_at TEXT,
  candidature_window_end_at TEXT,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  raw_json TEXT,
  collected_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_release_processes_status ON release_processes(status);
CREATE INDEX IF NOT EXISTS idx_release_processes_source ON release_processes(source);

CREATE TABLE IF NOT EXISTS domain_watches (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  user_id TEXT,
  status TEXT NOT NULL,
  raw_last_status TEXT,
  priority TEXT NOT NULL,
  monitoring_state TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL,
  last_check_at TEXT,
  next_check_at TEXT NOT NULL,
  expiration_at TEXT,
  last_known_owner TEXT,
  last_known_owner_id TEXT,
  release_process_id TEXT REFERENCES release_processes(id),
  release_start_at TEXT,
  release_end_at TEXT,
  last_whois_check_at TEXT,
  last_rdap_check_at TEXT,
  last_isavail_check_at TEXT,
  last_successful_check_at TEXT,
  available_since TEXT,
  check_failure_count INTEGER NOT NULL DEFAULT 0,
  phase TEXT NOT NULL DEFAULT 'A',
  client_versions TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_domain_watches_status ON domain_watches(status);
CREATE INDEX IF NOT EXISTS idx_domain_watches_next_check ON domain_watches(next_check_at);
CREATE INDEX IF NOT EXISTS idx_domain_watches_monitoring ON domain_watches(monitoring_state);

CREATE TABLE IF NOT EXISTS domain_events (
  id TEXT PRIMARY KEY,
  domain_watch_id TEXT NOT NULL REFERENCES domain_watches(id),
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  evidence_json TEXT NOT NULL,
  priority TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_domain_events_watch ON domain_events(domain_watch_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id TEXT PRIMARY KEY,
  domain_watch_id TEXT NOT NULL REFERENCES domain_watches(id),
  kind TEXT NOT NULL,
  run_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_retry_at TEXT,
  last_error TEXT,
  locked_by TEXT,
  locked_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_due ON scheduled_jobs(status, run_at);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  domain_watch_id TEXT NOT NULL REFERENCES domain_watches(id),
  domain_event_id TEXT NOT NULL REFERENCES domain_events(id),
  channel TEXT NOT NULL,
  priority TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  sent_at TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (channel, dedup_key)
);

CREATE INDEX IF NOT EXISTS idx_notifications_watch ON notifications(domain_watch_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_channel_created ON notifications(channel, created_at DESC);

-- Notification settings (RF-021): alert email + expiration notice lead time.
-- Single row (id = 'default'); MVP is single-user (RNF-024).
CREATE TABLE IF NOT EXISTS notification_settings (
  id TEXT PRIMARY KEY,
  notification_email TEXT,
  expiration_notice_days INTEGER NOT NULL DEFAULT 45,
  updated_at TEXT NOT NULL
);
