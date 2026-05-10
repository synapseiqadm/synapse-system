-- ── 009 sync_runs — read policy (MVP, workspace-scoped) ───────────────────────
--
-- Context:
--   Migration 008 enabled RLS on public.sync_runs but created no policies.
--   With RLS active and no SELECT policy, the `anon` and `authenticated` roles
--   receive 0 rows silenciosamente — no error, just an empty result set.
--   This caused /logs to show an empty state even with data present.
--
-- Decision:
--   Esta é uma policy MVP para permitir leitura operacional do /logs.
--   A policy é escopada ao workspace Woke (a082fe86-a65f-4c9b-9442-fe775f47e3fc).
--   Não é a policy definitiva para SaaS multi-tenant.
--   Quando auth multi-tenant estiver pronto, substituir por policy workspace-scoped
--   via `profiles.workspace_id = sync_runs.workspace_id`.
--
-- Why TO public + USING(workspace_id) instead of TO anon + USING(true):
--   Scoping to the workspace ID limits exposure to one tenant's operational data
--   while remaining compatible with the no-auth MVP state of the dashboard.
--   Other dashboard tables (003/004/005/007) use USING(true); this is stricter.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sync_runs_read_woke_workspace_mvp" ON public.sync_runs;

CREATE POLICY "sync_runs_read_woke_workspace_mvp"
  ON public.sync_runs
  FOR SELECT
  TO public
  USING (
    workspace_id = 'a082fe86-a65f-4c9b-9442-fe775f47e3fc'::uuid
  );

GRANT SELECT ON public.sync_runs TO anon, authenticated;
