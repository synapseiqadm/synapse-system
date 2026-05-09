-- 008_align_sync_runs_rls.sql
--
-- Local baseline recovery alignment.
-- Remote schema has RLS enabled on public.sync_runs.
-- This migration only aligns local shadow database reconstruction with remote state.

ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;
