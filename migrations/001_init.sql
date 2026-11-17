-- Sprinto cold-outreach prototype: minimal schema.
-- Tables: companies, evidence, contacts, outreach, runs (+ events for the audit log).

CREATE TABLE IF NOT EXISTS companies (
  id            SERIAL PRIMARY KEY,
  domain        TEXT NOT NULL UNIQUE,
  name          TEXT,
  profile       JSONB,
  icp_status    TEXT CHECK (icp_status IN ('QUALIFIED','DISQUALIFIED','NEEDS_MORE_INFO','MANUAL_REVIEW')),
  icp_reasoning TEXT,
  icp_verdict   JSONB,
  status        TEXT NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING','RESEARCHING','QUALIFIED','DISQUALIFIED','MANUAL_REVIEW','DRAFT_READY','SENT','FAILED')),
  review_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status);

CREATE TABLE IF NOT EXISTS evidence (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_url      TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'page' CHECK (kind IN ('homepage','page')),
  fetch_ok        BOOLEAN NOT NULL DEFAULT TRUE,
  fetch_error     TEXT,
  content         TEXT,            -- cleaned page text (cache of the scrape)
  links           JSONB,           -- same-domain links discovered on the page
  extracted_facts JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, source_url)
);
CREATE INDEX IF NOT EXISTS idx_evidence_company ON evidence(company_id);

CREATE TABLE IF NOT EXISTS contacts (
  id                  SERIAL PRIMARY KEY,
  company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  title               TEXT NOT NULL,
  email               TEXT NOT NULL,
  source              TEXT NOT NULL DEFAULT 'hunter.io',
  verification_status TEXT NOT NULL,
  confidence          INTEGER,
  rank_reason         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, email)
);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);

CREATE TABLE IF NOT EXISTS outreach (
  id               SERIAL PRIMARY KEY,
  company_id       INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  campaign         TEXT NOT NULL DEFAULT 'default',
  contact_id       INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  pain_points      JSONB,
  subject          TEXT,
  draft            TEXT,
  hook             JSONB,
  draft_history    JSONB NOT NULL DEFAULT '[]'::jsonb,
  revision_count   INTEGER NOT NULL DEFAULT 0,
  send_status      TEXT NOT NULL DEFAULT 'NOT_SENT'
                   CHECK (send_status IN ('NOT_SENT','SENDING','SENT','FAILED')),
  gmail_message_id TEXT,
  gmail_status     TEXT,           -- e.g. API_ACCEPTED (NOT proof of inbox delivery)
  sent_to          TEXT,
  sent_at          TIMESTAMPTZ,
  send_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, campaign)    -- one outreach row (and so one send) per company/campaign
);

CREATE TABLE IF NOT EXISTS runs (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  current_stage TEXT NOT NULL DEFAULT 'scrape'
                CHECK (current_stage IN ('scrape','extract','qualify','research','contact','painpoints','draft','done')),
  attempts      INTEGER NOT NULL DEFAULT 0,   -- stage executions (incl. retries)
  pages_fetched INTEGER NOT NULL DEFAULT 0,   -- additional pages beyond homepage (max 4)
  duration_ms   INTEGER NOT NULL DEFAULT 0,   -- cumulative processing time
  errors        JSONB NOT NULL DEFAULT '[]'::jsonb,
  locked_until  TIMESTAMPTZ,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id         BIGSERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,   -- research | qualification | api_failure | draft | send | error | review
  stage      TEXT,
  message    TEXT NOT NULL,
  data       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_company ON events(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, created_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
