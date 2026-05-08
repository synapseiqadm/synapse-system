-- ============================================================================
-- Future migration: semantic_governance_* RLS hardening
-- Status: NOT APPLIED — draft only, do NOT run without reading prerequisites
--
-- Context:
--   semantic_governance_runs, semantic_governance_findings, and
--   semantic_governance_evidence currently have a public SELECT policy
--   (TO public USING (true)), added via migration 007. This matches the MVP
--   approach applied to all other dashboard tables (003, 004, 005).
--   The dashboard uses the anon key; public.profiles has 0 rows; no auth
--   session exists for the current anonymous dashboard.
--
-- This file documents the target policy to apply once authentication is ready.
-- Prerequisites are the same as insight_feed_rls_hardening_future.sql:
--   1. Authentication wired up in the dashboard (users must sign in).
--   2. public.profiles populated: each user needs a row with
--        profiles.id = auth.uid()  AND  profiles.workspace_id = their workspace.
--   3. Dashboard updated to use Supabase session tokens (authenticated role).
--
-- Membership model:
--   same as insight_feed — profiles.id links to auth.users.id;
--   profiles.workspace_id links to workspaces.id.
--
-- Special note for semantic_governance_evidence:
--   This table has no workspace_id column. The workspace-scoped policy joins
--   through semantic_governance_findings via finding_id.
--
-- How to apply when prerequisites are met:
--   1. Confirm profiles rows exist for all active users.
--   2. Copy this file to supabase/migrations/<next_number>_semantic_governance_rls_hardening.sql
--   3. Apply via: supabase db push  or  MCP apply_migration tool.
--   4. Verify the dashboard still reads governance data correctly.
--   5. Apply the same pattern to data_quality_report, insight_feed,
--      ga4_first_light_summary, campaign_summary, keyword_analysis, kpi_cache_daily
--      for full RLS consistency (see insight_feed_rls_hardening_future.sql).
-- ============================================================================

-- Step 1: Remove the public policies added in migration 007.
DROP POLICY IF EXISTS "semantic_governance_runs_select_public"
    ON public.semantic_governance_runs;
DROP POLICY IF EXISTS "semantic_governance_findings_select_public"
    ON public.semantic_governance_findings;
DROP POLICY IF EXISTS "semantic_governance_evidence_select_public"
    ON public.semantic_governance_evidence;

-- Step 2: Workspace-scoped SELECT for authenticated users only.

CREATE POLICY "Users can read governance runs for their workspace"
    ON public.semantic_governance_runs
    FOR SELECT
    TO authenticated
    USING (
        workspace_id = (
            SELECT profiles.workspace_id
            FROM public.profiles
            WHERE profiles.id = auth.uid()
        )
    );

CREATE POLICY "Users can read governance findings for their workspace"
    ON public.semantic_governance_findings
    FOR SELECT
    TO authenticated
    USING (
        workspace_id = (
            SELECT profiles.workspace_id
            FROM public.profiles
            WHERE profiles.id = auth.uid()
        )
    );

-- evidence has no workspace_id — join through the parent finding.
CREATE POLICY "Users can read governance evidence for their workspace"
    ON public.semantic_governance_evidence
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.semantic_governance_findings f
            JOIN public.profiles p ON p.workspace_id = f.workspace_id
            WHERE f.id = semantic_governance_evidence.finding_id
              AND p.id = auth.uid()
        )
    );
