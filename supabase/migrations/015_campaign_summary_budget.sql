-- ============================================================
-- 015_campaign_summary_budget.sql
-- SynapseIQ v3.4 — Budget Ingestion (Forecaster unlock)
--
-- Adds daily_budget and budget_total to campaign_summary.
-- Uses IF NOT EXISTS — idempotent; safe to run multiple times.
--
-- daily_budget : campaign's daily spending limit (from Google Ads campaign_budget_amount_micros)
-- budget_total : daily_budget * period_days (computed in sync pipeline, approximation)
-- ============================================================

ALTER TABLE public.campaign_summary
  ADD COLUMN IF NOT EXISTS daily_budget NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS budget_total NUMERIC DEFAULT NULL;

COMMENT ON COLUMN public.campaign_summary.daily_budget IS
  'Campaign daily budget in BRL, sourced from campaign_budget_amount_micros / 1000000';

COMMENT ON COLUMN public.campaign_summary.budget_total IS
  'Estimated total budget for the sync period: daily_budget * period_days';
