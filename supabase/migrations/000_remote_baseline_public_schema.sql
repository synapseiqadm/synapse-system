-- 000_remote_baseline_public_schema.sql
--
-- Local-only baseline recovery for SynapseIQ / A Data / Dashboard Woke.
--
-- Purpose:
--   Provide the minimal public schema baseline that existed before local
--   migrations 001..007, so Supabase CLI can build a shadow database from
--   versioned migrations.
--
-- Safety:
--   - Do not push this migration to remote in this phase.
--   - Do not use this file to mutate the production database.
--   - Validate locally through `npx supabase db diff --linked --schema public`.
--
-- Context:
--   The remote schema contains base tables not created by local migrations:
--   workspaces, profiles, campaign_summary, keyword_analysis, kpi_cache_daily,
--   agent_action_logs, ai_playbooks, data_connectors.
--
-- Important:
--   This file intentionally avoids adding the upsert constraints created later
--   by 002_metadata_and_constraints.sql:
--     - campaign_summary_upsert_key
--     - keyword_analysis_upsert_key

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;


CREATE TABLE IF NOT EXISTS public.workspaces (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    bq_dataset_id text,
    tier text DEFAULT 'Essentials'::text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid NOT NULL,
    workspace_id uuid,
    full_name text,
    role text DEFAULT 'analyst'::text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.campaign_summary (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    campaign_name text NOT NULL,
    cost numeric(10,2) DEFAULT 0,
    conversions numeric(10,2) DEFAULT 0,
    roas numeric(10,2) DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now(),
    data_source text DEFAULT 'google_ads'::text NOT NULL,
    campaign_id text,
    source_platform text,
    is_mock boolean DEFAULT false,
    date_range_start date,
    date_range_end date,
    loaded_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.keyword_analysis (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    campaign_name text,
    keyword text NOT NULL,
    match_type text,
    cost numeric(10,2) DEFAULT 0,
    conversions numeric(10,2) DEFAULT 0,
    clicks integer DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now(),
    data_source text DEFAULT 'google_ads'::text NOT NULL,
    campaign_id text,
    source_platform text,
    is_mock boolean DEFAULT false,
    date_range_start date,
    date_range_end date,
    loaded_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.kpi_cache_daily (
    id bigint NOT NULL,
    workspace_id uuid,
    date date NOT NULL,
    metric_name text NOT NULL,
    metric_value numeric NOT NULL,
    channel text,
    updated_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public.kpi_cache_daily_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.kpi_cache_daily_id_seq OWNED BY public.kpi_cache_daily.id;

ALTER TABLE ONLY public.kpi_cache_daily
    ALTER COLUMN id SET DEFAULT nextval('public.kpi_cache_daily_id_seq'::regclass);

CREATE TABLE IF NOT EXISTS public.ai_playbooks (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workspace_id uuid,
    name text NOT NULL,
    trigger_conditions jsonb NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_action_logs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workspace_id uuid,
    playbook_id uuid,
    action_type text NOT NULL,
    description text,
    status text DEFAULT 'pending_approval'::text,
    executed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.data_connectors (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workspace_id uuid,
    platform text NOT NULL,
    sync_status text DEFAULT 'pending'::text,
    last_successful_sync timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);

-- Primary keys known from the remote baseline.
ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey
    FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.campaign_summary
    ADD CONSTRAINT campaign_summary_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.campaign_summary
    ADD CONSTRAINT campaign_summary_workspace_campaign_period_key UNIQUE (workspace_id, campaign_id, date_range_start, date_range_end);

ALTER TABLE ONLY public.keyword_analysis
    ADD CONSTRAINT keyword_analysis_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.kpi_cache_daily
    ADD CONSTRAINT kpi_cache_daily_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX idx_kpi_cache_unique
ON public.kpi_cache_daily USING btree (workspace_id, date, metric_name, channel);

ALTER TABLE ONLY public.ai_playbooks
    ADD CONSTRAINT ai_playbooks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_action_logs
    ADD CONSTRAINT agent_action_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.data_connectors
    ADD CONSTRAINT data_connectors_pkey PRIMARY KEY (id);

-- Foreign keys known from the remote schema.
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.campaign_summary
    ADD CONSTRAINT campaign_summary_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.keyword_analysis
    ADD CONSTRAINT keyword_analysis_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.kpi_cache_daily
    ADD CONSTRAINT kpi_cache_daily_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ai_playbooks
    ADD CONSTRAINT ai_playbooks_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_action_logs
    ADD CONSTRAINT agent_action_logs_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_action_logs
    ADD CONSTRAINT agent_action_logs_playbook_id_fkey
    FOREIGN KEY (playbook_id) REFERENCES public.ai_playbooks(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.data_connectors
    ADD CONSTRAINT data_connectors_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

-- RLS enabled to match remote posture.
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keyword_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_cache_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_action_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_connectors ENABLE ROW LEVEL SECURITY;

-- Read policies known from current MVP remote posture.
CREATE POLICY "Allow authenticated read"
ON public.workspaces
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Allow authenticated read"
ON public.profiles
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Allow authenticated read"
ON public.kpi_cache_daily
FOR SELECT TO authenticated
USING (true);

CREATE POLICY U&"Leitura p\00FAblica campanhas"
ON public.campaign_summary
FOR SELECT
USING (true);

CREATE POLICY U&"Leitura p\00FAblica keywords"
ON public.keyword_analysis
FOR SELECT
USING (true);

CREATE POLICY U&"Permitir leitura p\00FAblica de KPIs"
ON public.kpi_cache_daily
FOR SELECT
USING (true);

CREATE POLICY "Utilizadores acedem apenas dados do seu workspace"
ON public.kpi_cache_daily
USING (
    workspace_id = (
        SELECT profiles.workspace_id
        FROM public.profiles
        WHERE profiles.id = auth.uid()
    )
);

-- Grants from remote MVP posture.
GRANT ALL ON TABLE public.workspaces TO anon;
GRANT ALL ON TABLE public.workspaces TO authenticated;
GRANT ALL ON TABLE public.workspaces TO service_role;

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;

GRANT ALL ON TABLE public.campaign_summary TO anon;
GRANT ALL ON TABLE public.campaign_summary TO authenticated;
GRANT ALL ON TABLE public.campaign_summary TO service_role;

GRANT ALL ON TABLE public.keyword_analysis TO anon;
GRANT ALL ON TABLE public.keyword_analysis TO authenticated;
GRANT ALL ON TABLE public.keyword_analysis TO service_role;

GRANT ALL ON TABLE public.kpi_cache_daily TO anon;
GRANT ALL ON TABLE public.kpi_cache_daily TO authenticated;
GRANT ALL ON TABLE public.kpi_cache_daily TO service_role;

GRANT ALL ON SEQUENCE public.kpi_cache_daily_id_seq TO anon;
GRANT ALL ON SEQUENCE public.kpi_cache_daily_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.kpi_cache_daily_id_seq TO service_role;

GRANT ALL ON TABLE public.ai_playbooks TO anon;
GRANT ALL ON TABLE public.ai_playbooks TO authenticated;
GRANT ALL ON TABLE public.ai_playbooks TO service_role;

GRANT ALL ON TABLE public.agent_action_logs TO anon;
GRANT ALL ON TABLE public.agent_action_logs TO authenticated;
GRANT ALL ON TABLE public.agent_action_logs TO service_role;

GRANT ALL ON TABLE public.data_connectors TO anon;
GRANT ALL ON TABLE public.data_connectors TO authenticated;
GRANT ALL ON TABLE public.data_connectors TO service_role;
