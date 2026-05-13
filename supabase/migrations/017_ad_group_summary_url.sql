ALTER TABLE public.ad_group_summary
  ADD COLUMN IF NOT EXISTS final_url        TEXT,
  ADD COLUMN IF NOT EXISTS http_status_code INTEGER,
  ADD COLUMN IF NOT EXISTS load_time_ms     INTEGER;
