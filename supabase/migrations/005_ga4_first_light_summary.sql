CREATE TABLE IF NOT EXISTS public.ga4_first_light_summary (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        UUID         NOT NULL,
    ga4_dataset         TEXT         NOT NULL,
    latest_event_table  TEXT,
    latest_event_date   DATE,
    total_events        INTEGER,
    total_users         INTEGER,
    sessions            INTEGER,
    page_views          INTEGER,
    top_events          JSONB,
    top_landing_pages   JSONB,
    conversion_events   JSONB,
    source_platform     TEXT         DEFAULT 'ga4',
    data_source         TEXT         DEFAULT 'bigquery',
    is_mock             BOOLEAN      DEFAULT FALSE,
    date_range_start    DATE,
    date_range_end      DATE,
    loaded_at           TIMESTAMPTZ  DEFAULT NOW(),
    created_at          TIMESTAMPTZ  DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  DEFAULT NOW(),

    CONSTRAINT ga4_first_light_summary_dedupe
        UNIQUE (workspace_id, ga4_dataset, date_range_start, date_range_end)
);

CREATE INDEX IF NOT EXISTS idx_ga4fl_workspace_id    ON public.ga4_first_light_summary (workspace_id);
CREATE INDEX IF NOT EXISTS idx_ga4fl_ga4_dataset     ON public.ga4_first_light_summary (ga4_dataset);
CREATE INDEX IF NOT EXISTS idx_ga4fl_loaded_at       ON public.ga4_first_light_summary (loaded_at);
CREATE INDEX IF NOT EXISTS idx_ga4fl_date_range      ON public.ga4_first_light_summary (date_range_start, date_range_end);

ALTER TABLE public.ga4_first_light_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leitura pública ga4_first_light_summary"
    ON public.ga4_first_light_summary
    FOR SELECT
    TO public
    USING (true);
