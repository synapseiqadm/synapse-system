# SynapseIQ — Memorial Descritivo

**Versão:** 3.1  
**Data:** Maio 2026  
**Stack:** Next.js 16 · Supabase · BigQuery · Python · Vercel · GitHub Actions

---

## 1. Visão Geral

O **SynapseIQ** é uma plataforma B2B de inteligência de marketing digital, concebida como um **AI Growth Orchestrator** com arquitectura warehouse-native. O sistema centraliza dados de canais de media paga (Google Ads via BigQuery) num painel analítico multi-tenant, preparado para expansão com GA4 e agentes de IA.

O workspace piloto é a agência **Woke People** (`workspace_id: a082fe86-a65f-4c9b-9442-fe775f47e3fc`, slug: `woke`), cujos dados de Google Ads são sincronizados diariamente a partir do BigQuery para o Supabase.

O dashboard inclui atualmente: visão geral de KPIs, campanhas, palavras-chave, qualidade dos dados e insights determinísticos. A identificação do tenant ativo aparece na sidebar e no header do dashboard.

---

## 2. Arquitectura do Sistema

```
GitHub (synapseiqadm/synapse-system)
│
├── frontend/          → Next.js 16 App Router  →  Vercel (produção)
│   └── src/
│       ├── app/dashboard/page.tsx
│       ├── components/
│       │   ├── DataQualityView.tsx
│       │   └── InsightsView.tsx
│       ├── lib/
│       │   └── workspace.ts        → Configuração centralizada do workspace
│       └── utils/supabase/
│           ├── client.ts
│           └── server.ts
│
├── backend/
│   ├── connectors/
│   │   ├── semantic_registry.py     → Loader do semantic registry (v1.3.1)
│   │   ├── a_data_sync.py           → Entry point (orquestra todos os módulos)
│   │   ├── config.py                → Configuração e fail-fast
│   │   ├── sync_runs.py             → Auditoria de execuções
│   │   ├── sync_ads.py              → BigQuery → Supabase (campaigns + keywords)
│   │   ├── sync_ga4.py              → GA4 First Light (tabelas, sumário, upsert)
│   │   ├── data_quality.py          → A-Data: 19 checks A–S, sendo A–F Ads, G–K GA4 e L–S Semantic Governance
│   │   ├── insights.py              → A-Insights: determinísticos + semânticos
│   │   ├── semantic_governance.py   → Governança semântica (8 checks + persistência)
│   │   └── sync_woke.py             → DEPRECATED (mantido para referência)
│   ├── governance/
│   │   ├── semantic_registry.yml    → Registry canônico de checks semânticos (v1.3.1)
│   │   ├── templates/
│   │   │   └── tenant_measurement_config.template.yml
│   │   └── tenants/
│   │       └── woke_measurement_config.yml
│   └── tests/
│       ├── __init__.py
│       └── test_semantic_governance.py   → 36 testes unitários
│
├── supabase/migrations/
│   ├── 001_sync_runs.sql
│   ├── 002_metadata_and_constraints.sql
│   ├── 003_data_quality_report.sql
│   ├── 004_insight_feed.sql
│   ├── 005_ga4_first_light_summary.sql
│   ├── 006_semantic_governance.sql
│   └── 007_semantic_governance_read_policies.sql  ← RLS + SELECT público (MVP)
│
├── docs/
│   ├── semantic_model.md                                   → Vocabulário canônico de conceitos (v1.3.1)
│   └── sql/
│       ├── insight_feed_rls_hardening_future.sql           → Draft (NÃO aplicar sem auth)
│       ├── semantic_governance_rls_hardening_future.sql    → Draft (NÃO aplicar sem auth)
│   ├── mart_growth_funnel_events.sql                       → Proposta analítica (NÃO aplicar via migration)
│   ├── mart_paid_sessions_quality.sql                      → Proposta analítica (NÃO aplicar via migration)
│   └── mart_semantic_event_coverage.sql                    → Proposta analítica (NÃO aplicar via migration)
│
└── .github/workflows/
    └── sync_data.yml     → GitHub Actions (cron diário 06h BRT)
```

**Fluxo de dados:**
```
Google Ads                              GA4 (analytics_289891960)
  → Airbyte Transfer                      → BigQuery export diário
    → BigQuery (raw_google_ads_woke)          ↓
        ↓                               sync_ga4.py
      a_data_sync.py ──────────────────────────────────────────────┐
          ├── sync_ads.py          → campaign_summary / keyword_analysis
          ├── sync_ga4.py          → ga4_first_light_summary
          ├── data_quality.py      → data_quality_report (checks A–F + L–S)
          │     └── semantic_governance.py
          │           ├── run   → semantic_governance_runs
          │           ├── finds → semantic_governance_findings
          │           └── evid  → semantic_governance_evidence
          └── insights.py          → insight_feed
                                       → Dashboard Next.js
```

---

## 3. Frontend — Next.js 16

### 3.1 Tecnologias
| Pacote | Versão | Uso |
|---|---|---|
| `next` | 16.2.5 (Turbopack) | Framework |
| `@supabase/ssr` | 0.10.2 | Auth SSR |
| `@supabase/supabase-js` | 2.105.3 | Cliente DB |
| `recharts` | 3.x | Gráficos |
| `lucide-react` | 1.x | Ícones (Building2 confirmado presente) |
| `tailwindcss` | 4.x | Estilos |

### 3.2 Estrutura de Rotas

| Rota | Tipo | Descrição |
|---|---|---|
| `/` | Static + Redirect | Redireciona permanentemente para `/dashboard` |
| `/login` | Static | Autenticação com email/password via Supabase Auth |
| `/dashboard` | Client Component | Painel principal de analytics |
| `/agents` | Static | Central de Agentes de IA (scaffolding) |
| `/connectors` | Static | Central de Conectores (scaffolding) |
| `/logs` | Static | Log de Execução (scaffolding) |

### 3.3 Autenticação

Implementada com `@supabase/ssr` em três camadas:

- **`src/proxy.ts`** (Edge Middleware) — intercepta todos os pedidos, verifica sessão e redireciona utilizadores não autenticados para `/login`. Substituiu `middleware.ts` (convenção deprecada no Next.js 16).
- **`src/utils/supabase/server.ts`** — cliente SSR para Server Components, com fallback para variáveis sem prefixo `NEXT_PUBLIC_`.
- **`src/utils/supabase/client.ts`** — cliente browser para Client Components (`"use client"`).

Chaves utilizadas:
- **Anon JWT key** (`eyJ...`) → `NEXT_PUBLIC_SUPABASE_ANON_KEY` — browser e server
- **Service key** (`sb_secret_...`) → `SUPABASE_SERVICE_KEY` — backend Python e GitHub Actions exclusivamente

### 3.4 Configuração do Workspace (`src/lib/workspace.ts`)

Ponto único de configuração do tenant ativo:

```typescript
export const DEFAULT_WORKSPACE = {
  id:   process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_ID   || "a082fe86-...",
  name: process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_NAME || "Woke People",
  slug: process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG || "woke",
};
```

Todos os componentes importam `DEFAULT_WORKSPACE.id` — o UUID não está duplicado em nenhum ficheiro de componente. Suporta override via variáveis de ambiente `NEXT_PUBLIC_DEFAULT_WORKSPACE_*`.

### 3.5 Dashboard (`/dashboard`)

Client Component com navegação via sidebar. `NavItem` union: `"geral" | "growth" | "campanhas" | "keywords" | "qualidade" | "insights" | "canais" | "configuracoes"`.

#### Vista: Geral
- Selector de período (7d / 15d / 30d)
- 3 Metric Cards: Investimento Total, Conversões, ROAS Médio
- Gráfico dual-axis (Recharts): Custo (eixo esquerdo) vs. ROAS (eixo direito)
- Dados de `kpi_cache_daily` filtrados por workspace e período

#### Vista: Campanhas → Visão Geral
- Strip de KPIs: Total investido, Campanhas activas, ROAS médio
- Grid de `CampaignCard` com glassmorphism e share of spend bar
- ROAS badge semáforo: verde ≥ 3.0x · âmbar ≥ 1.5x · vermelho < 1.5x
- Dados de `campaign_summary` ordenados por custo

#### Vista: Campanhas → Palavras-chave
- Tabela com 7 colunas: Keyword · Tipo · Campanha · Cliques · Custo · Conv. · CPA
- Filtro por match type + campo de busca full-text
- Dados de `keyword_analysis` ordenados por conversões DESC

#### Vista: Qualidade (`DataQualityView`)
- Score de saúde (0–100) com semáforo: Excelente / Bom / Atenção / Crítico
- 4 cards de resumo: Saúde · Passou · Avisos/Falhas · Última verificação
- Tabela expandível por check com accordion de detalhes e exemplos
- Filtro por status (Todos / Passou / Aviso / Falha / Crítico) e ordenação
- Microcopy de aviso quando `warnings > 0`
- Dados de `data_quality_report` (deduplicados por `check_name` — registo mais recente)

#### Vista: Insights (`InsightsView`)
- 5 cards de resumo: Total · Novos · Alta/Crítico · Tratados · Última atualização
- Lista de `InsightCard` ordenada por severidade + data
- Accordion com evidências estruturadas por tipo de insight
- Dois filtros em pill: status (Todos/Novos/Revisados/Resolvidos/Descartados) + tipo
- Busca full-text: título, sumário, recomendação, tipo, evidência
- Ações de status por card: Revisar → Resolver / Descartar / Reabrir
- Atualização otimista de estado (sem reload)
- Microcopy: "Estes insights são determinísticos e baseados em regras."
- Dados de `insight_feed` ordenados por `updated_at DESC`

### 3.6 Sidebar

Estrutura hierárquica com expansão animada e identificação do tenant ativo:

