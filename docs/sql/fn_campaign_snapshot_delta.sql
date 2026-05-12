-- ============================================================
-- fn_campaign_snapshot_delta.sql
-- SynapseIQ v1.9.1-REV — Snapshot Engine: SQL Delta Logic
--
-- REVISION HISTORY
--   v1.9.1  : Initial — spend, conversions, cpa
--   v1.9.1-REV: Adds clicks, ctr (%), cpc — requires migration 012
--
-- Compares campaign performance between two periods:
--   Period A (date_a) : D-1  — Yesterday
--   Period B (date_b) : D-8  — Same weekday, prior week
--
-- Source table : public.campaign_summary
-- Grain assumed: one row per (workspace_id, campaign_id, date)
--   i.e. date_range_start = date_range_end = target_date
--
-- Available metrics:
--   spend       — SUM(cost)
--   conversions — SUM(conversions)
--   clicks      — SUM(clicks)              [requires migration 012]
--   cpa         — spend / conversions       (NULL if conversions = 0)
--   cpc         — spend / clicks            (NULL if clicks = 0)
--   ctr         — clicks / impressions × 100% (NULL if impressions = 0)
--
-- PREREQUISITE: migration 012 must be applied before executing this
-- function. Running it without clicks/impressions columns will error.
--
-- Delta formula : ((value_now - value_then) / NULLIF(value_then, 0)) × 100
-- Impact levels : CRITICAL > 50% | SIGNIFICANT > 15%
-- Output filter : ABS(delta) > 15% only
--
-- NOTE ON FUNCTION NAME:
--   The v1.8/v1.9 spec docs reference "get_performance_snapshot".
--   The canonical deployed name is fn_campaign_snapshot_delta.
--   Use this name in all integrations and AI narrative calls.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_campaign_snapshot_delta(
    target_workspace_id UUID
)
RETURNS TABLE (
    campaign_name    TEXT,
    metric_name      TEXT,
    value_now        NUMERIC,
    value_then       NUMERIC,
    delta_percentage NUMERIC,
    impact_level     TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    date_a DATE := CURRENT_DATE - 1;  -- D-1 : Yesterday
    date_b DATE := CURRENT_DATE - 8;  -- D-8 : Same weekday, prior week
BEGIN
    RETURN QUERY
    WITH period_a AS (
        -- Aggregate all rows for the workspace on D-1
        SELECT
            cs.campaign_name,
            SUM(cs.cost)                                          AS spend,
            SUM(cs.conversions)                                   AS conversions,
            SUM(cs.clicks)                                        AS clicks,
            SUM(cs.impressions)                                   AS impressions
        FROM public.campaign_summary cs
        WHERE cs.workspace_id    = target_workspace_id
          AND cs.date_range_start = date_a
          AND cs.date_range_end   = date_a
          AND cs.is_mock          = FALSE
        GROUP BY cs.campaign_name
    ),

    period_b AS (
        -- Aggregate all rows for the workspace on D-8
        SELECT
            cs.campaign_name,
            SUM(cs.cost)                                          AS spend,
            SUM(cs.conversions)                                   AS conversions,
            SUM(cs.clicks)                                        AS clicks,
            SUM(cs.impressions)                                   AS impressions
        FROM public.campaign_summary cs
        WHERE cs.workspace_id    = target_workspace_id
          AND cs.date_range_start = date_b
          AND cs.date_range_end   = date_b
          AND cs.is_mock          = FALSE
        GROUP BY cs.campaign_name
    ),

    combined AS (
        -- Full outer join so campaigns absent on one side don't vanish.
        -- Campaigns with spend = 0 in BOTH periods are excluded.
        -- CTR is computed from aggregated clicks/impressions (CTR is non-additive).
        SELECT
            COALESCE(a.campaign_name, b.campaign_name)::TEXT AS campaign_name,

            -- Spend
            COALESCE(a.spend,        0) AS spend_now,
            COALESCE(b.spend,        0) AS spend_then,

            -- Conversions
            COALESCE(a.conversions,  0) AS conv_now,
            COALESCE(b.conversions,  0) AS conv_then,

            -- Clicks (raw; used to derive CPC and CTR)
            COALESCE(a.clicks,       0) AS clicks_now,
            COALESCE(b.clicks,       0) AS clicks_then,

            -- CTR: recomputed from aggregated clicks/impressions.
            -- Stored ctr column is NOT used to avoid incorrect summation.
            -- Expressed as percentage (× 100) for delta readability.
            CASE WHEN COALESCE(a.impressions, 0) > 0
                 THEN ROUND((a.clicks::NUMERIC / a.impressions) * 100, 4)
                 ELSE NULL END AS ctr_now,
            CASE WHEN COALESCE(b.impressions, 0) > 0
                 THEN ROUND((b.clicks::NUMERIC / b.impressions) * 100, 4)
                 ELSE NULL END AS ctr_then

        FROM period_a  a
        FULL OUTER JOIN period_b b USING (campaign_name)
        WHERE NOT (COALESCE(a.spend, 0) = 0 AND COALESCE(b.spend, 0) = 0)
    ),

    metrics_long AS (
        -- Unpivot to one row per (campaign, metric)

        -- spend
        SELECT campaign_name, 'spend'::TEXT       AS metric_name,
               spend_now  AS value_now, spend_then  AS value_then
        FROM combined

        UNION ALL

        -- conversions
        SELECT campaign_name, 'conversions'::TEXT AS metric_name,
               conv_now   AS value_now, conv_then   AS value_then
        FROM combined

        UNION ALL

        -- clicks — excluded when 0 in both periods (no signal)
        SELECT campaign_name, 'clicks'::TEXT      AS metric_name,
               clicks_now::NUMERIC AS value_now, clicks_then::NUMERIC AS value_then
        FROM combined
        WHERE clicks_now > 0 OR clicks_then > 0

        UNION ALL

        -- cpa = spend / conversions (NULL when conversions = 0 in either period)
        SELECT
            campaign_name,
            'cpa'::TEXT AS metric_name,
            CASE WHEN conv_now  > 0 THEN ROUND(spend_now  / conv_now,  2) ELSE NULL END AS value_now,
            CASE WHEN conv_then > 0 THEN ROUND(spend_then / conv_then, 2) ELSE NULL END AS value_then
        FROM combined

        UNION ALL

        -- cpc = spend / clicks (NULL when clicks = 0 in either period)
        SELECT
            campaign_name,
            'cpc'::TEXT AS metric_name,
            CASE WHEN clicks_now  > 0 THEN ROUND(spend_now  / clicks_now,  2) ELSE NULL END AS value_now,
            CASE WHEN clicks_then > 0 THEN ROUND(spend_then / clicks_then, 2) ELSE NULL END AS value_then
        FROM combined

        UNION ALL

        -- ctr expressed as percentage (ctr_now is already × 100)
        -- NULL rows (no impressions) are filtered by the WHERE clause in deltas
        SELECT
            campaign_name,
            'ctr'::TEXT AS metric_name,
            ctr_now  AS value_now,
            ctr_then AS value_then
        FROM combined
    ),

    deltas AS (
        -- Calculate delta; rows where value_then = 0 produce NULL delta and
        -- are excluded downstream by the ABS(delta) > 15 filter.
        SELECT
            ml.campaign_name,
            ml.metric_name,
            ROUND(ml.value_now,  2) AS value_now,
            ROUND(ml.value_then, 2) AS value_then,
            ROUND(
                ((ml.value_now - ml.value_then) / NULLIF(ml.value_then, 0)) * 100,
                2
            ) AS delta_pct
        FROM metrics_long ml
        WHERE ml.value_now  IS NOT NULL
          AND ml.value_then IS NOT NULL
    )

    SELECT
        d.campaign_name,
        d.metric_name,
        d.value_now,
        d.value_then,
        d.delta_pct AS delta_percentage,
        CASE
            WHEN ABS(d.delta_pct) > 50 THEN 'CRITICAL'
            ELSE 'SIGNIFICANT'
        END          AS impact_level
    FROM deltas d
    WHERE ABS(d.delta_pct) > 15
    ORDER BY ABS(d.delta_pct) DESC;

END;
$$;

-- ------------------------------------------------------------
-- Access grants (MVP: anon + authenticated)
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.fn_campaign_snapshot_delta(UUID)
    TO anon, authenticated;

-- ------------------------------------------------------------
-- Usage
-- SELECT * FROM public.fn_campaign_snapshot_delta(
--     'a082fe86-a65f-4c9b-9442-fe775f47e3fc'
-- );
-- ------------------------------------------------------------
