-- ── 007 Semantic Governance — read policies ───────────────────────────────────
-- Enables RLS and adds public SELECT policies to the three tables created by
-- migration 006, which omitted both ENABLE ROW LEVEL SECURITY and any policy.
--
-- Root cause: without an explicit SELECT policy, PostgreSQL/Supabase denies all
-- row-level access for the `anon` and `authenticated` roles when RLS is active,
-- returning 0 rows even though data is present.
--
-- Decision — MVP public SELECT, consistent with every other dashboard table:
--   003 data_quality_report    → TO public USING (true)
--   004 insight_feed           → TO public USING (true)
--   005 ga4_first_light_summary → TO public USING (true)
-- The upgrade path to authenticated + workspace-scoped policies is documented
-- in docs/sql/semantic_governance_rls_hardening_future.sql.
--
-- Apply with:
--   supabase db execute --file supabase/migrations/007_semantic_governance_read_policies.sql
--   or paste directly in Supabase Studio > SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable RLS (idempotent — safe even if already enabled by a Supabase project setting).
ALTER TABLE public.semantic_governance_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.semantic_governance_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.semantic_governance_evidence ENABLE ROW LEVEL SECURITY;

-- MVP: public read access, matching the pattern in 003/004/005.
-- Upgrade path: docs/sql/semantic_governance_rls_hardening_future.sql
CREATE POLICY "semantic_governance_runs_select_public"
    ON public.semantic_governance_runs
    FOR SELECT
    TO public
    USING (true);

CREATE POLICY "semantic_governance_findings_select_public"
    ON public.semantic_governance_findings
    FOR SELECT
    TO public
    USING (true);

CREATE POLICY "semantic_governance_evidence_select_public"
    ON public.semantic_governance_evidence
    FOR SELECT
    TO public
    USING (true);