```
SynapseIQ                   ← título
─────────────────
Cliente                     ← seção de tenant
Woke People                 ← DEFAULT_WORKSPACE.name
─────────────────
├── Geral
├── Growth Intelligence     ← novo (v1.3)
├── Campanhas ▾
│   ├── Visão Geral
│   └── Palavras-chave
├── ──────────────
├── Qualidade
├── Insights
├── Canais
└── Configurações
─────────────────
[W] Woke People             ← badge inferior (workspace)
    workspace
```

O header da área principal também exibe um badge pill `Building2 + "Woke People"` à direita em todas as abas.

---

## 4. Backend — A-Data Sync (Python)

### 4.1 Estrutura de Módulos

```
backend/connectors/
├── __init__.py
├── config.py                → Validação fail-fast; constantes; MEASUREMENT_CONFIG_PATH
├── sync_runs.py             → Helpers de auditoria: start / finish_success / finish_error
├── sync_ads.py              → sync_campaigns() + sync_keywords()
├── sync_ga4.py              → GA4 First Light: get_ga4_tables(), get_ga4_first_light_summary(),
│                              sync_ga4_first_light()
├── data_quality.py          → 19 checks A–S; A–F Ads, G–K GA4, L–S via semantic_governance
├── insights.py              → Geradores determinísticos + semânticos; lifecycle resolve_obsolete
├── semantic_governance.py   → load_measurement_config(), classify_url_environment(),
│                              8 checks L–S, persistência (runs/findings/evidence),
│                              generate_semantic_insights()
├── a_data_sync.py           → Entry point: orquestra tudo + auditoria + --dry-run
└── sync_woke.py             → DEPRECATED — mantido para referência histórica
```

### 4.2 Dependências
```
supabase
google-cloud-bigquery
python-dotenv
```

### 4.3 Módulos

#### `config.py`
- Carrega `.env` via `python-dotenv`; snapshot `_PROCESS_ENV` antes de `load_dotenv()` para fail-fast correto em Windows
- `required_env(name)` faz `sys.exit(1)` imediato se a variável estiver ausente
- Expõe: `APP_ENV`, `ALLOW_MOCK_DATA`, `WOKE_WORKSPACE_ID`, `GCP_PROJECT_ID`, `BQ_LOCATION`, `GOOGLE_ADS_DATASET`, `GOOGLE_ADS_CUSTOMER_ID`, `GA4_DATASET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DATE_RANGE_START`, `DATE_RANGE_END`, `INSIGHT_MIN_CAMPAIGN_COST` (default 50), `INSIGHT_MIN_KEYWORD_COST` (default 20), `ENABLE_INSIGHTS` (default true), `MEASUREMENT_CONFIG_PATH` (default: `backend/governance/tenants/woke_measurement_config.yml`)

#### `sync_runs.py`
- `start_sync_run()` → insere registo com `status='running'`; retorna UUID do run
- `finish_sync_run_success(run_id, rows_loaded)` → atualiza para `status='success'`
- `finish_sync_run_error(run_id, error_message)` → atualiza para `status='error'`

#### `sync_ads.py`
- `sync_campaigns(bq_client, supabase, dry_run)` → UPSERT em `campaign_summary`
- `sync_keywords(bq_client, supabase, dry_run)` → UPSERT em `keyword_analysis`
- `ga4_real_data_available(bq_client, ga4_dataset)` → verifica `INFORMATION_SCHEMA.TABLES` do dataset GA4
- `can_use_mock_data(app_env, allow_mock)` → bloqueia mock em `production`

#### `data_quality.py`
Executa 19 checks de qualidade e escreve resultados em `data_quality_report`.

**Checks de Google Ads (A–F):**
- **A** — `campaign_summary_missing_campaign_id`
- **B** — `campaign_summary_zero_conversions_with_cost`
- **C** — `keyword_analysis_zero_conversions_with_cost`
- **D** — `campaign_summary_freshness`
- **E** — `keyword_analysis_freshness`
- **F** — `mock_data_presence`

**Checks de GA4 (G–K):**
- **G** — `ga4_dataset_available`
- **H** — `ga4_events_freshness`
- **I** — `ga4_has_page_view`
- **J** — `ga4_has_session_start`
- **K** — `ga4_has_conversion_events`

**Checks de Semantic Governance (L–S):** delegados a `semantic_governance.run_semantic_quality_checks()` quando `measurement_config` está carregado. Incluem: `ga4_ads_overlap_insufficient`, `ga4_conversion_registry_mismatch`, `ads_conversion_action_not_in_registry`, `ads_conversion_action_semantic_review_required`, `ga4_non_production_traffic_detected`, `ga4_suspicious_event_names_detected`, `paid_sessions_without_funnel_progress`, `utm_campaign_empty_in_paid_urls`.

Estratégia de escrita: INSERT (não upsert) — cada execução cria novos registos com timestamp; o dashboard deduplica por `check_name` mantendo o mais recente. Aceita `dry_run=True` sem escrita.

#### `insights.py`
Gera insights determinísticos (sem LLM) e faz upsert em `insight_feed`.

**Tipos determinísticos:**
- **campaign_zero_conversions_with_cost** — campanhas com custo ≥ `INSIGHT_MIN_CAMPAIGN_COST` e zero conversões
- **keyword_zero_conversions_with_cost** — keywords com custo ≥ `INSIGHT_MIN_KEYWORD_COST` e zero conversões
- **data_quality_warning_context** — aviso contextual quando há checks em warning/failed
- **ga4_configured_but_no_conversion_events** — GA4 ativo mas sem eventos de conversão no período
- **ga4_not_configured** — informativo quando `GA4_DATASET` está vazio

**Tipos semânticos** (gerados a partir dos checks L–S via `semantic_governance.generate_semantic_insights()`):
- **ga4_ads_overlap_insufficient**, **ads_conversion_action_semantic_review_required**, **paid_sessions_without_funnel_progress**, **utm_campaign_empty_in_paid_urls**

`resolve_obsolete_insights(supabase, insight_type, dry_run)` — marca como `resolved` todos os registos `status='new'` de um tipo ao longo de todos os períodos, quando a condição que os gerou desaparece.

Estratégia de upsert: fetch-before-upsert preserva status analista (`reviewed` / `dismissed` / `resolved`).

`dedupe_key`: texto estável por insight. Para keywords usa `sha1[:16]` de `kw_zero_conv|campaign_id|keyword|match_type`.

#### `sync_ga4.py`
- `get_ga4_tables(bq_client, ga4_dataset)` → lista ordenada de tabelas `events_YYYYMMDD` existentes
- `get_ga4_first_light_summary(bq_client, ga4_dataset, tables)` → dict com `total_events`, `total_users`, `sessions`, `page_views`, `top_events`, `top_landing_pages`, `conversion_events`
- `sync_ga4_first_light(bq_client, supabase, dry_run, tables, summary)` → UPSERT em `ga4_first_light_summary`; aceita `tables`/`summary` pré-buscados para evitar round-trips duplicados ao BigQuery
- `GA4_CONVERSION_EVENTS` — lista de nomes de eventos de conversão esperados para check K

#### `semantic_governance.py`
- `load_measurement_config(path)` → carrega YAML do tenant; retorna `None` em qualquer erro (pipeline nunca interrompe por ausência de config)
- `classify_url_environment(url, domains_cfg)` → `"debug" | "local" | "staging" | "preview" | "production" | "unknown"` — prioridade: debug → local → staging → preview → production → unknown
- `MAX_EVIDENCE_ROWS_PER_FINDING = 25` — cap de evidências por finding
- `_PARAM_ALLOWLIST_RE = re.compile(r"^[a-zA-Z0-9_]+$")` — allowlist de nomes de parâmetros antes de interpolação SQL
- Helpers de persistência: `start_governance_run()`, `finish_governance_run()`, `write_governance_findings()`, `_write_finding_evidence()` — todos best-effort (warnings em falha, não exceptions)
- `run_semantic_quality_checks(config, supabase, bq_client, ga4_dataset, ga4_tables, ga4_summary, dry_run)` → executa os 8 checks L–S, persiste runs/findings/evidence
- `generate_semantic_insights(config, semantic_dq_results)` → gera insights a partir dos resultados warning/failed

**Config YAML do tenant** (`woke_measurement_config.yml`):
- `conversion_registry`: canonical_events, intermediate_events, intent_events, ads_only_conversion_actions
- Campos de governança por evento: `business_status`, `provisional_role`, `requires_client_validation`
- `suspicious_events`: lista de nomes genéricos a sinalizar
- `domains`: production / staging / local (usado pelo check P)
- `attribution.required_paid_url_params`: lista validada pelo `_PARAM_ALLOWLIST_RE` antes de interpolação SQL no check S

#### `a_data_sync.py` (entry point)
```bash
# Validação sem escrita
.venv/Scripts/python.exe -m connectors.a_data_sync --dry-run

# Sync completo
.venv/Scripts/python.exe -m connectors.a_data_sync
```

