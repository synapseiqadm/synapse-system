-- ── Mart: Semantic Event Coverage ────────────────────────────────────────────
-- PROPOSAL — apply manually via Supabase Studio > SQL Editor.
-- Not applied by migration 006.
--
-- Shows registry coverage for GA4 events and Google Ads conversion actions.
-- Covers checks M (registry mismatch), N (Ads action not in registry),
-- O (semantic review required), and Q (suspicious event names).

CREATE OR REPLACE VIEW mart_semantic_event_coverage AS
SELECT
    workspace_id,
    date_range_start,
    date_range_end,
    check_name,
    status,
    severity,
    affected_rows,
    details ->> 'source_table'                          AS source_table,
    details -> 'unregistered_conversion_candidates'     AS unregistered_ga4_events,
    details -> 'unregistered_actions'                   AS unregistered_ads_actions,
    details -> 'registered_actions'                     AS registered_ads_actions,
    details -> 'flagged_actions'                        AS flagged_for_review,
    details -> 'suspicious_events_found'                AS suspicious_events
FROM data_quality_report
WHERE check_category = 'semantic_governance'
  AND check_name IN (
      'ga4_conversion_registry_mismatch',
      'ads_conversion_action_not_in_registry',
      'ads_conversion_action_semantic_review_required',
      'ga4_suspicious_event_names_detected'
  );
