-- Helper function: true when the calling user is a superadmin
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'superadmin'
  );
$$;

-- Superadmin can read any workspace's campaign data (client-side switching)
CREATE POLICY "campaign_summary_superadmin_read_any"
  ON public.campaign_summary FOR SELECT TO authenticated
  USING (public.is_superadmin());

-- Superadmin can read any workspace's keyword data
CREATE POLICY "keyword_analysis_superadmin_read_any"
  ON public.keyword_analysis FOR SELECT TO authenticated
  USING (public.is_superadmin());

-- Superadmin can read any workspace's ad group data
CREATE POLICY "ad_group_summary_superadmin_read_any"
  ON public.ad_group_summary FOR SELECT TO authenticated
  USING (public.is_superadmin());

-- Superadmin can read any workspace's insight feed
CREATE POLICY "insight_feed_superadmin_read_any"
  ON public.insight_feed FOR SELECT TO authenticated
  USING (public.is_superadmin());

-- Superadmin can read any workspace's kpi cache
CREATE POLICY "kpi_cache_daily_superadmin_read_any"
  ON public.kpi_cache_daily FOR SELECT TO authenticated
  USING (public.is_superadmin());

-- Superadmin can read any workspace's sync runs
CREATE POLICY "sync_runs_superadmin_read_any"
  ON public.sync_runs FOR SELECT TO authenticated
  USING (public.is_superadmin());

-- Superadmin can read any workspace's operational events
CREATE POLICY "operational_events_superadmin_read_any"
  ON public.operational_events FOR SELECT TO authenticated
  USING (public.is_superadmin());

-- Superadmin can read any workspace's agent decisions
CREATE POLICY "agent_decisions_superadmin_read_any"
  ON public.agent_decisions FOR SELECT TO authenticated
  USING (public.is_superadmin());

-- Superadmin can read any workspace's data quality report
CREATE POLICY "data_quality_report_superadmin_read_any"
  ON public.data_quality_report FOR SELECT TO authenticated
  USING (public.is_superadmin());

-- Superadmin can read any workspace's GA4 data
CREATE POLICY "ga4_first_light_superadmin_read_any"
  ON public.ga4_first_light_summary FOR SELECT TO authenticated
  USING (public.is_superadmin());

-- Superadmin can read any workspace's governance data
CREATE POLICY "semantic_governance_runs_superadmin_read_any"
  ON public.semantic_governance_runs FOR SELECT TO authenticated
  USING (public.is_superadmin());

CREATE POLICY "semantic_governance_findings_superadmin_read_any"
  ON public.semantic_governance_findings FOR SELECT TO authenticated
  USING (public.is_superadmin());

CREATE POLICY "semantic_governance_evidence_superadmin_read_any"
  ON public.semantic_governance_evidence FOR SELECT TO authenticated
  USING (public.is_superadmin());
