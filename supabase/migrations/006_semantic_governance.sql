-- ── 006 Semantic Governance — persistence tables ─────────────────────────────
-- Creates three tables to persist governance run state, per-check findings,
-- and list-type evidence extracted from finding details.
--
-- NOTE: Mart views (docs/sql/mart_*.sql) are analytical proposals and are
-- NOT part of this migration — apply them separately via Supabase Studio.
--
-- Apply with:
--   supabase db execute --file supabase/migrations/006_semantic_governance.sql
--   or paste directly in Supabase Studio > SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── semantic_governance_runs ──────────────────────────────────────────────────
-- One row per pipeline execution per tenant.

CREATE TABLE IF NOT EXISTS semantic_governance_runs (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id     UUID        NOT NULL,
    tenant_slug      TEXT        NOT NULL,
    date_range_start DATE        NOT NULL,
    date_range_end   DATE        NOT NULL,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at      TIMESTAMPTZ,
    status           TEXT        NOT NULL DEFAULT 'running'
                                 CHECK (status IN ('running', 'success', 'error')),
    checks_run       INTEGER     NOT NULL DEFAULT 0,
    findings_count   INTEGER     NOT NULL DEFAULT 0,
    error_message    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sgr_workspace_period
    ON semantic_governance_runs (workspace_id, date_range_start, date_range_end);

CREATE INDEX IF NOT EXISTS idx_sgr_status
    ON semantic_governance_runs (status, created_at DESC);


-- ── semantic_governance_findings ─────────────────────────────────────────────
-- One row per DQ check result within a run.

CREATE TABLE IF NOT EXISTS semantic_governance_findings (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id           UUID        NOT NULL
                                 REFERENCES semantic_governance_runs (id)
                                 ON DELETE CASCADE,
    workspace_id     UUID        NOT NULL,
    check_name       TEXT        NOT NULL,
    status           TEXT        NOT NULL,
    severity         TEXT        NOT NULL,
    source_platform  TEXT        NOT NULL DEFAULT 'ga4',
    affected_rows    INTEGER     NOT NULL DEFAULT 0,
    metric_value     NUMERIC,
    threshold_value  NUMERIC,
    details          JSONB,
    date_range_start DATE        NOT NULL,
    date_range_end   DATE        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sgf_run_id
    ON semantic_governance_findings (run_id);

CREATE INDEX IF NOT EXISTS idx_sgf_workspace_check
    ON semantic_governance_findings (workspace_id, check_name, date_range_start DESC);

CREATE INDEX IF NOT EXISTS idx_sgf_status_severity
    ON semantic_governance_findings (status, severity);

CREATE INDEX IF NOT EXISTS idx_sgf_details
    ON semantic_governance_findings USING GIN (details);


-- ── semantic_governance_evidence ─────────────────────────────────────────────
-- List-type evidence rows extracted from finding details.
-- Each list item (e.g. one unregistered Ads action) is its own row.
-- Capped at MAX_EVIDENCE_ROWS_PER_FINDING (25) per list key by the pipeline.

CREATE TABLE IF NOT EXISTS semantic_governance_evidence (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    finding_id     UUID        NOT NULL
                               REFERENCES semantic_governance_findings (id)
                               ON DELETE CASCADE,
    evidence_type  TEXT        NOT NULL,
    evidence_data  JSONB       NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sge_finding_id
    ON semantic_governance_evidence (finding_id);

CREATE INDEX IF NOT EXISTS idx_sge_evidence_type
    ON semantic_governance_evidence (finding_id, evidence_type);

CREATE INDEX IF NOT EXISTS idx_sge_evidence_data
    ON semantic_governance_evidence USING GIN (evidence_data);
