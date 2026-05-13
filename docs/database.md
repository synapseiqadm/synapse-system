# Base de Dados — SynapseIQ

**Projecto Supabase:** `synapse-system` | ID: `lasocsneburvtxqgqhie` | Região: `sa-east-1`

---

## Tabelas

### `campaign_summary`
```sql
workspace_id     UUID
campaign_id      TEXT                           -- era BIGINT; TEXT é agnóstico a fonte
campaign_name    TEXT
cost             NUMERIC
conversions      NUMERIC(10,2)                  -- era INT
roas             NUMERIC
clicks           INTEGER DEFAULT 0              -- migration 012
impressions      INTEGER DEFAULT 0              -- migration 012
ctr              NUMERIC(8,6) DEFAULT 0         -- fração, recomputar de clicks/impressions
ad_quality_score NUMERIC(4,2)                   -- nullable; não disponível em PMax/Display
data_source      TEXT DEFAULT 'google_ads'
source_platform  TEXT
is_mock          BOOLEAN DEFAULT FALSE
date_range_start DATE
date_range_end   DATE
loaded_at        TIMESTAMPTZ DEFAULT NOW()
UNIQUE (workspace_id, campaign_id, date_range_start, date_range_end)
```

### `keyword_analysis`
```sql
workspace_id     UUID
campaign_id      TEXT
campaign_name    TEXT
keyword          TEXT
match_type       TEXT
clicks           INT
cost             NUMERIC
conversions      NUMERIC(10,2)
data_source      TEXT DEFAULT 'google_ads'
source_platform  TEXT
is_mock          BOOLEAN DEFAULT FALSE
date_range_start DATE
date_range_end   DATE
loaded_at        TIMESTAMPTZ DEFAULT NOW()
UNIQUE (workspace_id, campaign_id, keyword, match_type, date_range_start, date_range_end)
```

### `kpi_cache_daily`
```sql
workspace_id   UUID
date           DATE
metric_name    TEXT    -- 'total_cost' | 'roas' | 'conversions'
metric_value   NUMERIC
channel        TEXT
UNIQUE (workspace_id, date, metric_name, channel)
```

### `sync_runs`
```sql
id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
workspace_id     UUID
source_platform  TEXT
data_source      TEXT
status           TEXT CHECK (status IN ('running','success','error'))
started_at       TIMESTAMPTZ
finished_at      TIMESTAMPTZ
rows_loaded      INTEGER DEFAULT 0
is_mock          BOOLEAN DEFAULT FALSE
date_range_start DATE
date_range_end   DATE
error_message    TEXT
created_at       TIMESTAMPTZ DEFAULT NOW()
```

### `data_quality_report`
```sql
id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
workspace_id     UUID NOT NULL
check_name       TEXT NOT NULL
check_category   TEXT NOT NULL
status           TEXT CHECK (status IN ('passed','warning','failed'))
severity         TEXT CHECK (severity IN ('low','medium','high','critical'))
source_platform  TEXT
target_table     TEXT
metric_value     NUMERIC
threshold_value  NUMERIC
affected_rows    INTEGER DEFAULT 0
details          JSONB
date_range_start DATE
date_range_end   DATE
checked_at       TIMESTAMPTZ DEFAULT NOW()
```
Estratégia: INSERT (não upsert) — cada execução é um snapshot. Dashboard deduplica por `check_name` mantendo o mais recente.

### `insight_feed`
```sql
id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
workspace_id     UUID NOT NULL
insight_type     TEXT NOT NULL
severity         TEXT CHECK (severity IN ('low','medium','high','critical'))
status           TEXT DEFAULT 'new' CHECK (status IN ('new','reviewed','dismissed','resolved'))
title            TEXT NOT NULL
summary          TEXT NOT NULL
recommendation   TEXT
evidence         JSONB
source_tables    TEXT[]
confidence       NUMERIC
date_range_start DATE
date_range_end   DATE
dedupe_key       TEXT NOT NULL
created_at       TIMESTAMPTZ DEFAULT NOW()
updated_at       TIMESTAMPTZ DEFAULT NOW()
UNIQUE (workspace_id, dedupe_key, date_range_start, date_range_end)
```
Estratégia: fetch-before-upsert preserva status analista.

