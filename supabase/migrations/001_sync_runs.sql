CREATE TABLE IF NOT EXISTS sync_runs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id     UUID NOT NULL,
    source_platform  TEXT NOT NULL,
    data_source      TEXT NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('running','success','error')),
    started_at       TIMESTAMPTZ NOT NULL,
    finished_at      TIMESTAMPTZ,
    rows_loaded      INTEGER DEFAULT 0,
    is_mock          BOOLEAN DEFAULT FALSE,
    date_range_start DATE,
    date_range_end   DATE,
    error_message    TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);
