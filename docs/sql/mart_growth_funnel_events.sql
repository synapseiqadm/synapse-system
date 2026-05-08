-- ── Mart: Growth Funnel Events ───────────────────────────────────────────────
-- PROPOSAL — apply manually via Supabase Studio > SQL Editor.
-- Not applied by migration 006.
--
-- One row per event per workspace per period, unnested from
-- ga4_first_light_summary.top_events JSONB.
-- Useful for time-series of event volume and funnel drop-off analysis.

CREATE OR REPLACE VIEW mart_growth_funnel_events AS
SELECT
    g.workspace_id,
    g.ga4_dataset,
    g.date_range_start,
    g.date_range_end,
    (event_obj ->> 'event_name')::TEXT     AS event_name,
    (event_obj ->> 'count')::INTEGER       AS event_count,
    g.updated_at
FROM ga4_first_light_summary g,
     LATERAL jsonb_array_elements(g.top_events) AS event_obj
WHERE g.top_events IS NOT NULL
  AND jsonb_typeof(g.top_events) = 'array'
  AND (event_obj ->> 'event_name') IS NOT NULL;
