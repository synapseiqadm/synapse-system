-- 014_agent_decisions.sql
-- Persistence layer for multi-agent decisions.
-- Backend writes via service key (bypasses RLS). Frontend reads/updates via session.

CREATE TABLE IF NOT EXISTS public.agent_decisions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL,
  agent_id      TEXT        NOT NULL,
  type          TEXT        NOT NULL CHECK (type IN ('analysis', 'suggestion', 'action', 'alert')),
  title         TEXT        NOT NULL,
  body          TEXT        NOT NULL,
  rationale     TEXT,
  impact_value  TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'rejected', 'auto-applied')),
  metadata      JSONB,
  dedupe_key    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, dedupe_key)
);

-- Trigger: prevent re-sync from resetting a decision the user already actioned.
-- On UPDATE, if the existing status is not 'pending', keep it.
CREATE OR REPLACE FUNCTION public.preserve_agent_decision_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status <> 'pending' THEN
    NEW.status := OLD.status;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_decisions_preserve_status ON public.agent_decisions;
CREATE TRIGGER agent_decisions_preserve_status
  BEFORE UPDATE ON public.agent_decisions
  FOR EACH ROW EXECUTE FUNCTION public.preserve_agent_decision_status();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agent_decisions_workspace_created
  ON public.agent_decisions (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_decisions_agent_id
  ON public.agent_decisions (workspace_id, agent_id);

-- RLS
ALTER TABLE public.agent_decisions ENABLE ROW LEVEL SECURITY;

-- Authenticated users read only their workspace's decisions
CREATE POLICY "agent_decisions_read_authenticated"
  ON public.agent_decisions FOR SELECT TO authenticated
  USING (workspace_id = (SELECT workspace_id FROM public.profiles WHERE id = auth.uid()));

-- Authenticated users update only their workspace's decisions (approve / reject)
CREATE POLICY "agent_decisions_update_authenticated"
  ON public.agent_decisions FOR UPDATE TO authenticated
  USING     (workspace_id = (SELECT workspace_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (workspace_id = (SELECT workspace_id FROM public.profiles WHERE id = auth.uid()));

GRANT SELECT, UPDATE ON public.agent_decisions TO authenticated;
