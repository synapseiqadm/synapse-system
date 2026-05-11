-- ── 010 operational_events — Causal Intelligence event registry ───────────────
--
-- Context:
--   Introduces the `operational_events` table to record deliberate changes
--   (interventions, governance fixes) and detected anomalies (ROAS deviation,
--   sync errors) for historical causal analysis.
--
-- Decision:
--   Separate from `sync_runs` and `data_quality_report`: those track pipeline
--   state; this table tracks domain-level events that can be correlated with
--   KPI movements (Causal Intelligence, v1.8+).
--
--   `impact_scope` is JSONB to allow heterogeneous event payloads without
--   schema churn as new event types are introduced.
--
--   `evidence_id` is a nullable FK to `semantic_governance_evidence` to allow
--   governance findings to be cross-referenced as causal evidence.
--
-- RLS:
--   Enabled via migration 011. Service-key backend writes bypass RLS.
--   Frontend reads are scoped to the Woke workspace (011 policy).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.operational_events (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID        NOT NULL REFERENCES public.workspaces(id),
    event_type   TEXT        NOT NULL, -- 'intervention' | 'governance_fix' | 'anomaly' | 'system_change'
    category     TEXT        NOT NULL, -- 'budget' | 'naming' | 'tracking' | 'strategy' | 'kpi_anomaly' | 'sync_error' | 'sync_success'
    title        TEXT,
    description  TEXT,
    impact_scope JSONB,                -- { "metric": "roas", "value": 0.24, "deviation_pct": 35.2, ... }
    actor        TEXT        DEFAULT 'system',
    evidence_id  UUID,                 -- nullable FK to semantic_governance_evidence
    occurred_at  TIMESTAMPTZ DEFAULT NOW(),
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ops_events_workspace_time
    ON public.operational_events (workspace_id, occurred_at DESC);

CREATE INDEX idx_ops_events_impact_scope
    ON public.operational_events USING GIN (impact_scope);

COMMENT ON TABLE public.operational_events IS
    'Domain-level events (interventions, anomalies, sync outcomes) for causal analysis against KPI movements.';