### `ga4_first_light_summary`
```sql
id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
workspace_id     UUID NOT NULL
ga4_dataset      TEXT NOT NULL
total_events     BIGINT
total_users      BIGINT
sessions         BIGINT
page_views       BIGINT
top_events       JSONB
top_landing_pages JSONB
conversion_events JSONB
date_range_start DATE NOT NULL
date_range_end   DATE NOT NULL
latest_table     TEXT
updated_at       TIMESTAMPTZ DEFAULT NOW()
UNIQUE (workspace_id, ga4_dataset, date_range_start, date_range_end)
```

### `semantic_governance_runs`
```sql
id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
workspace_id     UUID NOT NULL
tenant_slug      TEXT NOT NULL
date_range_start DATE NOT NULL
date_range_end   DATE NOT NULL
started_at       TIMESTAMPTZ DEFAULT now()
finished_at      TIMESTAMPTZ
status           TEXT CHECK (status IN ('running','success','error'))
checks_run       INTEGER DEFAULT 0
findings_count   INTEGER DEFAULT 0
error_message    TEXT
created_at       TIMESTAMPTZ DEFAULT now()
```

### `semantic_governance_findings`
```sql
id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
run_id           UUID NOT NULL REFERENCES semantic_governance_runs(id) ON DELETE CASCADE
workspace_id     UUID NOT NULL
check_name       TEXT NOT NULL
status           TEXT NOT NULL
severity         TEXT NOT NULL
source_platform  TEXT DEFAULT 'ga4'
affected_rows    INTEGER DEFAULT 0
metric_value     NUMERIC
threshold_value  NUMERIC
details          JSONB    -- GIN index
date_range_start DATE NOT NULL
date_range_end   DATE NOT NULL
created_at       TIMESTAMPTZ DEFAULT now()
```

### `semantic_governance_evidence`
```sql
id             UUID PRIMARY KEY DEFAULT gen_random_uuid()
finding_id     UUID NOT NULL REFERENCES semantic_governance_findings(id) ON DELETE CASCADE
evidence_type  TEXT NOT NULL
evidence_data  JSONB NOT NULL    -- GIN index; cap: MAX_EVIDENCE_ROWS_PER_FINDING = 25
created_at     TIMESTAMPTZ DEFAULT now()
```

### `operational_events`
```sql
id             UUID PRIMARY KEY DEFAULT gen_random_uuid()
workspace_id   UUID NOT NULL
event_type     TEXT    -- 'anomaly' | 'intervention' | 'governance_fix' | 'system_change'
category       TEXT    -- 'kpi_anomaly' | 'sync_success' | 'sync_error' | 'budget' | 'naming'
impact_scope   JSONB   -- GIN index; payload: values before/after, metrics, deviations
actor          TEXT    -- 'system' ou email do utilizador
evidence_id    UUID    -- FK opcional para semantic_governance_evidence
occurred_at    TIMESTAMPTZ
created_at     TIMESTAMPTZ DEFAULT now()
```
Índices: `(workspace_id, occurred_at DESC)` + `GIN(impact_scope)`.

### `agent_decisions`
```sql
id             UUID PRIMARY KEY DEFAULT gen_random_uuid()
workspace_id   UUID NOT NULL
agent_id       TEXT NOT NULL    -- 'growth-master' | 'creative-critic' | 'anomaly-scout'
type           TEXT NOT NULL    -- 'analysis' | 'suggestion' | 'action' | 'alert'
title          TEXT NOT NULL
body           TEXT NOT NULL
rationale      TEXT
impact_value   TEXT
metadata       JSONB DEFAULT '{}'
status         TEXT DEFAULT 'pending'  -- 'pending' | 'approved' | 'rejected' | 'auto-applied'
dedupe_key     TEXT NOT NULL
created_at     TIMESTAMPTZ DEFAULT now()
updated_at     TIMESTAMPTZ DEFAULT now()
UNIQUE (workspace_id, dedupe_key)
```
- **Trigger `agent_decisions_preserve_status`:** impede que re-sync reverta status `approved`/`rejected` para `pending`.
- **RLS:** SELECT + UPDATE para `authenticated`, scoped via `profiles.workspace_id`.

