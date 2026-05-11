-- ── 011 operational_events — RLS (MVP, workspace-scoped) ─────────────────────
--
-- Context:
--   Migration 010 created `operational_events` without RLS.
--   This migration enables RLS and adds a SELECT policy scoped to the Woke
--   workspace so that frontend queries via anon/authenticated keys return data.
--
-- Decision:
--   Same pattern as 009 (sync_runs read policy).
--   Service-role key (used by backend Python pipeline) bypasses RLS entirely —
--   no INSERT/UPDATE policy is needed for automated writes.
--
--   Policy is intentionally MVP: single workspace UUID, no auth join.
--   When multi-tenant auth is introduced, replace with:
--     USING (workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid()))
--
-- Why TO public + USING(workspace_id) instead of TO anon + USING(true):
--   Scopes frontend exposure to one tenant's events while remaining compatible
--   with the no-auth MVP state of the dashboard.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.operational_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operational_events_read_woke_workspace_mvp"
    ON public.operational_events;

CREATE POLICY "operational_events_read_woke_workspace_mvp"
    ON public.operational_events
    FOR SELECT
    TO public
    USING (
        workspace_id = 'a082fe86-a65f-4c9b-9442-fe775f47e3fc'::uuid
    );

GRANT SELECT ON public.operational_events TO anon, authenticated;
