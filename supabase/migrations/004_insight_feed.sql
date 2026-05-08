CREATE TABLE IF NOT EXISTS public.insight_feed (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id     UUID         NOT NULL,
    insight_type     TEXT         NOT NULL,
    severity         TEXT         NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status           TEXT         NOT NULL DEFAULT 'new'
                                  CHECK (status IN ('new', 'reviewed', 'dismissed', 'resolved')),
    title            TEXT         NOT NULL,
    summary          TEXT         NOT NULL,
    recommendation   TEXT,
    evidence         JSONB,
    source_tables    TEXT[],
    confidence       NUMERIC,
    date_range_start DATE,
    date_range_end   DATE,
    dedupe_key       TEXT         NOT NULL,
    created_at       TIMESTAMPTZ  DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  DEFAULT NOW(),

    -- Prevents duplicates across re-runs for the same workspace/insight/period.
    -- dedupe_key is computed in Python; see insights.py.
    -- NOTE: status resets to 'new' on upsert within the same period (by design in v1).
    CONSTRAINT insight_feed_dedupe
        UNIQUE (workspace_id, dedupe_key, date_range_start, date_range_end)
);

CREATE INDEX IF NOT EXISTS idx_if_workspace_id ON public.insight_feed (workspace_id);
CREATE INDEX IF NOT EXISTS idx_if_insight_type ON public.insight_feed (insight_type);
CREATE INDEX IF NOT EXISTS idx_if_severity     ON public.insight_feed (severity);
CREATE INDEX IF NOT EXISTS idx_if_status       ON public.insight_feed (status);
CREATE INDEX IF NOT EXISTS idx_if_created_at   ON public.insight_feed (created_at);
CREATE INDEX IF NOT EXISTS idx_if_date_range   ON public.insight_feed (date_range_start, date_range_end);

ALTER TABLE public.insight_feed ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leitura pública insights"
    ON public.insight_feed
    FOR SELECT
    TO public
    USING (true);
