-- ── Mart: Paid Sessions Quality ──────────────────────────────────────────────
-- PROPOSAL — apply manually via Supabase Studio > SQL Editor.
-- Not applied by migration 006.
--
-- Surfaces paid session tracking quality metrics from data_quality_report
-- for semantic_governance checks R (funnel progress) and S (UTM params).
-- Joins both checks per period so a dashboard can show them side-by-side.

CREATE OR REPLACE VIEW mart_paid_sessions_quality AS
SELECT
    workspace_id,
    date_range_start,
    date_range_end,
    check_name,
    status,
    severity,
    affected_rows,
    -- check R fields
    (details ->> 'paid_sessions')::INTEGER                AS paid_sessions,
    (details ->> 'paid_sessions_with_progress')::INTEGER  AS paid_sessions_with_progress,
    -- check S fields
    (details ->> 'total_paid_views')::INTEGER             AS total_paid_views,
    details -> 'missing_params'                           AS missing_utm_params,
    details -> 'param_coverage'                           AS param_coverage,
    -- shared
    details -> 'funnel_events_checked'                    AS funnel_events_checked
FROM data_quality_report
WHERE check_category = 'semantic_governance'
  AND check_name IN (
      'paid_sessions_without_funnel_progress',
      'utm_campaign_empty_in_paid_urls'
  );
