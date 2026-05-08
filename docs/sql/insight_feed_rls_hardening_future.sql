-- ============================================================================
-- Future migration: insight_feed RLS hardening
-- Status: NOT APPLIED — draft only, do NOT run without reading prerequisites
--
-- Context:
--   insight_feed currently has a public SELECT policy (TO public USING (true)),
--   matching the same pattern on campaign_summary, keyword_analysis, and
--   data_quality_report. This is acceptable for the current MVP because:
--     - The dashboard uses the anon key without user authentication.
--     - public.profiles has no rows yet (workspace membership undefined).
--     - A workspace-scoped policy would break the dashboard in its current state.
--
-- This file documents the target policy to apply once authentication is ready.
-- It lives in docs/sql/ intentionally — NOT in supabase/migrations/ — to avoid
-- accidental application by CI/CD pipelines.
--
-- Prerequisites before applying:
--   1. Authentication wired up in the dashboard (users must sign in via Supabase Auth).
--   2. public.profiles populated: each user needs a row with
--        profiles.id = auth.uid()  AND  profiles.workspace_id = their workspace.
--   3. Dashboard updated to use Supabase session tokens (authenticated role)
--      instead of the anon key when reading insight_feed.
--
-- Membership model:
--   public.profiles already links profiles.id → auth.users.id and
--   profiles.workspace_id → workspaces.id, making it the de-facto membership
--   table for single-workspace users. If multi-workspace support is added later,
--   introduce a workspace_members(user_id, workspace_id) table and update the
--   USING clause accordingly.
--
-- How to apply when prerequisites are met:
--   1. Confirm profiles rows exist for all active users.
--   2. Copy this file to supabase/migrations/005_insight_feed_rls_hardening.sql
--      (or the next available migration number).
--   3. Apply via:  supabase db push  or  MCP apply_migration tool.
--   4. Verify the dashboard still reads insights correctly with an authenticated session.
--   5. Consider applying the same pattern to campaign_summary, keyword_analysis,
--      data_quality_report, and kpi_cache_daily for full RLS consistency.
-- ============================================================================

-- Step 1: Remove the public policy from migration 004.
DROP POLICY IF EXISTS "Leitura pública insights" ON public.insight_feed;

-- Step 2: Workspace-scoped SELECT for authenticated users only.
CREATE POLICY "Users can read insights for their workspace"
    ON public.insight_feed
    FOR SELECT
    TO authenticated
    USING (
        workspace_id = (
            SELECT profiles.workspace_id
            FROM public.profiles
            WHERE profiles.id = auth.uid()
        )
    );
