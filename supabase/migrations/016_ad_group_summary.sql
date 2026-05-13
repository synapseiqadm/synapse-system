CREATE TABLE IF NOT EXISTS public.ad_group_summary (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id     UUID        NOT NULL,
  ad_group_id      TEXT        NOT NULL,
  ad_group_name    TEXT        NOT NULL,
  campaign_id      TEXT        NOT NULL,
  campaign_name    TEXT        NOT NULL,
  cost             NUMERIC     NOT NULL DEFAULT 0,
  clicks           INTEGER     NOT NULL DEFAULT 0,
  impressions      INTEGER     NOT NULL DEFAULT 0,
  ctr              NUMERIC     NOT NULL DEFAULT 0,
  conversions      NUMERIC     NOT NULL DEFAULT 0,
  roas             NUMERIC     NOT NULL DEFAULT 0,
  ad_strength      TEXT,
  date_range_start DATE        NOT NULL,
  date_range_end   DATE        NOT NULL,
  loaded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, ad_group_id, date_range_start, date_range_end)
);

ALTER TABLE public.ad_group_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ad_group_summary_read_authenticated"
ON public.ad_group_summary
FOR SELECT
TO authenticated
USING (workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid()));
