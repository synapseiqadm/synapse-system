-- campaign_summary: add metadata columns
ALTER TABLE campaign_summary
    ADD COLUMN IF NOT EXISTS source_platform TEXT,
    ADD COLUMN IF NOT EXISTS is_mock BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS date_range_start DATE,
    ADD COLUMN IF NOT EXISTS date_range_end DATE,
    ADD COLUMN IF NOT EXISTS loaded_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE campaign_summary ALTER COLUMN campaign_id TYPE TEXT USING campaign_id::TEXT;
ALTER TABLE campaign_summary ALTER COLUMN conversions TYPE NUMERIC(10,2) USING conversions::NUMERIC;

ALTER TABLE campaign_summary
    ADD CONSTRAINT campaign_summary_upsert_key
    UNIQUE (workspace_id, campaign_id, date_range_start, date_range_end);

-- keyword_analysis: add metadata columns
ALTER TABLE keyword_analysis
    ADD COLUMN IF NOT EXISTS source_platform TEXT,
    ADD COLUMN IF NOT EXISTS is_mock BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS date_range_start DATE,
    ADD COLUMN IF NOT EXISTS date_range_end DATE,
    ADD COLUMN IF NOT EXISTS loaded_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE keyword_analysis ALTER COLUMN campaign_id TYPE TEXT USING campaign_id::TEXT;
ALTER TABLE keyword_analysis ALTER COLUMN conversions TYPE NUMERIC(10,2) USING conversions::NUMERIC;

ALTER TABLE keyword_analysis
    DROP CONSTRAINT IF EXISTS keyword_analysis_workspace_id_campaign_name_keyword_key;
ALTER TABLE keyword_analysis
    ADD CONSTRAINT keyword_analysis_upsert_key
    UNIQUE (workspace_id, campaign_id, keyword, match_type, date_range_start, date_range_end);
