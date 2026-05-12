-- ============================================================
-- 012_campaign_summary_expand_metrics.sql
-- SynapseIQ v1.8.1/4 — Schema Expansion: Full Funnel Metrics
--
-- Status : DRAFT — awaiting Architecture approval before
--          promotion to supabase/migrations/
--
-- Purpose:
--   Expand campaign_summary to include upper-funnel metrics
--   (clicks, impressions) and derived indicators (ctr, ad_quality_score)
--   required by fn_campaign_snapshot_delta v2 (clicks/CTR/CPC deltas)
--   and the v1.9 AI Narrative layer.
--
-- Safety:
--   All new columns use DEFAULT 0 or NULL to ensure historical rows
--   remain query-stable after migration. No existing data is altered.
--   No constraint changes — upsert key (012_metadata_and_constraints)
--   is unaffected.
--
-- Notes:
--   - ctr is stored as a FRACTION (0.0123 = 1.23%), not a percentage.
--     CTR is NON-ADDITIVE: never SUM across rows. Always recompute as
--     SUM(clicks) / NULLIF(SUM(impressions), 0) when aggregating.
--   - ad_quality_score is nullable. Google Ads exposes Quality Score at
--     keyword level only; at campaign level it is an average and may not
--     be available for all campaign types (Performance Max, Display).
--   - ad_quality_score range: 1.0 – 10.0 (Google Ads integer 1–10,
--     stored as NUMERIC(4,2) to accommodate future weighted averages).
-- ============================================================

ALTER TABLE public.campaign_summary
    ADD COLUMN IF NOT EXISTS clicks           INTEGER      DEFAULT 0,
    ADD COLUMN IF NOT EXISTS impressions      INTEGER      DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ctr              NUMERIC(8,6) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ad_quality_score NUMERIC(4,2);

-- ── Index: clicks-based queries (CPC/CTR analysis, budget efficiency) ─────────
-- Partial index only on rows that have click data to keep size minimal.
CREATE INDEX IF NOT EXISTS idx_campaign_summary_clicks_nonzero
    ON public.campaign_summary (workspace_id, date_range_start)
    WHERE clicks > 0;

COMMENT ON COLUMN public.campaign_summary.clicks IS
    'Total clicks in the date range. Non-additive with impressions — recompute CTR on aggregation.';
COMMENT ON COLUMN public.campaign_summary.impressions IS
    'Total impressions in the date range.';
COMMENT ON COLUMN public.campaign_summary.ctr IS
    'Click-through rate as a fraction (e.g., 0.0123 = 1.23%). Recompute from clicks/impressions when aggregating across rows.';
COMMENT ON COLUMN public.campaign_summary.ad_quality_score IS
    'Google Ads Quality Score average (1.0–10.0). Nullable: not available for all campaign types (PMax, Display).';
