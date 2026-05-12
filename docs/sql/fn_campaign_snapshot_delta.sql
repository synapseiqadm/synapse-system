-- ============================================================
-- fn_campaign_snapshot_delta.sql
-- SynapseIQ v1.9.2 — Snapshot Engine: SQL Delta Logic
--
-- REVISION HISTORY
--   v1.9.1        : Initial — spend, conversions, cpa (daily grain)
--   v1.9.1-REV    : Adds clicks, ctr (%), cpc — requires migration 012
--   v1.9.2 (v3)   : Rolling-window support + ambiguity fix (migration 012)
--
-- Compares campaign performance between two rolling 30-day windows:
--   Period A (date_a) : MAX(date_range_end) — most recent sync
--   Period B (date_b) : date_a - 7          — equivalent window, 7 days prior
--
-- Periods are resolved dynamically from available data.
-- If date_b has no rows, the function returns an empty result set
-- (expected behaviour early in deployment before 7 days of syncs exist).
--
-- Source table : public.campaign_summary
-- Grain assumed: one row per (workspace_id, campaign_id, date_range_end)
--   i.e. rolling 30-day windows synced daily via sync_ads.py
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
    date_a DATE;
    date_b DATE;
BEGIN
    -- Resolve the most recent rolling window available for this workspace.
    SELECT MAX(cs.date_range_end) INTO date_a
    FROM public.campaign_summary cs
    WHERE cs.workspace_id = target_workspace_id
      AND cs.is_mock = FALSE;

    -- No data at all — return empty.
    IF date_a IS NULL THEN
        RETURN;
    END IF;

    -- Comparison period: same window shifted 7 days back.
    -- If this period has no rows, the function returns empty (expected early in deployment).
    date_b := date_a - 7;

    RETURN QUERY
    WITH period_a AS (
        -- Aggregate all campaigns for the workspace on the latest window.
        -- Uses cname alias to avoid ambiguity with RETURNS TABLE column.
        SELECT
            cs.campaign_name                                      AS cname,
            SUM(cs.cost)                                          AS spend,
            SUM(cs.conversions)                                   AS conversions,
            SUM(cs.clicks)                                        AS clicks,
            SUM(cs.impressions)                                   AS impressions
        FROM public.campaign_summary cs
        WHERE cs.workspace_id   = target_workspace_id
          AND cs.date_range_end = date_a
          AND cs.is_mock        = FALSE
        GROUP BY cs.campaign_name
    ),

    period_b AS (
        -- Aggregate all campaigns for the workspace on the D-7 window.
        SELECT
            cs.campaign_name                                      AS cname,
            SUM(cs.cost)                                          AS spend,
            SUM(cs.conversions)                                   AS conversions,
            SUM(cs.clicks)                                        AS clicks,
            SUM(cs.impressions)                                   AS impressions
        FROM public.campaign_summary cs
        WHERE cs.workspace_id   = target_workspace_id
          AND cs.date_range_end = date_b
          AND cs.is_mock        = FALSE
        GROUP BY cs.campaign_name
    ),

    combined AS (
        -- Full outer join so campaigns absent on one side don't vanish.
        -- Campaigns with spend = 0 in BOTH periods are excluded.
        -- CTR is computed from aggregated clicks/impressions (CTR is non-additive).
        SELECT
            COALESCE(a.cname, b.cname)::TEXT AS cname,

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
        FULL OUTER JOIN period_b b ON a.cname = b.cname
        WHERE NOT (COALESCE(a.spend, 0) = 0 AND COALESCE(b.spend, 0) = 0)
    ),

    metrics_long AS (
        -- Unpivot to one row per (campaign, metric)

        -- spend
        SELECT cname, 'spend'::TEXT       AS mname,
               spend_now  AS vnow, spend_then  AS vthen
        FROM combined

        UNION ALL

        -- conversions
        SELECT cname, 'conversions'::TEXT AS mname,
               conv_now   AS vnow, conv_then   AS vthen
        FROM combined

        UNION ALL

        -- clicks — excluded when 0 in both periods (no signal)
        SELECT cname, 'clicks'::TEXT      AS mname,
               clicks_now::NUMERIC AS vnow, clicks_then::NUMERIC AS vthen
        FROM combined
        WHERE clicks_now > 0 OR clicks_then > 0

        UNION ALL

        -- cpa = spend / conversions (NULL when conversions = 0 in either period)
        SELECT
            cname,
            'cpa'::TEXT AS mname,
            CASE WHEN conv_now  > 0 THEN ROUND(spend_now  / conv_now,  2) ELSE NULL END AS vnow,
            CASE WHEN conv_then > 0 THEN ROUND(spend_then / conv_then, 2) ELSE NULL END AS vthen
        FROM combined

        UNION ALL

        -- cpc = spend / clicks (NULL when clicks = 0 in either period)
        SELECT
            cname,
            'cpc'::TEXT AS mname,
            CASE WHEN clicks_now  > 0 THEN ROUND(spend_now  / clicks_now,  2) ELSE NULL END AS vnow,
            CASE WHEN clicks_then > 0 THEN ROUND(spend_then / clicks_then, 2) ELSE NULL END AS vthen
        FROM combined

        UNION ALL

        -- ctr expressed as percentage (ctr_now is already × 100)
        -- NULL rows (no impressions) are filtered by the WHERE clause in deltas
        SELECT
            cname,
            'ctr'::TEXT AS mname,
            ctr_now  AS vnow,
            ctr_then AS vthen
        FROM combined
    ),

    deltas AS (
        -- Calculate delta; rows where vthen = 0 produce NULL delta and
        -- are excluded downstream by the ABS(delta) > 15 filter.
        SELECT
            ml.cname,
            ml.mname,
            ROUND(ml.vnow,  2) AS vnow,
            ROUND(ml.vthen, 2) AS vthen,
            ROUND(
                ((ml.vnow - ml.vthen) / NULLIF(ml.vthen, 0)) * 100,
                2
            ) AS dpct
        FROM metrics_long ml
        WHERE ml.vnow  IS NOT NULL
          AND ml.vthen IS NOT NULL
    )

    SELECT
        d.cname AS campaign_name,
        d.mname AS metric_name,
        d.vnow  AS value_now,
        d.vthen AS value_then,
        d.dpct  AS delta_percentage,
        CASE
            WHEN ABS(d.dpct) > 50 THEN 'CRITICAL'
            ELSE 'SIGNIFICANT'
        END      AS impact_level
    FROM deltas d
    WHERE ABS(d.dpct) > 15
    ORDER BY ABS(d.dpct) DESC;

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