O venv está na raiz do repositório (`D:\dev\synapse\.venv\`), não dentro de `backend/`.

`ga4_tables` e `ga4_summary` são buscados uma única vez no início e passados por parâmetro para `sync_ga4_first_light`, `run_data_quality_checks` e `generate_insights` — evitando round-trips duplicados ao BigQuery.

### 4.4 Campos nos registos sincronizados

| Campo | Tipo | Descrição |
|---|---|---|
| `workspace_id` | UUID | Partição multi-tenant |
| `campaign_id` | TEXT | ID estável do Google Ads (imune a rename) |
| `campaign_name` | TEXT | Nome legível (pode mudar) |
| `data_source` | TEXT | `"google_ads"` — prepara distinção futura com GA4 |
| `source_platform` | TEXT | Igual a `data_source`; campo semântico da arquitectura A-Data |
| `is_mock` | BOOLEAN | `false` em produção; `true` apenas em dados de teste |
| `date_range_start` | DATE | Início do período sincronizado |
| `date_range_end` | DATE | Fim do período sincronizado |
| `loaded_at` | TIMESTAMPTZ | Timestamp UTC da ingestão |

---

## 5. Base de Dados — Supabase

**Projecto:** `synapse-system`  
**ID:** `lasocsneburvtxqgqhie`  
**Região:** `sa-east-1` (São Paulo)

### 5.1 Tabelas

#### `campaign_summary`
```sql
workspace_id     UUID
campaign_id      TEXT          -- era BIGINT; alterado para TEXT (migration 002)
campaign_name    TEXT
cost             NUMERIC
conversions      NUMERIC(10,2) -- era INT; alterado para NUMERIC (migration 002)
roas             NUMERIC
data_source      TEXT  DEFAULT 'google_ads'
source_platform  TEXT
is_mock          BOOLEAN DEFAULT FALSE
date_range_start DATE
date_range_end   DATE
loaded_at        TIMESTAMPTZ DEFAULT NOW()
UNIQUE (workspace_id, campaign_id, date_range_start, date_range_end)
-- RLS: SELECT público (TO public USING (true))
```

#### `keyword_analysis`
```sql
workspace_id     UUID
campaign_id      TEXT
campaign_name    TEXT
keyword          TEXT
match_type       TEXT
clicks           INT
cost             NUMERIC
conversions      NUMERIC(10,2)
data_source      TEXT  DEFAULT 'google_ads'
source_platform  TEXT
is_mock          BOOLEAN DEFAULT FALSE
date_range_start DATE
date_range_end   DATE
loaded_at        TIMESTAMPTZ DEFAULT NOW()
UNIQUE (workspace_id, campaign_id, keyword, match_type, date_range_start, date_range_end)
-- RLS: SELECT público (TO public USING (true))
```

#### `sync_runs` *(migration 001)*
```sql
id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
workspace_id     UUID
source_platform  TEXT
data_source      TEXT
status           TEXT  CHECK (status IN ('running','success','error'))
started_at       TIMESTAMPTZ
finished_at      TIMESTAMPTZ
rows_loaded      INTEGER DEFAULT 0
is_mock          BOOLEAN DEFAULT FALSE
date_range_start DATE
date_range_end   DATE
error_message    TEXT
created_at       TIMESTAMPTZ DEFAULT NOW()
```

#### `kpi_cache_daily`
```sql
workspace_id   UUID
date           DATE
metric_name    TEXT   -- 'total_cost' | 'roas' | 'conversions'
metric_value   NUMERIC
channel        TEXT
-- RLS: SELECT público (TO public USING (true))
```

#### `data_quality_report` *(migration 003)*
```sql
id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
workspace_id     UUID NOT NULL
check_name       TEXT NOT NULL
check_category   TEXT NOT NULL
status           TEXT NOT NULL CHECK (status IN ('passed','warning','failed'))
severity         TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical'))
source_platform  TEXT
target_table     TEXT
metric_value     NUMERIC
threshold_value  NUMERIC
affected_rows    INTEGER NOT NULL DEFAULT 0
details          JSONB
date_range_start DATE
date_range_end   DATE
checked_at       TIMESTAMPTZ DEFAULT NOW()
-- RLS: SELECT público (TO public USING (true))
```

#### `insight_feed` *(migration 004)*
```sql
id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
workspace_id     UUID NOT NULL
insight_type     TEXT NOT NULL
severity         TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical'))
status           TEXT NOT NULL DEFAULT 'new'
                              CHECK (status IN ('new','reviewed','dismissed','resolved'))
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
-- RLS: SELECT público (TO public USING (true))
```

#### `ga4_first_light_summary` *(migration 005)*
```sql
id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
workspace_id     UUID NOT NULL
ga4_dataset      TEXT NOT NULL
total_events     BIGINT
total_users      BIGINT
sessions         BIGINT
page_views       BIGINT
top_events       JSONB     -- array de {event_name, count}
top_landing_pages JSONB    -- array de {page_location, views}
conversion_events JSONB    -- array de {event_name, count}
date_range_start DATE NOT NULL
date_range_end   DATE NOT NULL
latest_table     TEXT
updated_at       TIMESTAMPTZ DEFAULT NOW()
UNIQUE (workspace_id, ga4_dataset, date_range_start, date_range_end)
```

#### `semantic_governance_runs` *(migration 006)*
```sql
id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
workspace_id     UUID NOT NULL
tenant_slug      TEXT NOT NULL
date_range_start DATE NOT NULL
date_range_end   DATE NOT NULL
started_at       TIMESTAMPTZ NOT NULL DEFAULT now()
finished_at      TIMESTAMPTZ
status           TEXT CHECK (status IN ('running','success','error'))
checks_run       INTEGER NOT NULL DEFAULT 0
findings_count   INTEGER NOT NULL DEFAULT 0   -- conta apenas warnings/failed
error_message    TEXT
created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
```

#### `semantic_governance_findings` *(migration 006)*
```sql
id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
run_id           UUID NOT NULL REFERENCES semantic_governance_runs(id) ON DELETE CASCADE
workspace_id     UUID NOT NULL
check_name       TEXT NOT NULL
status           TEXT NOT NULL
severity         TEXT NOT NULL
source_platform  TEXT NOT NULL DEFAULT 'ga4'
affected_rows    INTEGER NOT NULL DEFAULT 0
metric_value     NUMERIC
threshold_value  NUMERIC
details          JSONB                          -- GIN index
date_range_start DATE NOT NULL
date_range_end   DATE NOT NULL
created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
```

#### `semantic_governance_evidence` *(migration 006)*
```sql
id             UUID PRIMARY KEY DEFAULT gen_random_uuid()
finding_id     UUID NOT NULL REFERENCES semantic_governance_findings(id) ON DELETE CASCADE
evidence_type  TEXT NOT NULL                   -- nome da chave lista em details
evidence_data  JSONB NOT NULL                  -- GIN index; item individual da lista
created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
-- Capped a MAX_EVIDENCE_ROWS_PER_FINDING (25) por lista pelo pipeline
```

### 5.2 Migrations aplicadas

| Ficheiro | O que faz |
|---|---|
| `001_sync_runs.sql` | Cria tabela `sync_runs` |
| `002_metadata_and_constraints.sql` | Adiciona colunas de metadata; altera tipos; cria UNIQUE constraints para upsert |
| `003_data_quality_report.sql` | Cria tabela `data_quality_report` com RLS pública |
| `004_insight_feed.sql` | Cria tabela `insight_feed` com RLS pública e UNIQUE de dedupe |
| `005_ga4_first_light_summary.sql` | Cria tabela `ga4_first_light_summary` com UNIQUE por workspace+dataset+período |
| `006_semantic_governance.sql` | Cria `semantic_governance_runs`, `_findings` (FK+CASCADE, GIN details), `_evidence` (FK+CASCADE, GIN evidence_data); 8 índices |
| `007_semantic_governance_read_policies.sql` | Habilita RLS nas 3 tabelas de governance + políticas SELECT públicas MVP (`TO public USING (true)`) |

**Regra importante:** migrations aplicadas nunca devem ser modificadas — risco de checksum drift no Supabase CLI.

### 5.3 RLS — Estado atual e plano

Todas as tabelas de dados têm política pública de SELECT (`TO public USING (true)`) porque o dashboard usa a anon key sem autenticação de utilizador. `public.profiles` existe mas tem 0 linhas.

| Tabela | RLS | Política SELECT |
|---|---|---|
| `kpi_cache_daily` | ✅ | `TO public USING (true)` |
| `campaign_summary` | ✅ | `TO public USING (true)` |
| `keyword_analysis` | ✅ | `TO public USING (true)` |
| `data_quality_report` | ✅ | `TO public USING (true)` (migration 003) |
| `insight_feed` | ✅ | `TO public USING (true)` (migration 004) |
| `ga4_first_light_summary` | ✅ | `TO public USING (true)` (migration 005) |
| `semantic_governance_runs` | ✅ | `TO public USING (true)` (migration 007) |
| `semantic_governance_findings` | ✅ | `TO public USING (true)` (migration 007) |
| `semantic_governance_evidence` | ✅ | `TO public USING (true)` (migration 007) |

**Causa raiz do retorno 0 rows nas tabelas de governance:** a migration 006 criou as tabelas sem `ENABLE ROW LEVEL SECURITY` nem políticas. O Supabase habilitou RLS no nível de projeto, bloqueando todas as leituras sem policy. Migration 007 corrige isso.

Os ficheiros `docs/sql/insight_feed_rls_hardening_future.sql` e `docs/sql/semantic_governance_rls_hardening_future.sql` documentam a política endurecida (workspace-scoped, `TO authenticated`) a aplicar quando:
1. Auth for implementado no dashboard
2. `public.profiles` estiver populado (`profiles.id = auth.uid()`, `profiles.workspace_id`)
3. Dashboard usar session tokens em vez da anon key

### 5.4 Utilizadores Auth

| Email | Role | Estado |
|---|---|---|
| `ervin.moriyama@gmail.com` | Admin | Activo |
| `tosi.gabriel@gmail.com` | User | Activo |

---

## 6. CI/CD e Infraestrutura

### 6.1 GitHub Actions — `.github/workflows/sync_data.yml`

- **Trigger:** `workflow_dispatch` (manual) — `schedule` não configurado ainda (pendente validação do dry-run em CI)
- **Input:** `dry_run` (boolean, default `true`) — protege contra escrita acidental em produção
- **Concurrency:** `group: a-data-sync-woke`, `cancel-in-progress: false` — enfileira triggers simultâneos em vez de cancelar
- **Runner:** `ubuntu-latest`
- **Comando:** `cd backend && python -m connectors.a_data_sync [--dry-run]`
- **Credenciais GCP:** secret `GOOGLE_CREDENTIALS_JSON` → `printenv` → `/tmp/gcp_credentials.json` → removido com `if: always()`
- **Secrets necessários:**

| Secret | Uso |
|---|---|
| `GOOGLE_CREDENTIALS_JSON` | Conteúdo JSON da service account GCP |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_KEY` | Chave service (nunca a anon key) |

- **Variáveis de ambiente injectadas pelo workflow:**

| Variável | Valor |
|---|---|
| `APP_ENV` | `production` |
| `ALLOW_MOCK_DATA` | `false` |
| `WOKE_WORKSPACE_ID` | `a082fe86-a65f-4c9b-9442-fe775f47e3fc` |
| `GCP_PROJECT_ID` | `synapsesystem` |
| `BQ_LOCATION` | `southamerica-east1` |
| `GOOGLE_ADS_DATASET` | `raw_google_ads_woke` |
| `GOOGLE_ADS_CUSTOMER_ID` | `6627867790` |
| `GA4_DATASET` | `""` (GA4 desativado em CI — pendente confirmação de acesso da service account a `analytics_289891960`) |
| `DATE_RANGE_DAYS` | `30` |
| `ENABLE_INSIGHTS` | `true` |

### 6.2 Vercel — Produção

- **URL:** `synapse-system.vercel.app`
- **Projecto:** `synapse-system` (team `synapse-iq`)
- **Root Directory:** `frontend/`
- **Framework:** Next.js
- **Node:** 24.x

**Variáveis de ambiente configuradas:**

| Variável | Scope |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production + Preview |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production + Preview |
| `SUPABASE_URL` | Production + Preview |
| `SUPABASE_SERVICE_KEY` | Production + Preview |
| `WOKE_WORKSPACE_ID` | Production + Preview |

---

## 7. Decisões Técnicas Relevantes

| Decisão | Motivo |
|---|---|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` usa JWT legacy (`eyJ...`) | `@supabase/ssr@0.10.2` não reconhece formato `sb_publishable_...` |
| `middleware.ts` → `proxy.ts` | Breaking change Next.js 16: convenção `middleware` deprecada |
| `await cookies()` em `server.ts` | Next.js 16: `cookies()` é async |
| `campaign_id` como TEXT | Era BIGINT; TEXT é agnóstico a fonte — GA4 pode ter IDs não numéricos |
| `conversions` como NUMERIC(10,2) | Google Ads devolve floats; INT causava erros de tipo no Supabase |
| UPSERT com `date_range_start/end` na chave | Preserva histórico por período; evita sobrescrever dados de janelas anteriores |
| DELETE + INSERT → UPSERT | Mais seguro: não apaga dados caso a query BigQuery retorne vazio |
| `sync_runs` como tabela de auditoria | Regista cada execução com status, contagem e erros; base para alertas futuros |
| `source_platform` + `data_source` separados | `source_platform` = origem técnica; `data_source` = tabela destino; prepara GA4 |
| `is_mock` em todos os registos | Permite filtrar dados de teste do dashboard sem apagar nada |
| `ga4_real_data_available()` via INFORMATION_SCHEMA | Detecção passiva: script nunca falha por GA4 ausente |
| `can_use_mock_data()` bloqueia em production | Garante que dados fictícios nunca chegam ao Supabase de produção |
| `sys.exit(1)` em env vars ausentes | Fail-fast: melhor abortar do que continuar com estado indefinido |
| `_PROCESS_ENV` snapshot antes de `load_dotenv()` | Windows remove variável ao definir `=""` — snapshot garante fail-fast correto |
| `python -m connectors.a_data_sync` | Execução como módulo; resolve imports relativos sem hacks de sys.path no CI |
| RLS pública em todas as tabelas de dados | Dashboard MVP usa anon key sem auth; `profiles` tem 0 linhas; política endurecida documentada em `docs/sql/` |
| Migration 006 sem RLS → corrigida em 007 | 006 omitiu `ENABLE ROW LEVEL SECURITY` e policies; Supabase bloqueou reads; 007 adiciona as policies MVP sem alterar estrutura |
| Migrations aplicadas nunca são modificadas | Risco de checksum drift no Supabase CLI; comentários/anotações vão em documentação, não no SQL |
| Drafts de migration em `docs/sql/` não em `supabase/migrations/` | Evita aplicação acidental por CI/CD |
| `data_quality_report` usa INSERT, não upsert | Cada execução é um novo snapshot; dashboard deduplica por `check_name` mantendo mais recente |
| `insight_feed` usa fetch-before-upsert | Preserva status analista (`reviewed`/`dismissed`/`resolved`) entre reprocessamentos |
| `dedupe_key` como hash sha1[:16] para keywords | Keywords têm caracteres especiais; hash estável evita collisions e tamanho fixo |
| `workspace_id` centralizado em `src/lib/workspace.ts` | Era duplicado em 3 componentes; fonte única facilita troca de tenant e suporta override por env var |
| Tenant identificado em sidebar + header + views | Dashboard multi-tenant futuro — identificação visual desde o MVP evita ambiguidade nos dados |

---

## 8. Próximos Passos

### Pendentes (carregados de v2.0 / v3.0)
- [ ] Popular `kpi_cache_daily` via script de sync (alimenta a vista Geral do dashboard)
- [ ] Alertas automáticos por e-mail quando ROAS < threshold (`sync_runs` disponível como gatilho)
- [ ] Remover código de debug (`alert` / `console.error`) da página `/login`
- [ ] Remover `sync_woke.py` DEPRECATED após próximo ciclo de sync bem-sucedido
- [ ] Adicionar `NEXT_PUBLIC_DEFAULT_WORKSPACE_*` às variáveis de ambiente no Vercel
- [ ] Implementar autenticação no dashboard (pré-requisito para RLS endurecida)
- [ ] Aplicar `docs/sql/insight_feed_rls_hardening_future.sql` quando auth estiver pronto
- [ ] Aplicar `docs/sql/semantic_governance_rls_hardening_future.sql` quando auth estiver pronto (migration 007 é a versão MVP)
- [ ] Multi-workspace: selector de workspace na sidebar

### Próxima etapa liberada — v1.2 Data Marts e API Contracts

Objetivo: criar camada estável de leitura para o frontend e futuros agentes de IA.

Entregáveis esperados:
- [ ] Contratos JSON para cada endpoint de leitura
- [ ] Endpoints de leitura: governance runs, findings, evidence
- [ ] Filtros por workspace, período, ambiente, source, medium, campaign
- [ ] Validar e aplicar as propostas em `docs/sql/mart_*.sql` de forma controlada
- [ ] Preparação para Frontend GA4 MVP (v1.3)

### Roadmap

| Versão | Escopo | Estado |
|---|---|---|
| v1.0 | A-Data Ads + A-Insights + Data Quality | ✅ Concluído |
| v1.1 | GA4 First Light + Semantic Governance | ✅ Concluído — commit `18b97c9` |
| v1.2 | Data Marts e API Contracts | ✅ Concluído |
| v1.3 | Frontend GA4 MVP | ✅ Concluído |
| v1.3.1 | Semantic Model and Rule Registry | ✅ Concluído |
| v1.4 | Insights determinísticos no frontend | Pendente |
| v1.5 | AI Growth Analyst Agent | Futuro |
| v1.6 | AI Executive Report Agent | Futuro |

> **Nota:** Enhanced Conversions, GTM, privacidade e consentimento devem entrar futuramente como bloco de governança dedicado, mas não foram implementados na v1.1. Os eventos ambíguos da Woke continuam como `review_required` / `candidate` / `provisional` até validação explícita do cliente.

### Concluídos em v3.0 / v3.1
- [x] A-Data Quality: pipeline de checks + `DataQualityView` com score de saúde e accordion por check
- [x] A-Insights v1: pipeline determinístico (4 tipos) + `InsightsView` com gestão de status
- [x] Preservação de status analista no upsert de insights (fetch-before-upsert)
- [x] Centralização do `workspace_id` em `src/lib/workspace.ts`
- [x] Identificação visual do tenant ativo: sidebar, header, DataQualityView, InsightsView
- [x] GA4 First Light: `sync_ga4.py` + `ga4_first_light_summary` + checks G–K
- [x] Semantic Governance v1.1: `semantic_governance.py` + 8 checks L–S + persistência Supabase
- [x] Testes unitários: 36 testes em `backend/tests/test_semantic_governance.py`
- [x] YAML de governança: template + config Woke com `business_status`, `provisional_role`, `requires_client_validation`
- [x] Marts analíticos em `docs/sql/` como propostas (não aplicados automaticamente)

---

## 9. Atualização Histórica v3.1 — GA4 First Light e Semantic Governance v1.1

**Commit:** `18b97c9` — `feat: add ga4 first light and semantic governance v1.1`  
**Branch:** `main` → `origin/main` (push realizado)  
**Data:** Maio 2026

### Status da entrega

| Item | Status | Observação |
|---|---|---|
| GA4 First Light | ✅ Entregue e validado | `sync_ga4.py` + `ga4_first_light_summary`; events_20260507 |
| Semantic Governance v1.1 | ✅ Entregue e validado | 8 checks L–S + persistência em 3 tabelas |
| Data Quality GA4 (checks G–K) | ✅ Entregue e validado | Integrados em `data_quality.py` |
| Semantic Insights (4 tipos) | ✅ Entregue e validado | Gerados a partir dos resultados L–S |
| Persistência Supabase | ✅ Validado em produção | runs/findings/evidence gravados com sucesso |
| Testes unitários | ✅ 36/36 passed | `backend/tests/test_semantic_governance.py` |
| Dry-run | ✅ Validado | Zero escritas no Supabase; todos os checks presentes |
| Execução real | ✅ Validado | campaigns=7, keywords=81, 19 DQ checks, 21 insights |
| Commit e push | ✅ Realizado | `18b97c9` em `main` |

### Resultado da validação

- **36/36 testes passaram** — deduplicação, config loading, review_required, classify_url_environment, check S multi-param, dry-run sem escrita, evidência truncada a 25 rows
- **Dry-run sem escrita no Supabase** — `[semantic_governance] --dry-run: would write 8 findings`; nenhum INSERT real
- **Execução real persistiu corretamente:**
  - `semantic_governance_runs`: 1 run com `status=success`, `checks_run=8`, `findings_count=6`, `finished_at` preenchido
  - `semantic_governance_findings`: 8 findings (6 warnings + 2 passed)
  - `semantic_governance_evidence`: 40 evidence rows em 7 checks
- **Check P classificou tráfego local corretamente** — `localhost/signin` → `local`; breakdown `{"local": 1}` gravado em `details`
- **Check S validou 7 parâmetros pagos** — `utm_campaign` com 0% de presença isolado em `missing_params`; os outros 6 parâmetros com 100% de cobertura
- **Warnings continuam não bloqueantes** — pipeline completou `done` mesmo com 6 warnings
- **`review_required` não quebra pipeline** — `ads_conversion_action_semantic_review_required` gerou `warning/medium` e foi persistido como finding; nenhuma exception

### Arquivos entregues

| Arquivo | Tipo | O que faz |
|---|---|---|
| `backend/connectors/sync_ga4.py` | Novo | GA4 First Light: tabelas, sumário, upsert |
| `backend/connectors/semantic_governance.py` | Novo | 8 checks L–S, persistência, classify_url_environment |
| `backend/connectors/a_data_sync.py` | Modificado | Orquestra GA4 + governance + threading de dry_run |
| `backend/connectors/data_quality.py` | Modificado | 19 checks A–S, dry_run param, delega L–S |
| `backend/connectors/insights.py` | Modificado | Insights semânticos, resolve_obsolete_insights |
| `backend/connectors/config.py` | Modificado | MEASUREMENT_CONFIG_PATH |
| `backend/governance/templates/tenant_measurement_config.template.yml` | Novo | Template com business_status, provisional_role, requires_client_validation |
| `backend/governance/tenants/woke_measurement_config.yml` | Novo | Config real da Woke com eventos e domínios |
| `backend/tests/__init__.py` | Novo | Package marker |
| `backend/tests/test_semantic_governance.py` | Novo | 36 testes unitários, sem deps externas |
| `supabase/migrations/005_ga4_first_light_summary.sql` | Novo | Tabela ga4_first_light_summary |
| `supabase/migrations/006_semantic_governance.sql` | Novo | 3 tabelas de governance com FKs e CASCADE |
| `docs/sql/mart_growth_funnel_events.sql` | Novo | Proposta analítica — NÃO aplicar via migration |
| `docs/sql/mart_paid_sessions_quality.sql` | Novo | Proposta analítica — NÃO aplicar via migration |
| `docs/sql/mart_semantic_event_coverage.sql` | Novo | Proposta analítica — NÃO aplicar via migration |

### Decisões arquiteturais preservadas

- **Não decidir pela Woke qual é a conversão definitiva** — todos os eventos permanecem `candidate`, `provisional` ou `requires_client_validation: true`
- **Tratar eventos ambíguos como `review_required`** — `ads_conversion_action_semantic_review_required` gera warning e aparece no dashboard com ressalva; não bloqueia pipeline
- **Não remover eventos suspeitos sem validação** — `suspicious_events` gera sinalização, não deleção
- **Separar tráfego non-production de production** — check P usa `classify_url_environment()` com prioridade debug→local→staging→preview→production; uma URL de produção com `?debug=1` é corretamente classificada como `debug`
- **Não aplicar marts automaticamente** — `docs/sql/mart_*.sql` são propostas; a migration 006 não os referencia
- **Persistência best-effort** — se tabelas de governance não existirem (pré-migration), os helpers imprimem warning e o pipeline continua; nenhum `sys.exit(1)` por falha de persistência de governance
- **Parâmetros SQL sanitizados por allowlist** — `_PARAM_ALLOWLIST_RE = re.compile(r"^[a-zA-Z0-9_]+$")` aplicado antes de interpolar nomes de parâmetros na query BQ do check S

---

## 10. Atualização Histórica v1.2 — Data Marts e API Contracts

**Data:** Maio 2026  
**Objetivo:** Criar uma camada de leitura estável e segura para o frontend e futuros agentes de IA, com contratos TypeScript e endpoints App Router, sem construir a UI final do GA4 e sem implementar agentes de IA.

### 10.1 Endpoints Criados

8 endpoints App Router sob `/api/workspaces/[workspace_id]/`:

| Endpoint | Handler | Tabelas de origem |
|---|---|---|
| `GET /growth/overview` | `getGrowthOverview` | ga4_first_light_summary, campaign_summary, keyword_analysis, data_quality_report, insight_feed |
| `GET /growth/funnel` | `getGrowthFunnel` | ga4_first_light_summary |
| `GET /growth/events` | `getGrowthEvents` | ga4_first_light_summary |
| `GET /growth/paid-sessions` | `getPaidSessionsQuality` | data_quality_report |
| `GET /governance/summary` | `getGovernanceSummary` | semantic_governance_runs, semantic_governance_findings, semantic_governance_evidence, data_quality_report, insight_feed |
| `GET /governance/runs` | `getGovernanceRuns` | semantic_governance_runs |
| `GET /governance/findings` | `getGovernanceFindings` | semantic_governance_findings |
| `GET /governance/evidence` | `getGovernanceEvidence` | semantic_governance_evidence, semantic_governance_findings |

Todos os endpoints recebem `workspace_id` do path, chamam `handleApiRoute` e suportam filtros opcionais: `date_start`, `date_end`, `environment`, `source`, `medium`, `campaign`, `status`, `severity`, `check_name`, `limit` (default 100, máximo 500).

### 10.2 Types Criados

| Arquivo | Conteúdo |
|---|---|
| `frontend/src/types/growth.ts` | `ApiQueryFilters`, `ApiResponseBase`, `Ga4FirstLightSummary`, `CampaignSummaryContract`, `KeywordAnalysisContract`, `GrowthQualityCheck`, `GrowthFunnelEvent`, `GrowthEventsResponse`, `GrowthFunnelResponse`, `GrowthOverviewResponse`, `PaidSessionsQualityContract`, `PaidSessionsQualityResponse` |
| `frontend/src/types/governance.ts` | `GovernanceRun`, `GovernanceFinding`, `GovernanceEvidence`, `GovernanceSummaryResponse`, `GovernanceRunsResponse`, `GovernanceFindingsResponse`, `GovernanceEvidenceResponse`, `SemanticCoverageContract` |

### 10.3 Helpers Criados

| Arquivo | Função |
|---|---|
| `frontend/src/lib/api/common.ts` | `handleApiRoute`, `makeEnvelope`, `parseApiFilters`, `validateWorkspaceId`, `readRows`, `ApiDataError`, `toNumber`, `toNullableNumber`, `asRecord`, `looseJsonMatch`, `isSimpleFilterValue` |
| `frontend/src/lib/api/governance.ts` | `getGovernanceSummary`, `getGovernanceRuns`, `getGovernanceFindings`, `getGovernanceEvidence` |
| `frontend/src/lib/api/growth.ts` | `getGrowthOverview`, `getGrowthFunnel`, `getGrowthEvents`, `getPaidSessionsQuality` |

### 10.4 Envelope JSON Estável

Todas as respostas de sucesso seguem o contrato:

```json
{
  "ok": true,
  "workspace_id": "<uuid>",
  "filters": { "date_start": null, "limit": 100, "..." : "..." },
  "source_tables": ["tabela_a", "tabela_b"],
  "generated_at": "2026-05-08T12:00:00.000Z",
  "warnings": [],
  "data": { "..." : "..." }
}
```

Resposta 401 (sem sessão):

```json
{
  "ok": false,
  "error": {
    "message": "Unauthorized",
    "code": "unauthorized",
    "table": null
  }
}
```

### 10.5 Decisões Arquiteturais

| Decisão | Motivo |
|---|---|
| Marts propostos em `docs/sql/` usados como referência analítica, não como migrations | Compatibilidade imediata sem novas migrations; sem risco de checksum drift |
| APIs protegidas por `supabase.auth.getUser()` dentro de `handleApiRoute` | Proxy libera `/api/` sem redirect HTML, mas a sessão é validada na rota antes de qualquer leitura de dados |
| `workspace_id` obrigatório em todas as queries (`.eq("workspace_id", workspaceId)`) | Isolamento multi-tenant desde o MVP; nenhuma query lê dados sem filtro de tenant |
| Tabela ausente retorna `200` com `data` vazio e `warnings` técnico | Pipeline não quebra se uma tabela de governance ainda não existir no Supabase |
| Warnings do envelope são técnicos do endpoint (ex: tabela ausente) | Findings e warnings de governança ficam dentro de `data`, não no envelope |
| `parseApiFilters` sanitiza e valida todos os filtros de query string | Evita injeção de valores arbitrários nas queries Supabase |
| `looseJsonMatch` para filtros de environment/medium/campaign em JSONB | Campos JSONB não permitem `.eq()` simples; matching por serialização é suficiente para MVP |
| Sem SUPABASE_SERVICE_KEY em `frontend/src` | Service key é exclusiva do backend Python e GitHub Actions |

### 10.6 Status de Validação

| Critério | Status | Observação |
|---|---|---|
| `frontend/src/lib/api/route.ts` removido | ✅ | Arquivo acidental do Codex; removido na validação v1.2 |
| 8 endpoints existem e delegam para `handleApiRoute` | ✅ | Todos os routes confirmados |
| `handleApiRoute` valida sessão e retorna 401 JSON | ✅ | Sem redirect HTML nas rotas de API |
| Nenhuma service key em `frontend/src` | ✅ | Busca confirmada vazia |
| `workspace_id` obrigatório em todas as rotas | ✅ | `validateWorkspaceId` chamado em `handleApiRoute` |
| Envelope JSON estável | ✅ | `makeEnvelope` padronizado |
| `npm run build` passou | ✅ | 8 rotas dinâmicas confirmadas no build |
| `npm run lint` | ⚠️ Falhou por pendência pré-existente | Erro em `dashboard/page.tsx` (regra `react-hooks/static-components`, `NavBtn` declarado dentro do render) — fora do escopo da v1.2; não corrigido |
| Nenhuma UI, migration ou agente de IA criado | ✅ | Escopo respeitado |

### 10.7 Pendência Técnica Pré-Existente

`npm run lint` falha com erros em `frontend/src/app/dashboard/page.tsx`:
- Regra violada: `react-hooks/static-components`
- Causa: componente `NavBtn` declarado dentro da função de render (escopo de componente)
- Esta pendência existia antes da v1.2 e não foi introduzida por ela
- Correção planejada para uma task de limpeza futura, sem impacto no build ou funcionamento do dashboard

### 10.8 Próxima Etapa

**v1.3 — Frontend GA4 MVP:** exibir no dashboard os dados reais de GA4 e governança consumindo os endpoints criados na v1.2 — cards de GA4 First Light, eventos principais, funil semântico, sessões pagas e qualidade de tracking.

---

## 11. Atualização Histórica v3.3 — Growth Intelligence Frontend MVP v1.3

**Data:** Maio 2026  
**Objetivo:** Criar a aba "Growth Intelligence" no dashboard, consumindo os 7 endpoints v1.2 via HTTP `fetch()`, sem migrations, sem backend, sem agentes de IA.

### 11.1 Status da Entrega

| Item | Status | Observação |
|---|---|---|
| Nova aba "Growth Intelligence" no dashboard | ✅ Entregue | NavItem `"growth"` adicionado à union type |
| `GrowthIntelligenceView` criado | ✅ Entregue | `frontend/src/components/GrowthIntelligenceView.tsx` (~700 linhas) |
| 7 endpoints consumidos via `fetch()` | ✅ | Sem imports diretos de `lib/api/` |
| `Promise.allSettled` com isolamento por seção | ✅ | Falha de um endpoint não quebra os demais |
| Tratamento de 401 | ✅ | "Sessão expirada ou usuário não autenticado." |
| `review_required` visível com badge | ✅ | Badge violeta "Em revisão" nos findings |
| Ressalva em conversões candidatas | ✅ | GA4 First Light + Funil com disclaimer obrigatório |
| `npm run build` passou | ✅ | 8 rotas dinâmicas + 1 nova aba estática |
| `npm run lint` | ⚠️ Falhou por pendência pré-existente + 1 novo NavBtn | Ver §11.4 |

### 11.2 Arquivos Criados/Modificados

| Arquivo | Tipo | O que mudou |
|---|---|---|
| `frontend/src/components/GrowthIntelligenceView.tsx` | **Novo** | Componente completo da aba Growth Intelligence |
| `frontend/src/app/dashboard/page.tsx` | Modificado | `"growth"` no union type, import `Activity` + `GrowthIntelligenceView`, NavBtn no sidebar, entrada em `NAV_META`, renderização condicional |

### 11.3 Estrutura de `GrowthIntelligenceView`

| Seção | Tipo | Endpoint consumido |
|---|---|---|
| FilterBar (período 7/15/30d + ambiente) | Controlo | — |
| 6 Executive Cards (GA4 + Ads + Governance) | Cards | `/growth/overview` |
| GA4 First Light | Seção | `/growth/overview` |
| Semantic Funnel | Seção | `/growth/funnel` |
| Events + Landing Pages | Seção | `/growth/events` |
| Paid Sessions Quality | Seção | `/growth/paid-sessions` |
| Governance Summary | Seção | `/governance/summary` |
| Findings (tabela + accordion) | Seção | `/governance/findings` |
| Evidence (accordion fechado por defeito) | Seção | `/governance/evidence` |

**Padrão de fetch:**
```typescript
async function apiGet<T>(url: string): Promise<T> { ... }
// 7 chamadas paralelas com Promise.allSettled
// settle<T>(result): ApiState<T> — isolamento de falhas por seção
```

### 11.4 Lint — Pendências

| Regra | Ficheiro | Status | Causa |
|---|---|---|---|
| `react-hooks/static-components` | `dashboard/page.tsx` | ✅ Corrigido (task pós-v1.3) | `NavBtn` extraído para escopo de módulo com `active` e `onNavigate` como props explícitas. `npm run lint` agora retorna 0 erros. |
| `react-hooks/set-state-in-effect` | `GrowthIntelligenceView.tsx` | ✅ Corrigido | 7 chamadas `setState` síncronas dentro do effect removidas; estados já inicializam com `loading: true` via `useState(initState())`. |

### 11.5 Decisões Técnicas

| Decisão | Motivo |
|---|---|
| `fetch()` HTTP em vez de importar `lib/api/growth.ts` directamente | Componentes cliente não devem importar funções server-side que chamam `createClient()` do servidor |
| `Promise.allSettled` em vez de `Promise.all` | Garante que falha de um endpoint não impede outros de carregar |
| Cancellation flag `let cancelled = false` | Evita actualizações de estado após desmontagem do componente |
| Estados inicializam com `{ loading: true, data: null, error: null }` | Stale-while-revalidate: ao mudar filtros, dados anteriores ficam visíveis até nova resposta chegar (sem flash de loading) |
| `REVIEW_REQUIRED_CHECKS` como Set constante | Lista extensível de checks que exigem validação do cliente antes de classificar como conversão |
| Badge "Em revisão" violet em findings `review_required` | Visibilidade explícita de que o evento ainda não foi validado pelo cliente |
| Ressalva "depende de validação explícita do cliente" em conversões | Obrigação arquitetural — SynapseIQ não decide sozinho qual é a conversão definitiva da Woke |
| Evidence accordion fechado por defeito | Volume de evidências pode ser grande; evitar poluição visual no carregamento inicial |
| Máximo 50 itens de evidence exibidos | Protecção contra UI não-responsiva com grandes volumes de dados |
| Warnings do envelope recolhidos de todas as respostas | Banner único para avisos técnicos (ex: tabela ausente) em vez de exibi-los dentro de cada seção |

### 11.6 Limitações e Próximos Passos (v1.4)

- **Loading durante re-fetch não exibido:** ao mudar período/ambiente, os dados anteriores ficam visíveis até a nova resposta chegar (sem spinner de re-fetch). UX aceitável para MVP.
- **Gráficos de funil não implementados:** o funil mostra dados tabulares; gráfico visual (ex: Recharts) fica para v1.4.
- **Nenhum selector de workspace:** dashboard ainda é single-tenant (Woke People). Multi-workspace fica para versão futura.
- **NavBtn pendência de lint:** corrigida em task subsequente — `NavBtn` movido para escopo de módulo (`dashboard/page.tsx`); `npm run lint` agora retorna 0 erros + 10 warnings pré-existentes.
- **`npm run build` e `npm run lint`:** build ✅ limpo; lint ✅ 0 erros · 10 warnings pré-existentes em outros arquivos.

snapshot nos blocos GA4 First Light e Funil quando ambiente ≠ Todos, empty state específico por ambiente nos blocos Findings/Evidence/Paid Sessions.
- **Findings Semânticos retornava 0 linhas:** corrigido pela migration 007 (RLS + política SELECT pública). A UI de fallback via `data_quality_shadow` foi mantida como resiliência — se a migration ainda não tiver sido aplicada ao projeto remoto, a tela continua funcional com os dados de sombra.

---

## 12. Decisão de RLS — Tabelas semantic_governance_* (post-v1.3)

**Data:** Maio 2026  
**Objetivo:** Corrigir retorno de 0 linhas nas tabelas `semantic_governance_runs`, `_findings`, `_evidence`, causado por ausência de políticas de SELECT após habilitação de RLS.

### 12.1 Causa Raiz

Migration 006 criou as três tabelas sem:
1. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
2. `CREATE POLICY ... FOR SELECT ...`

As migrations anteriores (003, 004, 005) fazem ambos explicitamente. Quando o Supabase habilitou RLS no nível de projeto para as novas tabelas, nenhuma policy existia → PostgreSQL bloqueou todas as leituras para `anon` e `authenticated`, retornando 0 linhas mesmo com dados gravados.

### 12.2 Opções Avaliadas

| Opção | Descrição | Decisão |
|---|---|---|
| **A — SELECT público** | `TO public USING (true)` — consistente com 003/004/005 e com MVP | ✅ Escolhida |
| **B — SELECT authenticated** | `TO authenticated USING (true)` — mais segura, mas inconsistente com MVP atual | Descartada (MVP) |
| **C — Workspace-scoped** | `profiles.workspace_id = table.workspace_id` | Descartada (`profiles` tem 0 linhas) |

**Motivo da Opção A:** Todas as tabelas de dashboard atualmente usam `TO public USING (true)`. O MEMORIAL documenta isso como decisão consciente de MVP. `profiles` tem 0 linhas. Alterar apenas as tabelas de governance para `TO authenticated` seria inconsistente e criaria comportamento difícil de rastrear.

### 12.3 Arquivos Criados

| Arquivo | Tipo | O que faz |
|---|---|---|
| `supabase/migrations/007_semantic_governance_read_policies.sql` | **Nova migration** | `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY ... TO public USING (true)` para as 3 tabelas |
| `docs/sql/semantic_governance_rls_hardening_future.sql` | **Draft (NÃO aplicar)** | Política endurecida `TO authenticated` + workspace-scoped via `profiles`; caminho de upgrade quando auth estiver pronto |

### 12.4 Como Aplicar a Migration

```bash
# Via Supabase CLI
supabase db execute --file supabase/migrations/007_semantic_governance_read_policies.sql

# Via Supabase MCP (apply_migration tool)
# Via Supabase Studio > SQL Editor (colar conteúdo do arquivo)
```

**Importante:** a migration deve ser aplicada ao projeto remoto (`lasocsneburvtxqgqhie`) para que o frontend leia as governance tables. Após aplicação, a tela Findings Semânticos passará a exibir os dados reais de `semantic_governance_findings` em vez do fallback `data_quality_shadow`.

### 12.5 Como Testar Após Aplicar

Acessar diretamente os endpoints com o workspace UUID:

```
GET /api/workspaces/a082fe86-a65f-4c9b-9442-fe775f47e3fc/governance/runs
GET /api/workspaces/a082fe86-a65f-4c9b-9442-fe775f47e3fc/governance/findings
GET /api/workspaces/a082fe86-a65f-4c9b-9442-fe775f47e3fc/governance/evidence
```

Critério de sucesso: `data.runs`, `data.findings`, `data.evidence` com linhas reais em vez de arrays vazios.

### 12.6 Riscos de Segurança

| Risco | Nível | Mitigação |
|---|---|---|
| Dados de evidência técnica (JSONB) visíveis via anon key | Médio (MVP consciente) | Mesma exposição que `data_quality_report` já tem; dados não contêm PII nem credenciais |
| Escalada para produção sem auth | Médio | `workspace_id` nas queries reduz erro acidental, mas não é fronteira de segurança quando policies públicas estão ativas — qualquer portador da anon key lê todos os workspaces. Para multi-tenant real, será obrigatório auth + RLS workspace-scoped via `profiles` |
| Future: workspace B lê dados de workspace A | Não se aplica agora | Um único tenant (Woke). Multi-tenant exige Opção C — documentado em `semantic_governance_rls_hardening_future.sql` |

---

## 13. v1.3.1 — Semantic Model and Rule Registry

**Data:** Maio 2026  
**Objetivo:** Criar fundação preventiva de vocabulário e metadados semânticos antes de avançar para v1.4 e v1.5, evitando espalhamento semântico entre Python, SQL, YAML, frontend e agentes de IA.

### 13.1 Motivo da Etapa

Com v1.1–v1.3 concluídos, os mesmos conceitos (check, finding, evidence, conversão candidata, review_required) já aparecem em:
- Labels de código Python (`semantic_governance.py`, `data_quality.py`)
- Nomes de tabelas SQL e campos JSONB
- YAML de configuração de tenant (`woke_measurement_config.yml`)
- Constantes TypeScript (`FINDING_NAMES`, `REVIEW_REQUIRED_CHECKS` em `GrowthIntelligenceView.tsx`)
- Textos de UI (microcopy, disclaimers, badges)

Sem um modelo canônico, a v1.4 (insights no frontend) e a v1.5 (AI Growth Analyst Agent) introduziriam novos labels inconsistentes e lógica de apresentação divergente.

### 13.2 Risco Documentado

**Espalhamento semântico:** quando um mesmo conceito (ex: "conversão") é interpretado de forma diferente em camadas distintas do sistema — pipeline, banco, frontend, agente — sem fonte única de verdade. O risco aumenta a cada nova feature que introduz labels sem consultar o modelo central.

### 13.3 Arquivos Criados

| Arquivo | Tipo | O que contém |
|---|---|---|
| `docs/semantic_model.md` | **Novo** | Glossário canônico de 13 conceitos; regra central de separação de camadas; tratamento esperado por UI e agentes |
| `backend/governance/semantic_registry.yml` | **Novo** | Metadados de todos os 8 checks semânticos atuais (L–S): label, category, severity_default, source_platform, description, business_impact, recommended_action, ui_group, evidence_types, can_generate_insight, requires_client_validation |
| `backend/connectors/semantic_registry.py` | **Novo** | Loader Python com `load_semantic_registry()` e `get_check_metadata()`; sem imports de outros connectors; sem conexão externa; retorno seguro em qualquer erro |

### 13.4 Checks Registrados em semantic_registry.yml

| Check | ui_group | requires_client_validation | can_generate_insight |
|---|---|---|---|
| `ga4_ads_overlap_insufficient` | data_quality | false | true |
| `ga4_conversion_registry_mismatch` | conversion_quality | **true** | true |
| `ads_conversion_action_not_in_registry` | conversion_quality | **true** | true |
| `ads_conversion_action_semantic_review_required` | conversion_quality | **true** | true |
| `ga4_non_production_traffic_detected` | traffic_quality | false | false |
| `ga4_suspicious_event_names_detected` | data_quality | false | false |
| `paid_sessions_without_funnel_progress` | funnel_quality | false | true |
| `utm_campaign_empty_in_paid_urls` | attribution_quality | false | true |

### 13.5 Regra do Registry — Leitura Obrigatória Antes de Exibir

**Regra:** nenhum frontend, insight determinístico ou agente de IA deve criar `label`, `business_impact` ou `recommended_action` para um check sem consultar o `semantic_registry.yml`.

- Se o `check_name` existir no registry → usar os campos `label`, `description`, `business_impact` e `recommended_action` do registry como fonte canônica.
- Se o `check_name` **não** existir no registry → exibir fallback técnico com o nome técnico do check e marcar o item como `registry_missing` na UI. Nunca inventar label ou recomendação.

Esta regra aplica-se a:
- Componentes React que renderizam findings/insights (`FindingsSection`, `InsightsView`)
- Gerador de insights determinísticos (`insights.py`) quando adicionar novos tipos semânticos
- Qualquer agente de IA que gere recomendações a partir de findings

**Por que não inverter:** o registry é a fronteira entre o que o pipeline observou (finding) e o que o produto comunica (label + recomendação). Cruzar essa fronteira sem o registry quebra a rastreabilidade e introduz labels divergentes por versão ou por camada.

---

### 13.6 Sem Refatoração de Runtime

A v1.3.1 é exclusivamente documental e preparatória. Nenhum módulo do pipeline foi alterado. O `semantic_registry.py` existe mas não é importado por nenhum connector ainda — a integração ao runtime é trabalho da v1.4.

### 13.7 Próximas Etapas que Devem Usar Este Registry

- **Nenhum componente frontend deve duplicar metadados semânticos em constantes hardcoded.** Labels, estados de revisão e flags de insight devem ser resolvidos via `frontend/src/lib/semanticRegistry.ts` (espelho estático do YAML), única fonte canônica para o frontend.
- **Growth Intelligence (`GrowthIntelligenceView`) usa o registry** para labels de findings e para determinar quais checks requerem badge de revisão (`requiresClientValidation`). Qualquer novo check semântico adicionado ao YAML é automaticamente coberto pelo fallback `getCheckLabel()`.
- **Insights determinísticos futuros** só devem ser gerados para checks com `can_generate_insight: true` no registry. Nunca gerar insight para check ausente do registry.
- **Checks com `requires_client_validation: true`** devem sempre escalar para revisão humana antes de qualquer ação automatizada ou recomendação de agente.
- **v1.5 AI Growth Analyst Agent:** o agente só pode gerar recomendações para checks com `can_generate_insight: true`. Checks com `requires_client_validation: true` devem sempre escalar para revisão humana antes de qualquer ação.
- **Futuros checks (T, U, …):** devem ser adicionados ao `semantic_registry.yml` **e** ao espelho `semanticRegistry.ts` antes de serem implementados no pipeline.

---

## 14. v1.4.1 — Measurement Config Bridge

**Data:** Maio 2026  
**Objetivo:** Introduzir o espelho TypeScript da `conversion_registry` do YAML do tenant, eliminando a dependência do regex puro em `classifyFunnelStep()` para eventos com classificação canônica definida.

### 14.1 O que foi entregue

- `frontend/src/lib/measurementConfig.ts` — espelho estático da seção `conversion_registry` de `woke_measurement_config.yml`. Expõe `EVENT_FUNNEL_MAP` (4 entradas) e `getConfiguredFunnelStep()`.
- `frontend/src/lib/api/growth.ts` — `classifyFunnelStep()` atualizado: prioridade `isConversion` → lookup no mapa → fallback regex.

### 14.2 Dívida Técnica: Divergência entre `GA4_CONVERSION_EVENTS` e `canonical_events`

**Problema identificado:** As listas de eventos de conversão no backend são completamente diferentes e desconexas:

| Fonte | Eventos listados |
|---|---|
| `backend/connectors/sync_ga4.py` → `GA4_CONVERSION_EVENTS` | `generate_lead`, `app_criar_conta`, `mentor_signup_with_auto_signin`, `quero_ser_premium`, `sign_up`, `form_submit` |
| `woke_measurement_config.yml` → `canonical_events` | `Mentor_signup_success`, `USER_SIGNUP_MENTOR_WITH_AUTO_SIGNIN` |

As convenções de nomenclatura são incompatíveis (snake_case vs CamelCase/SCREAMING_SNAKE), os eventos não coincidem, e o **Check K** (`ga4_conversion_events_present`) usa `GA4_CONVERSION_EVENTS` como lista "esperada" — uma lista que não foi validada contra os eventos que realmente disparam no GA4 do cliente.

**Impacto:** O Check K pode reportar falsos negativos (eventos esperados ausentes) ou falsos positivos se a lista não refletir a implementação GA4 real do cliente. O `EVENT_FUNNEL_MAP` no frontend (`measurementConfig.ts`) deriva do YAML, não de `sync_ga4.py`, criando uma terceira fonte de verdade para eventos de conversão.

**Resolução pendente:** Requer confirmação do cliente sobre quais eventos realmente disparam no GA4. Uma vez confirmados, `GA4_CONVERSION_EVENTS` em `sync_ga4.py` deve ser alinhado com `canonical_events` no YAML (ou vice-versa), e o espelho `measurementConfig.ts` deve ser atualizado. Não alterar sem validação do cliente.

## v1.4.2 KPI Cache Daily Refresh

Em 2026-05-09, foi corrigida a defasagem da tabela `kpi_cache_daily`, usada pela Visão Geral do Dashboard Woke.

### Problema identificado

A tela Visão Geral exibia dados de ROAS e custo apenas até `2026-05-07`, enquanto as tabelas base de Google Ads já estavam atualizadas até `2026-05-09`.

Validação inicial:

- `kpi_cache_daily.max(date) = 2026-05-07`
- `campaign_summary.max(date_range_end) = 2026-05-09`
- `keyword_analysis.max(date_range_end) = 2026-05-09`

Os registros de `sync_runs` confirmavam execuções recentes com sucesso para:

- `google_ads / campaign_summary`
- `google_ads / keyword_analysis`

Mas não havia execução recente para:

- `google_ads / kpi_cache_daily`

### Causa

O pipeline de Google Ads atualizava `campaign_summary` e `keyword_analysis`, mas não recalculava `kpi_cache_daily`.

Como a Visão Geral depende de `kpi_cache_daily`, o gráfico de custo, conversões e ROAS ficava defasado mesmo com os dados base atualizados.

### Correção realizada

Foi adicionada a função `sync_kpi_cache_daily()` em `backend/connectors/sync_ads.py`.

A função consulta a tabela diária de Google Ads no BigQuery:

`p_ads_CampaignStats_6627867790`

E gera três métricas por dia:

- `total_cost`
- `conversions`
- `roas`

A atualização é feita via upsert em `public.kpi_cache_daily`, usando o conflito:

`workspace_id,date,metric_name,channel`

Também foi adicionado um bloco em `backend/connectors/a_data_sync.py` para executar `sync_kpi_cache_daily()` entre `sync_campaigns()` e `sync_keywords()`, com registro próprio em `sync_runs`:

- `source_platform = google_ads`
- `data_source = kpi_cache_daily`

### Validação

Dry-run executado com sucesso:

- Período: `2026-04-10..2026-05-09`
- 29 dias retornados do BigQuery
- 87 registros previstos
- 29 dias × 3 métricas

Execução real executada com sucesso:

- `sync_kpi_cache_daily` retornou 29 dias
- 87 registros foram upsertados
- `sync_runs` registrou `google_ads / kpi_cache_daily / success`
- `rows_loaded = 87`
- `error_message = null`

Validação final:

- `kpi_cache_daily.max(date) = 2026-05-08`
- `kpi_cache_daily.max(updated_at) = 2026-05-09 15:54 UTC`
- `campaign_summary.max(date_range_end) = 2026-05-09`
- `keyword_analysis.max(date_range_end) = 2026-05-09`

A data máxima de `kpi_cache_daily` ficou em `2026-05-08` porque a query usa `HAVING cost > 0`, excluindo dias sem custo.

### Observações

A execução real gerou duas entradas de `sync_runs` para `kpi_cache_daily`, ambas com sucesso e `rows_loaded = 87`. Como o upsert é idempotente, isso não gerou duplicidade em `kpi_cache_daily`.

O ROAS passou a ser calculado como:

`metrics_conversions_value / total_cost`

Isso reflete a configuração atual de valor de conversão no Google Ads. Caso o cliente espere ROAS financeiro, será necessário validar a qualidade do `metrics_conversions_value` como dívida futura de mensuração.

### Commit técnico

Implementação publicada na `main`:

`8d2bb25 feat: refresh kpi cache daily in google ads sync`


---

## v1.4.3 Scheduled Data Sync MVP

**Data:** Maio 2026

### Objetivo

Remover a dependência de execução local do pipeline `a_data_sync.py`, automatizando via GitHub Actions com trigger manual (dry-run seguro) e agendamento diário.

### O que foi entregue

Edição de `.github/workflows/sync_data.yml`:

- `schedule: cron: "0 9 * * *"` — execução diária às 06:00 BRT
- `workflow_dispatch` com input `dry_run` (boolean, default `true`) — permite teste seguro pelo GitHub UI sem risco de escrita em produção
- `concurrency: group: a-data-sync-woke, cancel-in-progress: false` — segundo trigger aguarda fila em vez de cancelar run em andamento
- Credenciais GCP via base64: secret armazena `base64(credentials.json)`, runner decodifica com `base64 --decode` — evita corrupção de JSON por caracteres especiais
- `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` — silencia warning de deprecação de Node.js 20

### Validação realizada

**Dry-run (GitHub Actions, `dry_run=true`):**

- `[a_data_sync] env=production dry_run=True period=2026-04-11..2026-05-10`
- `[sync_campaigns] --dry-run: would upsert 9 records`
- `[sync_kpi_cache_daily] --dry-run: 29 days × 3 metrics = 87 records would be upserted`
- `[sync_keywords] --dry-run: would upsert 129 records`
- `[data_quality] --dry-run: would insert 15 quality checks`
- `[semantic_governance] --dry-run: would write 8 findings`
- `[insights] --dry-run: would upsert 4 insights`

**Execução real (GitHub Actions, `dry_run=false`):**

`sync_runs` confirmou sucesso para os três data sources:

- `google_ads / campaign_summary / success / rows_loaded = 9`
- `google_ads / kpi_cache_daily / success / rows_loaded = 87`
- `google_ads / keyword_analysis / success / rows_loaded = 129`

Validação em Supabase:

- `campaign_summary.max(date_range_end) = 2026-05-10`
- `keyword_analysis.max(date_range_end) = 2026-05-10`
- `kpi_cache_daily.max(date) = 2026-05-09` — fica em 09/05 porque `HAVING cost > 0` exclui dias sem custo

### Comportamento do scheduled run

Quando disparado pelo `schedule`, `inputs.dry_run` não existe (inputs só estão disponíveis para `workflow_dispatch`). A condição `"${{ inputs.dry_run }}" = "true"` avalia como falso, então o cron executa sempre sem `--dry-run` — comportamento correto para produção.

### Pendência aberta

`GA4_DATASET` permanece `""` em CI. Para ativar GA4 + checks L–S + insights GA4 no pipeline agendado, confirmar que a service account tem acesso ao dataset `analytics_289891960` e atualizar o valor no workflow.

### Commit técnico

Implementação publicada na `main`:

`b8b30ca feat: add GitHub Actions workflow for manual data sync with dry-run`


---

## v1.4.4 Scheduled Sync Observability and Failure Diagnostics

**Data:** Maio 2026

### Objetivo

Substituir a página `/logs` (que exibia apenas dados mock) por um painel operacional real, conectado à tabela `sync_runs` do Supabase, com cards de resumo de saúde do pipeline e tabela de execuções recentes.

### O que foi entregue

**Novos arquivos:**

- `frontend/src/lib/api/sync_runs.ts` — tipo `SyncRun` alinhado ao schema da tabela, helpers `mapBadgeStatus()`, `latestPerExpectedSource()`, `computeHealth()`, `timeAgo()`, `formatDateShort()`, `runDuration()`
- `frontend/src/components/SyncRunsTable.tsx` — componente client com linhas expansíveis, empty state e mapeamento de status para `LogStatusBadge`
- `supabase/migrations/009_sync_runs_read_policy.sql` — migration RLS (ver abaixo)

**Arquivo modificado:**

- `frontend/src/app/logs/page.tsx` — reescrita completa:
  - `useEffect` com browser Supabase client (anon key) lendo últimos 50 registros de `sync_runs` ordenados por `started_at DESC`
  - 6 cards de resumo: Status geral, Última execução, Fontes sincronizadas, Linhas carregadas, Erros (7d), Frescor dos dados
  - Barra de data sources esperados (`campaign_summary`, `kpi_cache_daily`, `keyword_analysis`) com badge de status por fonte
  - Filtros: busca livre, status (all/success/error/running), data source
  - Loading skeleton animado
  - Banner de erro de fetch visível se a query falhar
  - `ExecutionLogTable` substituído por `SyncRunsTable`

### Cálculo de saúde (Status geral)

O card "Status geral" é calculado exclusivamente com base no **último registro de cada data source esperado**, não em qualquer sucesso histórico dentro dos últimos 50 registros:

- `healthy` — os 3 data sources (`campaign_summary`, `kpi_cache_daily`, `keyword_analysis`) têm `status = success` na última execução
- `warning` — pelo menos um data source esperado não tem registro ou está em estado não-success
- `error` — pelo menos um data source tem `status = error` na última execução
- `unknown` — nenhum registro encontrado para nenhum data source esperado

### Migration 009 — RLS sem policy retornava 0 linhas

**Diagnóstico:** a tabela `sync_runs` tinha RLS habilitado (`rls_enabled = true`) desde a migration `008_align_sync_runs_rls.sql`, mas **nenhuma policy de SELECT** havia sido criada. Com RLS ativo e sem policy, o role `anon` (usado pelo browser client com a anon key) recebia 0 linhas silenciosamente — sem erro, sem mensagem, apenas empty result.

**Decisão:**

- Não desabilitar RLS (`ALTER TABLE ... DISABLE ROW LEVEL SECURITY`)
- Não usar `TO anon USING (true)` isolado
- Criar policy pública escopada ao workspace Woke, mais restritiva do que as outras tabelas MVP (`003`/`004`/`005`/`007` usam `USING (true)` completamente aberto)

**Policy criada:**

```sql
CREATE POLICY "sync_runs_read_woke_workspace_mvp"
  ON public.sync_runs
  FOR SELECT
  TO public
  USING (workspace_id = 'a082fe86-a65f-4c9b-9442-fe775f47e3fc'::uuid);

GRANT SELECT ON public.sync_runs TO anon, authenticated;
```

**Limitação futura:** quando o auth multi-tenant estiver pronto, substituir por policy workspace-scoped via `profiles.workspace_id = sync_runs.workspace_id` e remover o UUID hardcoded.

### Validação executada

**RLS e dados (via Supabase MCP):**

Policy `sync_runs_read_woke_workspace_mvp` confirmada em `pg_policies`.

Última execução retornada (2026-05-10 13:51 UTC):

- `google_ads / campaign_summary / success / rows_loaded = 9`
- `google_ads / kpi_cache_daily / success / rows_loaded = 87`
- `google_ads / keyword_analysis / success / rows_loaded = 129`

**Build e lint:**

- `npm run build`: ✓ sem erros TypeScript, `/logs` gerado como static
- `npm run lint`: 0 errors, 9 warnings todos pré-existentes (nenhum nos arquivos novos)
- `grep SUPABASE_SERVICE_KEY frontend/src`: nenhum resultado
- `grep sb_secret frontend/src`: nenhum resultado

### Observações

A busca livre no toolbar filtra por `data_source`, `source_platform`, `status` e `error_message`. O filtro de "agentes" da versão mock foi substituído por filtro de `data_source`.

O campo `id` da tabela `sync_runs` é a chave de `key` nos rows do React — assume-se que é UUID único por execução.

### Commit técnico

Implementação publicada na `main` após confirmação:
