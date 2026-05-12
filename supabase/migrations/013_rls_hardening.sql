-- 013_rls_hardening.sql
-- Replace all TO public USING (true) policies with TO authenticated
-- scoped to the user's workspace via profiles.workspace_id = auth.uid().
-- Backend Python uses service_role key (bypasses RLS) — write path unaffected.

-- profiles: restrict each user to their own row
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated read" ON public.profiles;
CREATE POLICY "profiles_read_own"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

-- campaign_summary
ALTER TABLE public.campaign_summary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Leitura pública campanhas" ON public.campaign_summary;
CREATE POLICY "campaign_summary_read_authenticated"
  ON public.campaign_summary FOR SELECT TO authenticated
  USING (workspace_id = (SELECT workspace_id FROM public.profiles WHERE id = auth.uid()));

-- data_quality_report
ALTER TABLE public.data_quality_report ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Leitura pública qualidade" ON public.data_quality_report;
CREATE POLICY "data_quality_report_read_authenticated"
  ON public.data_quality_report FOR SELECT TO authenticated
  USING (workspace_id = (SELECT workspace_id FROM public.profiles WHERE id = auth.uid()));

-- ga4_first_light_summary
ALTER TABLE public.ga4_first_light_summary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Leitura pública ga4_first_light_summary" ON public.ga4_first_light_summary;
CREATE POLICY "ga4_first_light_summary_read_authenticated"
  ON public.ga4_first_light_summary FOR SELECT TO authenticated
  USING (workspace_id = (SELECT workspace_id FROM public.profiles WHERE id = auth.uid()));

-- insight_feed
ALTER TABLE public.insight_feed ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Leitura pública insights" ON public.insight_feed;
CREATE POLICY "insight_feed_read_authenticated"
  ON public.insight_feed FOR SELECT TO authenticated
  USING (workspace_id = (SELECT workspace_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "insight_feed_update_authenticated"
  ON public.insight_feed FOR UPDATE TO authenticated
  USING     (workspace_id = (SELECT workspace_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (workspace_id = (SELECT workspace_id FROM public.profiles WHERE id = auth.uid()));

-- keyword_analysis
ALTER TABLE public.keyword_analysis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Leitura pública keywords" ON public.keyword_analysis;
CREATE POLICY "keyword_analysis_read_authenticated"
  ON public.keyword_analysis FOR SELECT TO authenticated
  USING (workspace_id = (SELECT workspace_id FROM public.profiles WHERE id = auth.uid()));

-- kpi_cache_daily
ALTER TABLE public.kpi_cache_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated read"                           ON public.kpi_cache_daily;
DROP POLICY IF EXISTS "Permitir leitura pública de KPIs"                  ON public.kpi_cache_daily;
DROP POLICY IF EXISTS "Utilizadores acedem apenas dados do seu workspace" ON public.kpi_cache_daily;
CREATE POLICY "kpi_cache_daily_read_authenticated"
  ON public.kpi_cache_daily FOR SELECT TO authenticated
  USING (workspace_id = (SELECT workspace_id FROM public.profiles WHERE id = auth.uid()));

-- operational_events
ALTER TABLE public.operational_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "operational_events_read_woke_workspace_mvp" ON public.operational_events;
CREATE POLICY "operational_events_read_authenticated"
  ON public.operational_events FOR SELECT TO authenticated
  USING (workspace_id = (SELECT workspace_id FROM public.profiles WHERE id = auth.uid()));

-- semantic_governance_evidence (no workspace_id, join through findings)
ALTER TABLE public.semantic_governance_evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "semantic_governance_evidence_select_public" ON public.semantic_governance_evidence;
CREATE POLICY "semantic_governance_evidence_read_authenticated"
  ON public.semantic_governance_evidence FOR SELECT TO authenticated
  USING (
    finding_id IN (
      SELECT id FROM public.semantic_governance_findings
      WHERE workspace_id = (SELECT workspace_id FROM public.profiles WHERE id = auth.uid())
    )
  );

-- semantic_governance_findings
ALTER TABLE public.semantic_governance_findings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "semantic_governance_findings_select_public" ON public.semantic_governance_findings;
CREATE POLICY "semantic_governance_findings_read_authenticated"
  ON public.semantic_governance_findings FOR SELECT TO authenticated
  USING (workspace_id = (SELECT workspace_id FROM public.profiles WHERE id = auth.uid()));

-- semantic_governance_runs
ALTER TABLE public.semantic_governance_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "semantic_governance_runs_select_public" ON public.semantic_governance_runs;
CREATE POLICY "semantic_governance_runs_read_authenticated"
  ON public.semantic_governance_runs FOR SELECT TO authenticated
  USING (workspace_id = (SELECT workspace_id FROM public.profiles WHERE id = auth.uid()));

-- sync_runs
ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sync_runs_read_woke_workspace_mvp" ON public.sync_runs;
CREATE POLICY "sync_runs_read_authenticated"
  ON public.sync_runs FOR SELECT TO authenticated
  USING (workspace_id = (SELECT workspace_id FROM public.profiles WHERE id = auth.uid()));

-- workspaces: existing "Allow authenticated read" policy remains (name/slug not sensitive)
