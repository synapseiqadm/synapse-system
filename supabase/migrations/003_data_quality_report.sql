CREATE TABLE IF NOT EXISTS public.data_quality_report (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id     UUID NOT NULL,
    check_name       TEXT NOT NULL,
    check_category   TEXT NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('passed', 'warning', 'failed')),
    severity         TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    source_platform  TEXT,
    target_table     TEXT,
    metric_value     NUMERIC,
    threshold_value  NUMERIC,
    affected_rows    INTEGER DEFAULT 0,
    details          JSONB,
    date_range_start DATE,
    date_range_end   DATE,
    checked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dqr_workspace_id ON public.data_quality_report (workspace_id);
CREATE INDEX IF NOT EXISTS idx_dqr_checked_at   ON public.data_quality_report (checked_at);
CREATE INDEX IF NOT EXISTS idx_dqr_status       ON public.data_quality_report (status);
CREATE INDEX IF NOT EXISTS idx_dqr_severity     ON public.data_quality_report (severity);
CREATE INDEX IF NOT EXISTS idx_dqr_date_range   ON public.data_quality_report (date_range_start, date_range_end);

ALTER TABLE public.data_quality_report ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leitura pública qualidade"
  ON public.data_quality_report
  FOR SELECT
  TO public
  USING (true);