---

## Migrations Aplicadas

| Ficheiro | O que faz |
|---|---|
| `000_remote_baseline_public_schema.sql` | Baseline inicial (`workspaces`, `profiles`, tabelas base) |
| `001_sync_runs.sql` | Cria `sync_runs` |
| `002_metadata_and_constraints.sql` | Metadata, tipos, UNIQUE constraints para upsert |
| `003_data_quality_report.sql` | Cria `data_quality_report` com RLS pública |
| `004_insight_feed.sql` | Cria `insight_feed` com RLS pública |
| `005_ga4_first_light_summary.sql` | Cria `ga4_first_light_summary` |
| `006_semantic_governance.sql` | 3 tabelas de governance com FKs, CASCADE, GIN índices |
| `007_semantic_governance_read_policies.sql` | RLS + SELECT público nas 3 tabelas de governance |
| `008_align_sync_runs_rls.sql` | Habilita RLS em `sync_runs` |
| `009_sync_runs_read_policy.sql` | SELECT scoped ao workspace Woke (UUID na policy — substituir quando auth multi-tenant estiver pronto) |
| `010_operational_events.sql` | Cria `operational_events` + índices |
| `011_rls_operational_events.sql` | RLS + SELECT público scoped ao workspace |
| `012_campaign_summary_expand_metrics.sql` | Adiciona `clicks`, `impressions`, `ctr`, `ad_quality_score` à `campaign_summary` |
| `013_rls_hardening.sql` | Substitui `TO public` por `TO authenticated` workspace-scoped via `profiles` em 12 tabelas |
| `014_agent_decisions.sql` | Cria `agent_decisions` + trigger + RLS + índices |

**Regra:** migrations aplicadas nunca são modificadas — risco de checksum drift no Supabase CLI.

---

## Estado de RLS (pós migration 013)

| Tabela | RLS | Política actual |
|---|---|---|
| `campaign_summary` | ✅ | `TO authenticated` + `profiles.workspace_id` |
| `keyword_analysis` | ✅ | `TO authenticated` + `profiles.workspace_id` |
| `kpi_cache_daily` | ✅ | `TO authenticated` + `profiles.workspace_id` |
| `data_quality_report` | ✅ | `TO authenticated` + `profiles.workspace_id` |
| `insight_feed` | ✅ | `TO authenticated` + `profiles.workspace_id` |
| `ga4_first_light_summary` | ✅ | `TO authenticated` + `profiles.workspace_id` |
| `semantic_governance_runs` | ✅ | `TO authenticated` + `profiles.workspace_id` |
| `semantic_governance_findings` | ✅ | `TO authenticated` + `profiles.workspace_id` |
| `semantic_governance_evidence` | ✅ | `TO authenticated` + `profiles.workspace_id` |
| `sync_runs` | ✅ | `TO public USING (workspace_id = '<woke-uuid>')` — substituir quando multi-tenant |
| `operational_events` | ✅ | `TO public USING (workspace_id = '<woke-uuid>')` |
| `agent_decisions` | ✅ | `TO authenticated` + `profiles.workspace_id` |

---

## Utilizadores Auth

| Email | Role |
|---|---|
| `ervin.moriyama@gmail.com` | Admin |
| `tosi.gabriel@gmail.com` | User |

---

## Função SQL: `fn_campaign_snapshot_delta`

Compara performance de campanhas entre dois janelas de 30 dias (rolling window):
- **Período A:** `MAX(date_range_end)` mais recente
- **Período B:** Período A − 7 dias

Parâmetro: `target_workspace_id UUID`

Métricas calculadas: `spend`, `conversions`, `clicks`, `cpa` (spend/conversions), `cpc` (spend/clicks), `ctr` (clicks_agg/impressions_agg × 100).

Filtro de saída: apenas variações com `ABS(delta) > 15%`.

Classificação: `CRITICAL` (>50%) | `SIGNIFICANT` (>15%).

Definição canónica em `docs/sql/fn_campaign_snapshot_delta.sql`.
