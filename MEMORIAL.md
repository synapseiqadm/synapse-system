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

### Multi-tenancy & Scalability (v1.x Core)

| Dimensão | Implementação |
|---|---|
| **Status** | Infraestrutura nativa via Row Level Security (RLS) no Supabase |
| **Isolamento** | Todos os motores (Sync, Anomaly Detection, Insights, Governance) são orientados a `workspace_id` — nenhuma query opera sem filtro de tenant |
| **Estratégia v1.x** | Multi-tenancy assistido: novos tenants são adicionados via configuração de backend/admin, sem interface de self-onboarding — mantém rigor de governança semântica sem complexidade prematura de UI |
| **Escala** | Adicionar um novo workspace requer: registro na tabela `workspaces`, YAML de measurement config, e configuração de variáveis de ambiente no pipeline — sem alteração de código |

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

`0ddd574 feat: add scheduled sync observability logs`


---

## v1.4.4.1 Navigation and Roadmap Preview Hygiene

**Data:** Maio 2026

### Objetivo

Melhorar clareza de navegação e evitar interpretação incorreta de funcionalidades ainda planejadas. Nenhum agente de IA foi implementado nesta fase.

### O que foi alterado

**`frontend/src/components/Sidebar.tsx`**

- Label `Log de Execução` renomeado para `Status do Sync`, refletindo o propósito operacional real da página `/logs`
- Badge numérico `3` em `Agentes de IA` substituído por `Preview`, indicando que a funcionalidade não está ativa em produção

**`frontend/src/app/dashboard/page.tsx`**

- Adicionado card de atalho `Sincronização dos dados` ao fim da visão Geral, com CTA `Ver logs` apontando para `/logs`
- Não duplica lógica de consulta a `sync_runs` — é apenas um link de navegação

**`frontend/src/components/AgentCard.tsx`**

- Novo status `"preview"` adicionado ao tipo `AgentStatus` e ao mapa `STATUS_CFG`
- Stats row (ações hoje, taxa de sucesso) e footer (modo auto/manual, última ação) são ocultados quando `status === "preview"`, evitando que cards demonstrativos pareçam agentes em execução real

**`frontend/src/app/agents/page.tsx`**

- `/agents` permanece disponível como preview estratégico para visualização da visão futura do produto
- Header ajustado: subtitle `LangChain · GPT-4o · BigQuery` removido; pill `Preview` adicionada
- Botão `Pausar todos` removido (não há agentes ativos para pausar)
- Summary bar com "Ações hoje", "Taxa de sucesso" e "Decisões pendentes" removida
- Disclaimer adicionado no topo: informa que os insights do dashboard são determinísticos e baseados em regras, e que nenhum agente autônomo está ativo em produção
- Todos os 3 agentes configurados com `status: "preview"`
- Label da seção alterado de `Agentes configurados` para `Agentes planejados`

### O que não foi alterado

Pipeline Python, GitHub Actions, Supabase, migrations, RLS, lógica de sync — sem modificações.

### Validações

- `npm run build`: ✓ 0 erros TypeScript, `/agents`, `/dashboard` e `/logs` como rotas static
- `npm run lint`: 0 errors, 9 warnings pré-existentes, nenhum nos arquivos alterados

### Commit técnico

`3fa012f chore: improve navigation and agents preview clarity`

---

## v1.6 — Semantic Funnel Intelligence

### Objetivo
Adicionar a primeira camada de interpretação semântica de growth ao dashboard, utilizando exclusivamente dados já existentes no ecossistema SynapseIQ sem introduzir IA generativa, embeddings ou novos pipelines complexos.

### Implementações

#### Semantic Funnel Intelligence
Criação da camada `computeFunnelIntelligence` para derivar sinais semânticos diretamente dos snapshots GA4 já sincronizados.

Métricas derivadas:
- taxa de intenção;
- taxa de conversão;
- intenção → conversão;
- maior queda do funil;
- cobertura semântica;
- share de eventos suspeitos.

#### Progressão de Funil
Novo bloco visual de progressão:
- Aquisição;
- Landing;
- Engajamento;
- Intenção;
- Conversão.

Com barras semânticas:
- eventos semanticamente válidos;
- eventos suspeitos detectados pelo governance.

#### Integração Governance → Growth
A camada de Semantic Governance passou a enriquecer o dashboard de Growth Intelligence.

Eventos suspeitos identificados:
- `Analytics`
- `LinkedIn`

passam agora a impactar:
- cobertura semântica;
- qualidade do engajamento;
- leitura executiva do funil.

#### Executive Intelligence
Os cards executivos do Growth Intelligence passaram a exibir:
- % de sessões com intenção;
- % de eventos suspeitos;
- contexto semântico resumido.

#### UX
A implementação manteve:
- visual enterprise;
- baixo ruído visual;
- dark mode;
- compatibilidade com a navegação unificada introduzida na v1.4.4.1c.

### Arquivos principais

Novo:
- `frontend/src/lib/funnel.ts`

Alterado:
- `frontend/src/components/GrowthIntelligenceView.tsx`

### Impacto arquitetural
Nenhuma alteração em:
- pipelines;
- GitHub Actions;
- cron;
- Supabase auth;
- RLS;
- migrations;
- backend governance.

Toda a inteligência da v1.6 é derivada em frontend via heurísticas determinísticas reutilizando datasets já existentes.

### Resultado
A plataforma passou a interpretar:
- progressão de funil;
- qualidade semântica do tracking;
- sinais de intenção;
- degradação de conversão;
- confiabilidade dos eventos.

A SynapseIQ deixa de atuar apenas como dashboard operacional e passa a se posicionar como uma plataforma de Growth Intelligence semântico.

### Commits técnicos

`822c821 feat: add semantic funnel intelligence layer (v1.6)`

---

## v1.6.1 — Insight Consolidation Engine

### Problema identificado

Após o enriquecimento semântico da v1.6, o dashboard passou a gerar múltiplos sinais por execução de sync. O resultado era:

- 85 registros em flat list operacional;
- múltiplos cards com título idêntico ("Keyword com custo e zero conversões");
- repetição multi-período do mesmo sinal (cada sync criava nova linha por período);
- coexistência de tipos semanticamente contraditórios (GA4 configurado / não configurado);
- ausência de hierarquia executiva — todos os itens nivelados em `medium`.

### Estratégia implementada

#### Deduplicação por `dedupe_key`

Frontend-only. Para cada `dedupe_key`, mantém apenas o registro mais recente (`date_range_start` mais alto). Em empate de período, prioriza status `reviewed` > `new` — preservando o trabalho já feito pelo analista. O histórico completo permanece intacto no banco.

#### Consolidação executiva por tipo

Group cards para os dois tipos de maior volume:

- `campaign_zero_conversions_with_cost`
- `keyword_zero_conversions_with_cost`

Cada group card exibe:

- headline executiva (ex: "6 campanhas consumiram verba sem registrar conversões");
- custo total agregado;
- quantidade de itens afetados;
- severidade dominante do grupo;
- drilldown expandível com scroll limitado (`max-h-96`), preservando `InsightCard` individual completo com todas as ações de status.

#### Mutual exclusion semântica

Implementação explícita via constante `MUTUALLY_EXCLUSIVE_TYPES`:

```typescript
const MUTUALLY_EXCLUSIVE_TYPES: string[][] = [
  [
    "ga4_not_configured",
    "ga4_configured_but_incomplete",
    "ga4_configured_but_no_conversion_events",
  ],
];
```

Garante que apenas o insight mais recente de cada grupo semanticamente exclusivo apareça na surface view.

#### InsightCard modo compacto

Adição de `compact?: boolean` ao `InsightCard` existente:

- padding reduzido;
- bloco de recomendação oculto;
- título em `text-xs`;
- ações de status preservadas.

Usado exclusivamente dentro do drilldown dos group cards.

### Resultado

Antes:
- 85 registros em flat list operacional.

Depois:
- ~8 itens executivos na surface view;
- ~22 sinais únicos deduplicados;
- 2 group cards com agregados executivos;
- 6 singles individuais;
- footer exibe: `N itens · M sinais únicos · K registros`.

### UX

- Dashboard mais calmo, priorizado e executivo;
- leitura de alto nível sem perda de granularidade operacional;
- drilldown compacto com scroll evita explosão vertical;
- experience próxima de Revenue Intelligence / Growth Operations enterprise.

### Arquivo alterado

- `frontend/src/components/InsightsView.tsx`

### Impacto arquitetural

Nenhuma alteração em backend, pipelines, cron, GitHub Actions, Supabase, RLS, auth ou migrations. Toda a consolidação é frontend-only com heurísticas determinísticas.

### Commits técnicos

`844060e feat: add insight consolidation engine (v1.6.1)`

---

## v1.7.1 — Executive Overview Layer

### Mudança estratégica

A v1.7.1 marca a **transição do SynapseIQ de dashboard métrico para dashboard operacional executivo**.

A tab "Geral" respondia, até então, à pergunta *quanto gastamos?* — exibindo 4 MetricCards (custo, cliques, conversões, ROAS) e um AreaChart de tendência a partir de `kpi_cache_daily`. Esse modelo priorizava o consumo analítico tático, não o julgamento executivo.

A partir da v1.7.1, a mesma posição de destaque responde à pergunta *qual é o estado da operação?* — com síntese determinística de cinco domínios.

### Problema identificado

- O dashboard abria em uma visão de Ads que duplicava o que a aba Campanhas já oferecia com mais detalhe.
- Não havia superfície que sintetizasse a saúde operacional em visão única.
- A inteligência gerada pela v1.7 (Decision Brief) existia apenas dentro de Insights — invisível para quem navegava pela visão geral.
- Executivos e gestores precisavam de contexto imediato, não de números brutos.

### Estratégia implementada

#### Remoção completa do GeralView

Eliminados de `dashboard/page.tsx`:
- Componentes: `GeralView`, `MetricCard`, `CustomTooltip`
- Interfaces: `KpiRow`, `ChartPoint`, `Summary`, `Period`
- Funções: `sinceDate`, `pivotToChart`, `buildSummary`
- Estado: `rows`, `loading`, `error`, `period`
- useEffect: query `kpi_cache_daily` com seletor de período
- Imports: Recharts completo, 6 ícones Lucide

#### Criação do ExecutiveBoardView

Novo componente `frontend/src/components/ExecutiveBoardView.tsx` com 5 seções:

**1. Executive Health Overview** — saúde global derivada de `computeHealth()` sobre `sync_runs`. Uma linha compacta com status agregado e indicadores por domínio.

**2. Top Priorities** — sinais `computeDecisionBrief(insights, ga4)` renderizados com border-l-2 por categoria (priority/risk/opportunity/tracking). Máximo de 3 exibidos; zero estado = mensagem de saúde confirmada.

**3. Operational Snapshot** — 3 células métricas compactas: sessões GA4, taxa de conversão, waste (custo sem conversão). Derivados de queries já existentes, sem novos endpoints.

**4. Domain Health** — 5 linhas de status por domínio com heurística determinística:
- **Funil**: `intent_rate > 20%` → saudável
- **Conversão**: waste < R$100 → saudável, 100–500 → atenção, > R$500 → risco
- **Tracking**: share de eventos suspeitos < 5% → saudável, 5–15% → atenção, > 15% → risco
- **Governança**: nenhum check failed/warning → saudável
- **Sincronização**: mapeado de `computeHealth()` (healthy/degraded/critical/unknown)

**5. Operational Timeline** — 3 eventos mais recentes da operação: último sync, último check de governança, insight mais recente. Usa `timeAgo()` para exibição relativa.

#### Reutilização de funções existentes

Nenhuma lógica foi duplicada. Todos os cálculos usam funções já testadas:
- `computeDecisionBrief()` — `@/lib/decision`
- `computeHealth()`, `latestPerExpectedSource()`, `timeAgo()` — `@/lib/api/sync_runs`
- `isSuspiciousEventName()` — `@/lib/funnel`

#### Queries frontend (5 em Promise.all)

Todas as tabelas já existiam e eram consultadas em outros componentes:
- `insight_feed` — insights com evidência
- `ga4_first_light_summary` — sessões e top events
- `data_quality_report` — checks de governança
- `sync_runs` — histórico de sincronização
- `kpi_cache_daily` — ROAS trend (nova query, tabela existente)

### Impacto arquitetural

**Nenhuma alteração em backend, pipelines, cron, GitHub Actions, Supabase, RLS, auth ou migrations.**

O `ExecutiveBoardView` é o núcleo estratégico da plataforma: a superfície que sintetiza toda a inteligência gerada pelas camadas anteriores (sync, quality, insights, decision) em um painel executivo unificado. É a manifestação visual da arquitetura warehouse-native.

### Arquivos alterados

- `frontend/src/app/dashboard/page.tsx` — 369 linhas alteradas (52 inserções, 326 remoções)
- `frontend/src/components/ExecutiveBoardView.tsx` — criado (482 linhas)

---

## v1.7.2 — Executive Density & Performance Pulse Refinement

### Problema identificado

O layout da v1.7.1, apesar de correto em conteúdo, era excessivamente vertical: 5 cards empilhados sem relação visual entre eles, nenhum contexto temporal de tendência e ausência de percepção de momentum econômico.

O executivo que abre o painel precisa, em uma tela, de três camadas simultâneas:
1. **Saúde global** — estou bem ou mal?
2. **O que precisa de atenção agora** — prioridades e pulso econômico
3. **Estado dos domínios e cronologia** — onde está o risco e quando aconteceu

### Estratégia implementada

#### Reorganização de densidade UX: 5 seções verticais → 3 linhas em grid

```
Linha 1  │ Health Strip (faixa única, horizontal)
─────────┼────────────────────────────────────────────────────────
Linha 2  │  Prioridades (3/5 colunas)  │  Performance Pulse (2/5)
─────────┼──────────────────────────────┼─────────────────────────
Linha 3  │  Domain Health (50%)         │  Timeline (50%)
```

A densidade foi atingida reduzindo padding interno (`py-1.5`, `text-[11px]`) e eliminando headers redundantes entre seções adjacentes.

#### Reintegração do contexto econômico: Performance Pulse

Introdução do **Performance Pulse** — painel compacto (col-span-2) com:

- **3 métricas inline**: Sessões, Taxa de Conversão, ROAS médio (30 dias)
- **Mini AreaChart** (altura 72px): tendência de ROAS dos últimos 30 dias via `kpi_cache_daily`, com gradiente indigo (`#6366f1`) e tooltip formatado `2.43x`
- **Footer contextual**: waste acumulado, tempo do último sync, share de tracking suspeito

O ROAS chart é deliberadamente secundário — sutil, sem eixos Y, sem grid, sem labels. Serve como sinal de tendência, não como ferramenta analítica. O papel analítico pertence às abas especializadas.

#### Preparação estrutural para timeline causal futura

A Timeline (linha 3, coluna direita) foi compactada e padronizada como **activity strip** com 3 eventos ordenados cronologicamente. A estrutura está preparada para receber, em versão futura, a correlação causal entre eventos operacionais e variações de performance — o que transformaria a timeline em ferramenta de root cause, não apenas de log.

### Resultado

| Dimensão | v1.7.1 | v1.7.2 |
|---|---|---|
| Layout | 5 cards verticais | 3 linhas em grid |
| Contexto econômico | Ausente | ROAS trend 30d |
| Percepção de momentum | Nenhuma | Performance Pulse |
| Densidade visual | Baixa | Alta (py-1.5, 11px) |
| Queries Supabase | 4 | 5 (+kpi_cache_daily ROAS) |
| Warnings lint | +0 vs. baseline | +0 vs. baseline |

### Arquivos alterados

- `frontend/src/components/ExecutiveBoardView.tsx` — reescrito (v1.7.1 → v1.7.2)

### Commits técnicos

`2cb2092 feat: add executive board dashboard (v1.7.1/v1.7.2)`

---

## v1.7.3 — Performance Pulse Enrichment

### Problema identificado

O bloco Performance Pulse da v1.7.2 cobria bem eficiência e tendência, mas deixava duas dimensões fundamentais sem representação explícita:

- **Escala** — havia sessões, mas como único proxy de volume; investimento ausente.
- **Investimento** — o custo total do período não aparecia, tornando ROAS e Conversão descontextualizados. Um executivo não pode avaliar eficiência sem saber a base de investimento.

O grid de 3 métricas em linha (`Sessões | Conversão | ROAS`) comunicava eficiência mas não a equação completa `volume × investimento × eficiência`.

### Estratégia implementada

#### Expansão para 4 métricas em grade 2×2

Substituição do `grid-cols-3` (3 colunas em linha) por `grid-cols-2` (2×2):

```
Sessões       Investimento
Conversão     ROAS
```

Mapeamento de dimensões:
| Posição | Métrica | Dimensão |
|---|---|---|
| Linha 1, Col 1 | Sessões | Escala operacional |
| Linha 1, Col 2 | Investimento | Contexto econômico |
| Linha 2, Col 1 | Conversão | Eficiência de funil |
| Linha 2, Col 2 | ROAS | Eficiência de retorno |

#### Integração de spend via kpi_cache_daily

A query existente de `kpi_cache_daily` foi expandida de filtro único (`.eq("metric_name", "roas")`) para filtro múltiplo (`.in("metric_name", ["roas", "total_cost"])`). Uma única query retorna ambas as métricas por data.

Formato de exibição: `fmtBRLCompact()` — produz `R$ 12,4k` para valores ≥ 1.000, `R$ 830` abaixo disso. Compacto o suficiente para a densidade do bloco executivo.

O `totalSpend` é a soma de `total_cost` nos últimos 30 dias — a mesma janela temporal do ROAS trend. Isso garante que investimento e eficiência sejam sempre comparáveis no mesmo período.

#### Preparação estrutural para overlays históricos

O tipo `ChartPoint` foi estendido com o campo `spend`:

```typescript
interface ChartPoint { date: string; roas: number; spend: number; }
```

E `pivotChart()` agora mapeia `total_cost` → `spend` por data, de forma que o dado já esteja disponível no chart data para futuras overlays sem necessidade de nova query ou refactor.

Essa decisão antecipa:
- v1.7.4: trend delta e interpretação de momentum
- v1.8: comparações históricas período a período
- v1.9: anotações causais sobre o chart

#### Normalização decimal ROAS

O formato `2.43x` (separador inglês) foi corrigido para `2,43x` (pt-BR), alinhando ROAS com `fmtPct()` e `fmtBRLCompact()` — consistência visual no bloco de métricas.

### Observação arquitetural

O chart de ROAS (AreaChart, 72px) atua nesta versão como **momentum decoration** — transmite sensação de tendência, mas não oferece interpretação operacional. O leitor vê se a linha sobe ou desce, mas não sabe:

- se a variação é significativa;
- qual foi o delta período a período;
- se há anomalia ou ponto de inflexão.

Essa limitação é consciente e não bloqueante para v1.7.3. A evolução está planejada para:

**v1.7.4 — Operational Momentum Visualization**: transformar o chart de elemento visual decorativo para visualização interpretável de momentum operacional, com trend delta, contextual labels e preparação para anotações causais futuras.

### Resultado

| Dimensão | v1.7.2 | v1.7.3 |
|---|---|---|
| Métricas no Pulse | 3 (linha) | 4 (2×2 grid) |
| Investimento | ausente | R$ total 30d |
| Escala de sessões | presente | presente |
| Decimal ROAS | 2.43x | 2,43x |
| ChartPoint.spend | ausente | presente (prep estrutural) |
| Queries Supabase | 5 | 5 (query expandida, não nova) |
| Warnings lint | 10 | 10 (net zero) |

### Arquivo alterado

- `frontend/src/components/ExecutiveBoardView.tsx`

### Commits técnicos

`a68260f feat: enrich performance pulse metrics (v1.7.3)`

---

## v1.7.4 — Operational Momentum Visualization

### Problema identificado

O AreaChart de ROAS introduzido na v1.7.2 atuava como *momentum decoration*: transmitia sensação de tendência, mas não oferecia interpretação operacional. O usuário via a linha subir ou descer sem saber se a variação era significativa, se havia anomalia, ou qual era o delta em relação ao período anterior.

### Objetivo

Transformar o chart de elemento visual decorativo em ferramenta de suporte à decisão — mantendo o caráter compacto (72px, secundário, elegante) e sem introduzir complexidade de UI desnecessária.

### Estratégia implementada

#### Extração do sub-componente `MomentumChart`

O AreaChart inline (≈45 linhas de JSX) foi extraído para o sub-componente `MomentumChart`, com interface própria:

```typescript
interface MomentumChartProps {
  data: ChartPoint[];
  trendDelta: number;
  isAnomaly: boolean;
  contextualLabels?: Array<{ pointIndex: number; label: string }>; // v1.7.5+
}
```

A extração segue o princípio de "estrutura modular, evitar lógica acoplada" declarado no roadmap. `contextualLabels` está tipado como campo opcional para preparar a anotação causal da v1.7.5 sem nenhum acoplamento prematuro.

#### Cálculo de `trendDelta` — 7d vs 7d anterior

```typescript
const last7   = valid.slice(-7);
const prev7   = valid.slice(-14, -7);
const avgLast = last7.reduce((s, d) => s + d.roas, 0) / last7.length;
const avgPrev = prev7.reduce((s, d) => s + d.roas, 0) / prev7.length;
const delta   = avgPrev > 0 ? ((avgLast - avgPrev) / avgPrev) * 100 : 0;
```

Computed via `useMemo` sobre `chartData` já em memória — zero queries adicionais, zero backend changes. Guard: requer ≥ 8 pontos com ROAS > 0; abaixo disso, retorna `trendDelta = 0`.

#### Detecção de anomalia — desvio > 30% da média 30d

```typescript
const avg30    = valid.reduce((s, d) => s + d.roas, 0) / valid.length;
const lastRoas = valid[valid.length - 1].roas;
const anomaly  = avg30 > 0 && Math.abs(lastRoas - avg30) / avg30 > 0.30;
```

Threshold de 30% determinístico, sem dependência de dados externos. Suficiente para detecção de outliers grosseiros; refinamento estatístico (z-score) planejado para v1.9.

#### UI — Feedback visual dinâmico

| Sinal | `trendDelta >= 0` | `trendDelta < 0` |
|---|---|---|
| Stroke | emerald-500 (`#10b981`) | red-500 (`#ef4444`) |
| Gradiente | emerald, opacidade 13% | red, opacidade 13% |
| activeDot | emerald | red |

**Delta badge persistente** no header do Pulse: `Δ +15,4%` em verde/vermelho — visível sem hover, comunica momentum instantaneamente.

**Tooltip evoluído**: `ROAS: 2,43x  ·  Δ +15,4%` — valor pontual + contexto de período na mesma linha.

**`ReferenceDot`** (Recharts) no último ponto quando `isAnomaly = true`: raio 4, stroke escuro `#18181b`, colorido conforme tendência.

### Estabilização de build blockers

Arquivos em progresso criados externamente (`frontend/src/lib/api/route.ts`, `frontend/src/lib/api/timeline.ts`) estavam bloqueando o build com:

1. Import inválido de módulo Python (`@/backend/connectors/timeline_engine`)
2. Cast incorreto `ApiQueryFilters as Record<string, string>`
3. Uso de `any` explícito em `timeline.ts`

Correções aplicadas:
- `route.ts`: removido import Python, handler substituído por stub `{events: []}` compilável
- `timeline.ts`: cast via `unknown` intermediário; `Record<string, any>` → `Record<string, unknown>`
- Sem alteração de intenção ou lógica dos arquivos

### Resultado

| Dimensão | v1.7.3 | v1.7.4 |
|---|---|---|
| Chart | Decorativo (linha roxa estática) | Interpretativo (cor dinâmica + delta + anomalia) |
| `trendDelta` | Ausente | `useMemo`, 7d vs 7d anterior |
| `isAnomaly` | Ausente | Desvio > 30% da média 30d |
| Delta visível sem hover | Não | Sim (badge no header) |
| Cor dinâmica | Não | Sim (emerald / red) |
| Modularidade | AreaChart inline | Sub-componente `MomentumChart` |
| Warnings lint | 10 | 10 (net zero) |

### Arquivos alterados

- `frontend/src/components/ExecutiveBoardView.tsx` — principal (v1.7.4)
- `frontend/src/lib/api/route.ts` — stub corrigido (build blocker)
- `frontend/src/lib/api/timeline.ts` — tipos corrigidos (build blocker)

### Commits técnicos

`29b3bb0 feat: add operational momentum visualization (v1.7.4)`
`de9019a feat: add cost line, timeline markers and period selector to pulse`

---

## v1.7.4b — Pulse Enrichment: Cost Line, Timeline Markers, Period Selector

### Contexto

Extensões incrementais ao `MomentumChart` introduzido na v1.7.4, implementadas na mesma sessão após validação visual do dashboard em produção local.

### 1. Linha de custo (spend)

O `ChartPoint.spend` já existia desde a v1.7.3 mas não era visualizado. Adicionado como `<Line>` secundário com eixo Y independente:

- **Dual YAxis ocultos**: `yAxisId="roas"` (esquerdo) e `yAxisId="spend"` (direito), ambos `hide`. As duas séries usam 100% da altura de 72px sem conflito de escala.
- **Estilo**: zinc-600 `#52525b`, `strokeWidth={1}`, sem fill — hierarquia visual clara (custo = contexto, ROAS = sinal primário).
- **Tooltip**: formatter por `name` mostra ROAS com delta e Custo em BRL compact na mesma interação.

### 2. Marcadores de timeline operacional

Linhas verticais tracejadas no chart correlacionando eventos da Timeline Operacional com a curva de ROAS:

| Tipo | Cor | Letra | Fonte do timestamp |
|---|---|---|---|
| Sync | zinc-600 `#52525b` | S | `syncRuns[0].finished_at` |
| Governance | amber-700 `#b45309` | G | `dqChecks[0].checked_at` |
| Insight | indigo-500 `#6366f1` | I | `insights[0].date_range_start` |

Regras: só renderiza se a data existir em `periodData` (dias com custo > 0). Datas duplicadas são deduplicadas por `seen: Set<string>` — nunca sobrepõe duas linhas no mesmo dia.

### 3. Seletor de período (7d / 15d / 30d)

Três botões compactos no header do Pulse substituem o label estático `"últimos 30d"`. Implementação puramente client-side — zero nova query Supabase:

```typescript
const periodData = useMemo(() => chartData.slice(-selectedPeriod), [chartData, selectedPeriod]);
```

Todos os valores derivados do Pulse reagem ao período selecionado:

| Derivado | Comportamento por período |
|---|---|
| `periodData` | `chartData.slice(-N)` |
| `avgRoas` | média ROAS do período |
| `totalSpend` | soma custo do período |
| `trendDelta` | `Math.floor(valid.length / 2)` como janela dinâmica |
| `isAnomaly` | desvio do último ponto vs média do período |
| `chartMarkers` | filtra por datas dentro de `periodData` |

Janela de comparação do `trendDelta` é proporcional ao período: 7d → 3d vs 3d; 15d → 7d vs 7d; 30d → 15d vs 15d.

---

## v1.7.4c — Executive Insight Card: AI Narrative UI ✅ CONCLUÍDA

**Data de conclusão:** 2026-05-12  
**Commit:** `3cfc82c` — `feat(ui): materialization of Executive Insight card and high-res metrics grid`  
**Status:** Card de diagnóstico IA renderizado no Painel Executivo com mock v1.9.2. Aguardando GEMINI_API_KEY para ativar dados live.

### Contexto

A v1.9.2 entregou o motor de diagnóstico (backend). A v1.7.4c materializa esse diagnóstico no dashboard executivo — primeiro componente de IA generativa visível ao usuário do SynapseIQ. A versão usa dados simulados validados pelo Arquiteto até que os syncs diários acumulem 7+ dias e a chave Gemini seja configurada.

### O que foi entregue

**Componente `AINarrativeCard.tsx`** (`frontend/src/components/`):
- Recebe `narrative?: NarrativeData` (prop opcional; sem prop usa `MOCK_NARRATIVE`)
- **Borda lateral dinâmica:** `border-l-red-500` se `priority_score >= 4`, `border-l-indigo-600/60` caso contrário
- **Badge "PREVIEW DE TESTE":** renderizado quando `is_simulated = true` (zinc-800, border zinc-700, text-[9px])
- **Priority dots:** 5 pontos (● preenchido / ○ vazio), cor variável por urgência (red/amber/indigo)
- **Seções:** Header (ícone + título + badge + dots) → Insight summary (text-sm, semibold) → Technical diagnosis (text-[11px], zinc-500) → Ação recomendada (fundo vermelho sutil se crítico)
- **Posição:** Topo do `ExecutiveBoardView` (Painel Executivo), acima da barra de Saúde Operacional

**Métricas de funil em `CampaignCard`** (`frontend/src/app/dashboard/page.tsx`):
- Adicionado bloco CTR + CPC entre "Conversões" e a barra de share-of-spend
- CTR: `(ctr * 100).toFixed(2)` em pt-BR — exibe "—" se `clicks = 0`
- CPC: `cost / clicks` formatado em BRL — exibe "—" se `clicks = 0`
- Layout: duas colunas compactas (text-[9px] labels, text-xs valores), separadas por `border-t border-zinc-800/30`
- Query Supabase atualizada: inclui `clicks, ctr, date_range_end`; deduplicação por `campaign_id` mantém apenas o snapshot mais recente por campanha

### Arquivos

| Arquivo | Tipo | Descrição |
|---|---|---|
| `frontend/src/components/AINarrativeCard.tsx` | Novo componente | Card Executive Insight — mock + live-ready |
| `frontend/src/components/ExecutiveBoardView.tsx` | Modificado | Import + render de `<AINarrativeCard />` no topo |
| `frontend/src/app/dashboard/page.tsx` | Modificado | CampaignRow+query+CampaignCard com CTR/CPC |

### Build

```
tsc --noEmit → 0 erros
npm run build → compilação limpa, 10 rotas
```

---

## v1.8 — Causal Intelligence Infrastructure ✅ CONCLUÍDA

**Data:** Maio 2026  
**Objetivo estratégico:** Estabelecer a infraestrutura de Observabilidade Operacional — camada que conecta eventos do pipeline (sincronizações, anomalias de KPI, correções de governança) a movimentos nos indicadores de performance, habilitando análise causal histórica.

### Impacto no produto

Antes da v1.8, o dashboard exibia *o que está acontecendo agora* mas não *por que mudou*. A v1.8 introduce o registro persistente de eventos causais e a sua correlação visual com a curva de ROAS — primeiro bloco da Causal Intelligence Engine.

| Capacidade | Antes | Depois |
|---|---|---|
| Registro de anomalias | Não existia | Detectado e persistido automaticamente pelo pipeline |
| Timeline de eventos | Hardcoded (sync, governance, insights) | Dinâmica — alimentada por `operational_events` |
| Correlação visual KPI × evento | Impossível | Marcadores `!` no Momentum Chart com tooltip contextual |
| Rastreabilidade causal | Zero | Cada evento tem `impact_scope` JSONB com valores antes/depois |

---

## v1.8.1 — Database Foundation: `operational_events`

### Migrations aplicadas

**010 — Tabela `operational_events`**

Registro canônico de eventos do domínio para análise causal. Schema:

| Coluna | Tipo | Descrição |
|---|---|---|
| `event_type` | TEXT | `anomaly` · `intervention` · `governance_fix` · `system_change` |
| `category` | TEXT | `kpi_anomaly` · `sync_success` · `sync_error` · `budget` · `naming` |
| `impact_scope` | JSONB | Payload heterogêneo: valores antes/depois, métricas afetadas, desvios |
| `actor` | TEXT | `system` (pipeline) ou e-mail do usuário (intervenção manual futura) |
| `evidence_id` | UUID | FK opcional para `semantic_governance_evidence` (cross-referência causal) |
| `occurred_at` | TIMESTAMPTZ | Momento do evento (distinto de `created_at` de inserção) |

Dois índices: `(workspace_id, occurred_at DESC)` para queries temporais e `GIN(impact_scope)` para filtros analíticos sobre o payload.

**011 — RLS Workspace-Scoped**

Mesmo padrão das migrations 008/009: RLS habilitado, policy `SELECT TO public USING(workspace_id = ...)`. Writes do backend via service-key bypassam RLS — sem policy de INSERT necessária.

### Arquivos criados

| Arquivo | Conteúdo |
|---|---|
| `supabase/migrations/010_operational_events.sql` | DDL da tabela + índices + comentário |
| `supabase/migrations/011_rls_operational_events.sql` | RLS + policy MVP + GRANT SELECT |

---

## v1.8.2 — Backend Stabilization & API Route

### Correção estrutural do pipeline (`a_data_sync.py`)

O bloco GA4 do pipeline tinha três erros de indentação que impediam execução correta em produção:

1. `resolve_obsolete_insights` indentado erroneamente como argumento de `record_operational_event` — Python interpretava como continuação de chamada.
2. `sys.exit(1)` fora do bloco `except` — executaria incondicionalmente após o bloco GA4, mesmo em caso de sucesso.
3. `n_ga4` referenciado antes de possível atribuição — `NameError` garantido quando `ga4_available == False`.

Correções aplicadas: indentação alinhada, `n_ga4 = 0` inicializado antes do bloco, `sys.exit(1)` devolvido ao `except`.

**Adicionado:** `record_operational_event(..., category="sync_success")` ao final de cada etapa bem-sucedida — campaigns, kpi_cache_daily e keywords. Antes existia apenas registro de falha.

### API Route: Timeline Endpoint

Criada rota Next.js em `frontend/src/app/api/workspaces/[workspace_id]/timeline/route.ts`, seguindo o padrão arquitetural das rotas existentes (`handleApiRoute` + `readRows` + `makeEnvelope`).

A rota consulta `operational_events` com filtros opcionais de data e limite, mapeando cada linha para o tipo `TimelineEvent` com severidade derivada da `category`.

Removidos dois artefatos incorretos:
- `frontend/src/lib/api/route.ts` — stub que não estava no diretório `app/api/` e nunca seria servido como endpoint Next.js.
- `backend/connectors/route.ts` — arquivo TypeScript depositado erroneamente na pasta de connectors Python.

### Novos módulos Python

| Módulo | Responsabilidade |
|---|---|
| `operational_events.py` | `record_operational_event()` — persiste eventos com suporte a `dry_run`; nunca lança exceção (falha silenciosa com log) |
| `timeline_engine.py` | `get_operational_timeline()`, `get_kpi_diff()`, `get_executive_momentum_data()` — consultas Supabase para a timeline e diff de KPI entre períodos |

---

## v1.8.3 — Causal Engine: ROAS Anomaly Detection

### Lógica de detecção

Função `detect_kpi_anomaly()` em `operational_events.py`. Executa automaticamente ao final de cada ciclo de sincronização de KPIs, antes do sync de keywords:

1. Consulta `kpi_cache_daily` para os últimos 30 dias de ROAS, ordenado cronologicamente.
2. Calcula a **média simples do período** (30d).
3. Verifica se o **valor mais recente** desvia mais de ±30% da média.
4. Se anomalia detectada: persiste em `operational_events` com `event_type="anomaly"`, `category="kpi_anomaly"` e `impact_scope` contendo `last_value`, `mean_value`, `deviation_pct`, `last_date` e parâmetros do detector.

**Threshold parametrizável:** `lookback_days=30`, `threshold=0.30` — valores padrão alinhados com a lógica do `MomentumChart` no frontend (ambos concordam na definição de anomalia).

**Comportamento de falha seguro:** erros de query ou conexão geram log `WARNING` e retorno silencioso — o detector nunca aborta o pipeline.

### Validação em campo

Na primeira execução após a migration 010, o detector registrou uma anomalia de **ROAS −100%** em relação à média de 30 dias — confirmando funcionamento completo do ciclo: BigQuery → `kpi_cache_daily` → detector Python → `operational_events` → API Route → Dashboard.

```
[detect_kpi_anomaly] Anomaly recorded: roas -100.0% vs 30d mean
```

---

## v1.8.4 — Frontend: Anomaly Markers & Contextual Tooltips

### Marcadores de anomalia no Momentum Chart

`MarkerType` estendido com `"anomaly"` — quarto tipo de marcador no `MomentumChart`, ao lado de Sync (`S`), Governance (`G`) e Insight (`I`):

| Tipo | Cor | Letra | Fonte |
|---|---|---|---|
| Anomaly | orange-500 `#f97316` | `!` | `operational_events WHERE category = 'kpi_anomaly'` |

O componente busca eventos de anomalia na inicialização (6ª query no `Promise.all` existente — sem fetch redundante). Cada evento é adicionado ao `chartMarkers` useMemo via `tryAdd(occurred_at, "anomaly")`, que valida se a data existe no período selecionado e deduplica por data.

### Tooltips contextuais no Timeline Panel

Cada anomalia aparece como row dinâmica na "Timeline Operacional" com hover tooltip que exibe, a partir do `impact_scope`:

- Desvio percentual com sinal (`+` / `−`) e cor semântica (vermelho/verde)
- Último valor observado vs. média do período de referência
- Janela de lookback usada pelo detector

Máximo 3 eventos exibidos (`.slice(0, 3)`) para não ocupar mais espaço do que os 3 rows fixos existentes (Sync, Governance, Insights). Badge de contagem total exibido no header quando `anomalyEvents.length > 0`.

### Checklist de Implantação

- [x] Badge posicionado no dia exato da anomalia (validado contra `periodDates`)
- [x] Tooltip formata `deviation_pct` com sinal, `last_value` e `mean_value` com 2 casas decimais
- [x] Múltiplos eventos no mesmo dia colapsam para um marcador `!` no chart; exibidos individualmente na lista do Timeline panel

### Arquivos alterados

| Arquivo | Alterações |
|---|---|
| `frontend/src/components/ExecutiveBoardView.tsx` | `MarkerType` + `AnomalyEvent` + `MARKER_STYLE.anomaly` + state + fetch + `chartMarkers` + Timeline rows |

---

## Log de Evolução — Intelligence Hub (v1.9.x)

> **Nota de alinhamento de nomenclatura (2026-05-12):** A fase v1.9 é o **Intelligence Hub** — camada de IA generativa do SynapseIQ. Inclui backend (motor Gemini, snapshot engine, pipeline de dados) e frontend (vitrine executiva). A task **v1.7.4c** — Executive Insight Card foi reclassificada como **UI Materialization for Intelligence Hub** e faz parte do escopo v1.9, não de uma evolução standalone de dashboard.

### v1.9.1 — Snapshot Engine: SQL Delta Logic ✅ CONCLUÍDA

**Data de conclusão:** 2026-05-12

Implementação do Snapshot Engine (SQL) para análise comparativa D-1 vs D-8 com lógica de threshold de 15%.

#### O que foi entregue

- Função PL/pgSQL `public.fn_campaign_snapshot_delta(target_workspace_id UUID)` — diagnóstico comparativo entre Ontem (D-1) e o mesmo dia da semana anterior (D-8)
- CTEs `period_a` / `period_b` com filtro de granularidade diária (`date_range_start = date_range_end`)
- Fórmula delta: `((value_now - value_then) / NULLIF(value_then, 0)) * 100` — protegida contra divisão por zero
- Métricas calculadas: `spend`, `conversions`, `cpa` (derivada: `cost / conversions`)
- Classificação de impacto: `CRITICAL` (desvio absoluto > 50%) | `SIGNIFICANT` (> 15%)
- Filtro final: retorna apenas variações com `ABS(delta) > 15%`
- `FULL OUTER JOIN` entre períodos para preservar campanhas presentes em apenas um dos períodos
- Exclusão automática de campanhas com `spend = 0` em ambos os períodos
- `GRANT EXECUTE TO anon, authenticated` — compatível com postura MVP (anon key no frontend)

#### Arquivo

| Arquivo | Tipo | Descrição |
|---|---|---|
| `docs/sql/fn_campaign_snapshot_delta.sql` | Rascunho SQL | Função delta — pronta para execução no Editor SQL do Supabase |

#### Observações técnicas registradas

- `clicks` e `cpc` excluídos: coluna `clicks` ausente em `campaign_summary`. Adicionável via `ALTER TABLE` sem breaking change quando o pipeline começar a ingerir dados de cliques por dia.
- Métricas com `value_then = 0` (linha de base zero) produzem delta `NULL` e são excluídas da saída — comportamento esperado e documentado.
- Função totalmente parametrizada por `workspace_id`; nenhum UUID está hardcoded na lógica.

### v1.9.2 — Narrative Generator: AI Diagnostic Layer ✅ CONCLUÍDA

**Data de conclusão:** 2026-05-12  
**Commit:** `ced01b7` — `feat(ai): high-resolution diagnostic engine with [PREVIEW] transparency flags`  
**Status:** IA integrada com suporte a funil completo (CTR/CPC) e sistema de segurança que diferencia dados reais de simulações de teste. Aguardando implementação de UI.

Camada de inteligência que traduz os deltas numéricos da v1.9.1 em narrativas diagnósticas acionáveis via Google Gemini 1.5. Refatorada em duas iterações: geração básica (spend/conversions/cpa) → alta resolução com padrões de funil completo (CTR/CPC).

#### O que foi entregue

- Módulo `backend/connectors/ai_narrative.py` — integração com a SDK `google-genai` (v2.0.1):
  - `SYSTEM_PROMPT` com **biblioteca de padrões causais de alta resolução**:
    - **HIGH-RESOLUTION** (quando CTR/CPC presentes): 6 padrões — fadiga criativa, inflação de leilão, quebra pós-clique, paradoxo de cliques baratos, ciclo virtuoso, queda de impressões
    - **BASELINE** (quando CTR/CPC ausentes): 7 padrões spend/conversions/cpa clássicos
    - Mandato explícito: `technical_diagnosis` DEVE citar CTR ou CPC quando presentes no input
  - `generate_narrative(snapshot_rows, workspace_name)` — chama `gemini-1.5-flash` com `response_mime_type="application/json"`, `temperature=0.2`, valida 4 campos obrigatórios, anexa `_meta`
  - Guard de `GEMINI_API_KEY` ausente com mensagem acionável
- Suite de testes `backend/tests/test_ai_narrative.py` (10 rows, HIGH-RESOLUTION):
  - Payload atualizado com CTR e CPC — padrão A: `CPA↑+CTR↓+CPC≈` (fadiga criativa), padrão B: `CPC↓+CTR↑+Conversions↑` (ciclo virtuoso)
  - `test_mock_pipeline` — valida que `technical_diagnosis` cita CTR (34.93% queda) e CPC (R$1.98→R$1.35)
  - `test_missing_api_key_raises`, `test_invalid_json_raises`, `test_missing_field_raises`, `test_live_api_call`
- `docs/sql/fn_campaign_snapshot_delta.sql` atualizado para v3 (rolling window + alias fix)

#### Resultado de execução (sandbox — mock mode)

```
4 passed, 1 skipped (live), 1 warning (SDK interno Python 3.14)
```

#### Arquivos

| Arquivo | Tipo | Descrição |
|---|---|---|
| `backend/connectors/ai_narrative.py` | Módulo Python | Integração Gemini + HIGH-RESOLUTION system prompt + transparency flags |
| `backend/tests/test_ai_narrative.py` | Teste Python | 10 rows com CTR/CPC, 4 mock + 1 live, validação de `is_simulated` |
| `docs/sql/fn_campaign_snapshot_delta.sql` | SQL doc | v3 rolling window, alias fix, 6 métricas |

#### Sistema de transparência (Preview vs Live)

- `generate_narrative(is_simulated=True)` — quando os dados são simulados/de teste:
  - `insight_summary` recebe prefixo `[PREVIEW DE TESTE]` automaticamente
  - Campo `is_simulated: true` no JSON de saída sinaliza a origem ao frontend
- Dados reais de produção (`is_simulated=False`, default): output sem prefixo, `is_simulated: false`
- O sistema de testes sempre chama com `is_simulated=True`; o frontend chama com `False` ao usar `fn_campaign_snapshot_delta`

#### Observações técnicas registradas

- `fn_campaign_snapshot_delta` retorna vazio até que existam 7+ dias de syncs diários acumulados (D-8 ainda sem dados). Comportamento esperado; a função produzirá resultados reais a partir de 2026-05-13.
- `GEMINI_API_KEY` não está no `.env` — live mode requer chave gratuita de `aistudio.google.com/app/apikey`.
- SDK `google.generativeai` (legado) deprecated; migração para `google.genai` já aplicada.
- `temperature=0.2` garante output consistente e factual; subir para 0.4 se narrativas soarem repetitivas.
- Evidência visual no frontend planejada para **v1.7.4**.

### v1.8.1/4 — Saneamento de Base: Schema & Snapshot Engine ✅ CONCLUÍDA

**Data de conclusão:** 2026-05-12

Saneamento de débito técnico de infraestrutura executado entre v1.9.2 e v1.9.3. Expande o schema e o motor de snapshot para suportar o funil completo (Clicks/CTR/CPC).

#### O que foi entregue

- Migration `012_campaign_summary_expand_metrics` aplicada ao Supabase (`lasocsneburvtxqgqhie`):
  - `clicks INTEGER DEFAULT 0`
  - `impressions INTEGER DEFAULT 0`
  - `ctr NUMERIC(8,6) DEFAULT 0` — fração (0.0123 = 1.23%); não-aditiva, sempre recomputar de clicks/impressions
  - `ad_quality_score NUMERIC(4,2)` — nullable; não disponível em PMax/Display
  - Índice parcial `idx_campaign_summary_clicks_nonzero` para queries de eficiência de cliques
- Função `fn_campaign_snapshot_delta` atualizada para v1.9.1-REV (6 métricas):
  - **Novas:** `clicks`, `cpc` (spend/clicks), `ctr` (recomputado de clicks_agg/impressions_agg × 100)
  - CTR recomputado dos agregados — nunca somado da coluna armazenada (não-aditivo)
  - `NULLIF` em todos os denominadores; rows sem baseline excluídas automaticamente
- Evento registrado em `operational_events`: `id: 30904cf5`, `event_type: operational`, `category: infrastructure`

#### Arquivos

| Arquivo | Tipo | Descrição |
|---|---|---|
| `supabase/migrations/012_campaign_summary_expand_metrics.sql` | Migration aplicada | Schema expansion campaign_summary |
| `docs/sql/fn_campaign_snapshot_delta.sql` | Função SQL (rascunho atualizado) | Snapshot Engine v1.9.1-REV |

#### Observações técnicas registradas

- `ad_quality_score` é métrica de keyword level no BigQuery Ads export padrão — não ingerida no pipeline de campanha. Campo existe no schema para uso futuro via query dedicada.
- `operational_events` já existia com schema mais rico (migrations 010 + 011) — nenhuma migration duplicada criada.
- Naming discrepancy documentada: spec referia `get_performance_snapshot`; nome real implantado é `fn_campaign_snapshot_delta`.

---

### v1.8.5 — Data Pipeline Update: Clicks & Impressions Sync ✅ CONCLUÍDA

**Data de conclusão:** 2026-05-12

Atualização do pipeline de ingestão para popular as colunas `clicks`, `impressions` e `ctr` no `campaign_summary` com dados reais do BigQuery.

#### O que foi entregue

- `backend/connectors/sync_ads.py` — função `sync_campaigns()` atualizada:
  - BigQuery QUERY: + `SUM(s.metrics_clicks) AS clicks`, `SUM(s.metrics_impressions) AS impressions`
  - Record builder: cast explícito `int(row.clicks)`, `int(row.impressions)`; CTR derivado com guard `impressions > 0`
  - Dry-run logging: imprime os 5 primeiros registros com clicks, impressions, CTR e cost para evidência
- Pipeline executado em modo produção — **9 campanhas com dados reais persistidos**

#### Prova de persistência (validação no banco)

```sql
SELECT COUNT(*), SUM(clicks), SUM(impressions), ROUND(AVG(ctr*100)::NUMERIC,2) AS avg_ctr_pct
FROM campaign_summary WHERE clicks > 0;
-- Resultado: 9 linhas | 2.877 clicks | 70.641 impressões | CTR médio 4,80%
```

#### Arquivos

| Arquivo | Tipo | Descrição |
|---|---|---|
| `backend/connectors/sync_ads.py` | Módulo Python | Pipeline de ingestão — sync_campaigns() atualizado |

#### Observações técnicas registradas

- `GROUP BY` não alterado — `metrics_clicks` e `metrics_impressions` são `SUM()`, sem impacto no agrupamento.
- `ad_quality_score` omitido do record builder — não disponível via `p_ads_CampaignStats_*`. Banco aceita `NULL` por design.
- Sync executado sobre o range `2026-04-13..2026-05-12` (30 dias) — dado histórico populado retroativamente.

---

## Próximos Passos — v1.9: Explainable AI / Insight Diffs

Com a infraestrutura causal estabelecida, a v1.9 focará em **tornar os insights explicáveis**: correlacionar automaticamente variações de KPI com eventos registrados em `operational_events`, gerar narrativas de causa-efeito e comparar o estado de insights entre períodos (Snapshot Diff Engine).

Capacidades previstas:

- **Insight Diff:** comparação do insight atual com o estado anterior (base em `get_previous_insight_state()` já implementada em `insights.py`).
- **Causal Narrative:** dada uma variação de ROAS, listar eventos operacionais contemporâneos como candidatos causais.
- **Anomaly Resolution:** marcar anomalias como `resolved` quando o KPI retorna ao intervalo normal, fechando o ciclo de observabilidade.
- **Actionable Reports & To-Do Engine:** gerar relatórios semanais (ou por período customizado) que traduzam anomalias e insights em listas de tarefas executáveis — com instruções claras para ação manual (ex: pausar campanha sem conversão, corrigir tag de evento) e ciclo de status `Identificado → Em Execução → Resolvido`. Serve como ponte entre a inteligência diagnóstica atual e futuras automações via agentes.

---

### v1.7.4c — UI Materialization for Intelligence Hub ✅ CONCLUÍDA

> Reclassificada como componente da fase v1.9 (Intelligence Hub). Ver entrada completa em `## v1.7.4c` neste documento.

**Commit:** `3cfc82c`  
**Status:** Card Executive Insight renderizado no Painel Executivo com mock v1.9.2. Aguardando `GEMINI_API_KEY` para ativar dados live.

---

### v1.9.5 — Official Intelligence Activation: GCP Migration ✅ CONCLUÍDA

**Data de conclusão:** 2026-05-12  
**Status:** `GEMINI_API_KEY` injetada no `backend/.env`. API Generative Language habilitada no GCP (`synapsesystem`, projeto `913273994755`). Bootstrap de testes corrigido (`load_dotenv` antes de `import ai_narrative`). Live test passou após migração de modelo em v1.9.6.

#### O que foi entregue

- `backend/.env`: `GEMINI_API_KEY` configurada (não rastreada pelo git, `.gitignore` dupla cobertura)
- GCP Console → `synapsesystem` → APIs & Services → Generative Language API habilitada
- `test_ai_narrative.py`: bootstrap corrigido — `load_dotenv(_ENV_PATH, override=False)` antes de `import ai_narrative` (GEMINI_API_KEY é capturada em module-level no import; sem dotenv antes, `os.getenv()` retornava `""` e o teste pulava)
- `test_live_api_call` agora detecta modo `LIVE` e executa chamada real ao Gemini

#### Arquivos

| Arquivo | Tipo | Descrição |
|---|---|---|
| `backend/.env` | Config (não versionado) | GEMINI_API_KEY injetada |
| `backend/tests/test_ai_narrative.py` | Teste Python | Bootstrap com `load_dotenv` antes de `import ai_narrative` |

---

### v1.9.6 — Model ID Alignment: gemini-2.5-flash ✅ CONCLUÍDA

**Data de conclusão:** 2026-05-12  
**Commit:** `ac77d69`

#### Objetivo

Resolver 404 `NOT_FOUND` para `gemini-1.5-flash` e `gemini-2.0-flash` (não disponíveis para novos projetos GCP na API v1beta). Migrar para `gemini-2.5-flash` e resolver truncamento de output.

#### O que foi entregue

- `GEMINI_MODEL`: `"gemini-1.5-flash"` → `"gemini-2.5-flash"` (confirmado via `client.models.list()` como disponível para o projeto)
- `max_output_tokens`: `512` → `2048` — 512 causava truncamento mid-UTF-8 nas respostas em português do gemini-2.5-flash (que usa mais tokens que o 1.5 para o mesmo conteúdo)
- Guard de 100 chars no `insight_summary`: se o modelo excede o limite, trunca no último espaço antes de 97 chars e adiciona `"..."` — contrato de UI preservado sem depender de compliance do modelo

#### Evidência de produção

```
[LIVE] model: gemini-2.5-flash  latency_ms: 6359  row_count: 10
insight_summary  : "O CPA da campanha 'Woke | Conscientização | Agosto' dobrou, indicando fadiga criativa e perda de..."
technical_diagnosis (EN): CPA +100.43% (R$44.55→R$89.29), CTR -34.93% (3.35%→2.18%), HIGH-RESOLUTION pattern CPA↑+CTR↓+CPC≈ → creative fatigue
priority_score: 5
```

**5/5 testes passaram** (live + 4 mock).

#### Arquivos

| Arquivo | Tipo | Descrição |
|---|---|---|
| `backend/connectors/ai_narrative.py` | Módulo Python | `GEMINI_MODEL=gemini-2.5-flash`, `max_output_tokens=2048`, guard 100-char summary |

#### Observações técnicas registradas

- `gemini-2.0-flash` (bare) e `gemini-1.5-flash` retornam 404 para novos projetos GCP na API `v1beta` — "no longer available to new users".
- `gemini-2.5-flash` disponível e estável; sem sufixo `-preview`. Alternativas confirmadas via `client.models.list()`: `gemini-2.5-pro`, `gemini-2.0-flash-001`, `gemini-2.0-flash-lite`.
- `temperature=0.2` mantida — garante output determinístico para diagnósticos factuais.
- `MOCK_NARRATIVE` no `AINarrativeCard.tsx` permanece ativo — API Route frontend ainda não implementada (próxima fase).

---

## Perspectivas Futuras — v2.x: Escala e Governança na Fonte

> **Nota de Gestão de Escopo:** Estes itens representam a visão de escala do produto e não devem interferir no ciclo de entrega da v1.9. O foco imediato permanece na camada de Explainable AI utilizando a infraestrutura de dados atual (BigQuery/Supabase).

As explorações abaixo são conceitos em estudo — sem data de entrega comprometida. Servem como orientação arquitetural para decisões de design na v1.9 que não devem fechar portas para esses caminhos futuros.

### Exploração 1 — GTM como Abstração Semântica

**Hipótese:** O Google Tag Manager pode atuar como tradutor de eventos canônicos na fonte — normalizando nomes de eventos antes de chegarem ao BigQuery — o que reduziria o tempo de onboarding de novos tenants e eliminaria a necessidade de mapeamento retroativo no pipeline Python.

**O que isso resolveria:**
- Eventos com nomes arbitrários (`app_criar_conta`, `mentor_signup_with_auto_signin`) seriam traduzidos para nomes canônicos do `semantic_registry.yml` antes da coleta
- A camada de governança semântica da v1.x migraria de corretiva (detecta problemas após ingestão) para preventiva (impede ingestão de dados não canônicos)
- Onboarding de novos tenants: configurar aliases no GTM em vez de editar YAML e reprocessar histórico

**Pré-requisitos para avaliação:**
- Acesso à API do GTM do cliente para leitura de contêineres e tags
- Definição de contrato de nomenclatura canônica estável (depende de v1.9 consolidar o `semantic_registry`)
- Validação com a Woke People de que o GTM está sob gestão controlada (não alterado ad-hoc)

---

### Exploração 2 — UI de Curadoria (Human-in-the-Loop)

**Hipótese:** Uma interface de validação humana de classificações de eventos — onde equipe SynapseIQ e cliente aprovam explicitamente quais eventos contam como KPI — transformaria os diagnósticos atuais em inferências robustas com rastreabilidade total.

**Workflow conceitual:**
```
Detecção (GTM/pipeline) → Proposição Semântica (Synapse) → Aprovação Humana → Inferência Histórica
```

**O que isso resolveria:**
- ROAS e conversões calculados exclusivamente sobre eventos com aprovação explícita do cliente
- Reprocessamento histórico automático após aprovação de nova classificação
- Eliminação de "lixo estatístico" filtrado na fonte, não após a análise

**Dependências críticas:**
- Auth multi-tenant real (pré-requisito para papéis de aprovação diferenciados por tenant)
- Infraestrutura de versionamento de classificações (`classification_version` em `kpi_cache_daily`)
- Exploração 1 (GTM) como camada de entrada do workflow

---

## Gestão de Riscos e Débitos Técnicos

Registro dos riscos identificados e débitos técnicos conscientes acumulados até a v1.8. Cada item possui owner implícito (sistema ou humano) e critério de resolução.

### Risco 1 — Refinamento de Anomalias (Prioridade: Alta)

**Descrição:** A lógica de detecção de anomalias de ROAS (`detect_kpi_anomaly`) usa um limiar fixo de ±30% sobre a média dos últimos 30 dias. Em períodos de baixo volume de spend (ex: campanhas pausadas, fim de mês com orçamento esgotado), pequenas variações absolutas de ROAS podem cruzar o limiar e gerar alertas falso-positivos.

**Impacto:** Erosão de confiança no sistema de alertas se anomalias sem significância operacional forem sinalizadas repetidamente.

**Mitigação planejada (v1.9):**
- Adicionar filtro de volume mínimo: só disparar anomalia se `spend` do período ≥ threshold configurável
- Considerar desvio padrão em vez de média fixa para contextos de alta sazonalidade
- Permitir configuração de `threshold` e `lookback_days` por workspace via tabela de configuração

---

### Risco 2 — Validação Multi-tenant (Prioridade: Alta)

**Descrição:** A arquitetura multi-tenant foi projetada com `workspace_id` como chave de isolamento, mas todo o pipeline atual opera exclusivamente sobre o workspace Woke People. Dependências implícitas (hardcoded UUIDs, `WOKE_WORKSPACE_ID` em `config.py`, políticas RLS com UUID literal) podem mascarar vazamentos de isolamento.

**Impacto:** Ao onboarding do segundo tenant, dados de workspaces distintos podem se misturar silenciosamente se algum query omitir o filtro de `workspace_id`.

**Mitigação planejada (pré-lançamento multi-tenant):**
- Criar "Tenant B" em ambiente de staging com dados sintéticos
- Executar pipeline completo com ambos os tenants ativos simultaneamente
- Auditar todas as queries Supabase em `backend/connectors/` para garantir presença explícita de `.eq("workspace_id", ...)`
- Migrar políticas RLS de UUID literal para função parametrizada (`current_setting('app.workspace_id')` ou equivalente)

---

### Débito 3 — Auth Integration (Marco Pré-requisito)

**Descrição:** O sistema opera em estado MVP sem autenticação real. O `workspace_id` da Woke People está hardcoded em `config.py` e exposto via variável de ambiente `WOKE_WORKSPACE_ID`. Não há papéis de usuário, sessões, ou auditoria de acesso.

**Impacto:**
- Bloqueia features colaborativas (aprovação humana de classificações, UI de curadoria)
- Impede rastreabilidade de `actor` em `operational_events` (hoje sempre `"system"`)
- Inviabiliza onboarding self-service de novos tenants

**Critério de resolução:** Integração do Supabase Auth com RLS por `auth.uid()` e mapeamento de usuários a workspaces via tabela `workspace_members`. Este marco é pré-requisito para as Explorações 1 e 2 da seção v2.x e para o ciclo de aprovação do Actionable Reports Engine (v1.9).

**Dependências:** Nenhuma decisão de schema deve fechar esta porta — `operational_events.actor` já é `TEXT` (extensível para UUID de usuário), `workspace_members` pode ser adicionada sem breaking changes.

---

## v2.0 — AI Narrative Integration: Connecting Brain to Body

**Data:** Maio 2026

### Objetivo

Conectar o módulo Python `ai_narrative.py` (Google Gemini 2.5 Flash) ao dashboard React, eliminando o estado de prop-drilling e criando um fluxo de ponta a ponta: Supabase → Gemini → Card executivo.

### Arquitetura

O SynapseIQ não usa FastAPI — todas as APIs são Next.js App Router Route Handlers. A integração foi implementada diretamente nesta camada, sem adicionar dependências Python ao frontend.

```
Supabase (fn_campaign_snapshot_delta)
    ↓
frontend/src/app/api/ai/narrative/route.ts  ← Route Handler (GET)
    ↓  Gemini REST API (fetch)
    ↓  https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
    ↓
AINarrativeCard.tsx  ← self-fetching client component
```

### Arquivos criados/modificados

| Arquivo | Tipo | O que mudou |
|---|---|---|
| `frontend/src/app/api/ai/narrative/route.ts` | **Novo** | Route Handler GET: busca snapshot delta no Supabase, chama Gemini REST, valida e devolve JSON |
| `frontend/src/components/AINarrativeCard.tsx` | **Refatorado** | Componente self-fetching com estados `loading / success / offline`; elimina props externas |
| `frontend/.env.local` | Modificado | `GEMINI_API_KEY` adicionado (server-only — sem prefixo `NEXT_PUBLIC_`) |

### Comportamento do componente (AINarrativeCard)

- **Estado `loading`:** `LoadingSkeleton` com spinner + skeleton animado + "Sincronizando com a Inteligência Synapse..."
- **Estado `success`:** card com `priority_score`, `insight_summary`, `technical_diagnosis`, `recommended_action`
  - `isAlert` (score ≥ 4): borda esquerda vermelha, ícone `AlertTriangle`, fundo `bg-red-950/[0.07]`
  - `isAlert` false: borda esquerda `indigo`
  - Badge `PREVIEW DE TESTE` visível apenas quando `is_simulated: true`
- **Estado `offline`:** `OfflineCard` com ícone `WifiOff` e "Inteligência temporariamente offline."
- Cancellation flag `let cancelled = false` no useEffect — evita setState após desmontagem

### Segurança

- `GEMINI_API_KEY` nunca exposto ao browser (sem `NEXT_PUBLIC_`)
- `backend/.env` protegido por `.gitignore` (2 entradas: linhas 5 e 54)
- `frontend/.env.local` gitignored por padrão
- Sem service key no frontend

### Notas técnicas — Gemini 2.5 Flash

- Modelo: `gemini-2.5-flash` (único disponível para novas contas GCP — `gemini-2.0-flash` retorna 404)
- `thinkingConfig: { thinkingBudget: 0 }` **obrigatório**: sem este flag, o modelo reserva >1500 tokens de thinking que competem com `maxOutputTokens`, causando truncação mid-JSON e `JSONDecodeError`
- `maxOutputTokens: 2048`, `temperature: 0.2`, `responseMimeType: "application/json"`
- Latência observada: ~2100ms com thinking desativado (era 6–10s com thinking ativo)

### Estado inicial (sem D-8)

`fn_campaign_snapshot_delta` retorna 0 rows nos primeiros 7 dias após onboarding (requer snapshot de D-8 disponível). O card exibia corretamente `priority_score: 1` ("sem anomalias") — comportamento esperado, não um bug.

---

## v2.0.1 — High-Resolution Reasoning: Impact & Priority

**Data:** Maio 2026

### Objetivo

Atualizar o modelo de raciocínio do Gemini para:
1. Classificar sinais em P1/P2/P3 com regras financeiras explícitas
2. Detectar desperdício de verba real mesmo sem dados de delta (via `campaign_summary`)
3. Garantir que R$669,92 em gasto sem conversão → `priority_score = 5` → card vermelho/crítico

### Problema que motivou a mudança

O SYSTEM_PROMPT anterior não tinha hierarquia de prioridade nem quantificação financeira. Com `fn_campaign_snapshot_delta` retornando 0 rows (D-8 ainda não disponível), o card sempre mostrava `priority_score: 1` mesmo com campanhas ativas gastando R$669,92 sem nenhuma conversão.

### Framework P1 / P2 / P3

| Nível | Nome | trigger | priority_score |
|---|---|---|---|
| **P1** | DRENO DE VERBA | spend > 0 com conversions = 0; CPA +50% CRITICAL | 4–5 |
| **P2** | OPORTUNIDADE ESTRATÉGICA | CPC↓ + CTR↑ + Conv↑ (ciclo virtuoso); funnel drop >40% | 3–4 |
| **P3** | GOVERNANÇA / QUALIDADE | qualidade de dados, UTM gaps, rastreamento suspeito | 1–2 |

**Hard rule:** total waste > R$500 → `priority_score` MUST be 5 (independente de outros sinais).

### Formato de mensagem — três seções

O `_build_user_message` (Python) e `buildUserMessage` (TypeScript) agora produzem:

```
SECTION 1 — CAMPAIGN PERFORMANCE (current 30-day period)
  campaign_name · spend (R$) · conversions · CPA (R$/conv) · ROAS
  [uma linha por campanha deduplciada, mais recente por campaign_name]

SECTION 2 — DETERMINISTIC SIGNALS (rule-based engine, always reliable)
  [CRITICAL] 5 campaign(s) with R$669.92 total spend and ZERO conversions: ...

SECTION 3 — DELTA ANALYSIS (D-1 vs D-8, |delta| > 15%)
  (empty — D-8 snapshot not yet available)
```

### Enriquecimento em route.ts

O Route Handler agora faz 2 queries em paralelo (`Promise.all`):

1. `fn_campaign_snapshot_delta` → Section 3 (0 rows até D-8 disponível)
2. `campaign_summary` → deduplica por `campaign_name` (mais recente por `date_range_end + loaded_at`) → Section 1

Deterministic signals (Section 2) são **derivados** dos dados de Section 1 no handler TypeScript:
- Filtra `cost > 0 AND conversions = 0`
- Soma o waste total
- Severity: `CRITICAL` se waste > R$500, senão `SIGNIFICANT`
- Nomeia cada campanha afetada com seu custo

### Dados reais — snapshot 2026-04-13 → 2026-05-12

| Campanha | Gasto | Conversões |
|---|---|---|
| Mudanca de Carreira | R$3,04 | 0 |
| [B2C][Topo][S][Teste Perfil Comportamental][Brasil] | R$96,26 | 0 |
| [P][B2B][CONVERSÃO][R&S][ATS][MAX CONV] | R$339,95 | 0 |
| [B2C][Topo][S][Frase][Teste de Perfil][Brasil] | R$170,52 | 0 |
| [YT][AWARENESS][CANAIS RECOLOCAÇÃO][CPM] | R$60,15 | 0 |
| **Total waste** | **R$669,92** | — |

R$669,92 > R$500 → HARD RULE ativa → `priority_score = 5` → card vermelho

### Arquivos modificados

| Arquivo | O que mudou |
|---|---|
| `backend/connectors/ai_narrative.py` | SYSTEM_PROMPT com P1/P2/P3; `_build_user_message` refatorado para 3 seções (parâmetros opcionais `campaign_rows`, `deterministic_signals`) |
| `frontend/src/app/api/ai/narrative/route.ts` | SYSTEM_PROMPT sincronizado; query paralela a `campaign_summary`; cálculo de zero-conversion waste; `buildUserMessage` com 3 seções; `_meta` enriquecido com `waste_campaigns` e `total_waste_brl` |

### Validação

```
5/5 testes backend passaram (test_ai_narrative.py):
  test_live_api_call   — PASSED  latency=2447ms
  test_mock_pipeline   — PASSED
  test_missing_api_key_raises — PASSED
  test_invalid_json_raises    — PASSED
  test_missing_field_raises   — PASSED

TypeScript: npx tsc --noEmit → 0 erros
```

Output live com SIMULATED_SNAPSHOT (10 delta rows, padrão HIGH-RESOLUTION):
```json
{
  "insight_summary": "CPA da campanha 'Woke | Conscientização | Agosto' dobrou, gerando R$ 626,46 em custo extra e...",
  "technical_diagnosis": "CPA increased 100.43% (R$44.55 → R$89.29)... CTR fell from 3.35% to 2.18%... 'Remarketing | Sempre Ativo' shows virtuous cycle...",
  "priority_score": 5
}
```

### Decisões técnicas

| Decisão | Motivo |
|---|---|
| Section 2 derivada no handler TypeScript, não consultando `insight_feed` | `insight_feed` estava vazio; o cálculo de waste é simples e determinístico — não justifica dependência de tabela adicional |
| Deduplicação de campanhas por `campaign_name` (mais recente) | Evita duplicatas de snapshots históricos sem query DISTINCT ON (incompatível com Supabase JS client) |
| `Promise.all` para snapshot + campaign_summary | Queries independentes — paralelismo reduz latência total do handler |
| `_meta` inclui `waste_campaigns` e `total_waste_brl` | Rastreabilidade: permite verificar quanto waste foi detectado e passado ao Gemini |
| `GEMINI_API_KEY` em `frontend/.env.local` sem `NEXT_PUBLIC_` | Chave nunca exposta ao bundle do browser; validada no topo do handler com return 503 se ausente |

---

## v2.1 — Auth Shield: Blindagem, Governança e RLS

**Data:** Maio 2026

### Objetivo

Transformar o SynapseIQ de dashboard MVP sem autenticação em plataforma multi-tenant segura, com sessão Supabase Auth real, RLS workspace-scoped enforçado por `auth.uid()`, governança de IA inviolável e UI de identidade do utilizador.

---

### 2.1.1 — Autenticação (Middleware)

O `frontend/src/proxy.ts` (Edge Middleware) já protegia `/dashboard` via `supabase.auth.getSession()` → redirect para `/login` quando sem sessão. Nenhuma alteração necessária — funcional desde v1.x.

---

### 2.1.2 — Workspace Dinâmico (Eliminar Hardcoded workspace_id)

**Problema:** `narrative/route.ts` usava `DEFAULT_WORKSPACE.id` (UUID hardcoded) para todas as queries Supabase, independente do utilizador autenticado.

**Solução:** Função `resolveWorkspace(supabase)` adicionada ao topo do route handler:

```typescript
async function resolveWorkspace(supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles").select("workspace_id").eq("id", user.id).single();
  if (!profile?.workspace_id) return null;
  const { data: ws } = await supabase
    .from("workspaces").select("name, slug").eq("id", profile.workspace_id).single();
  return {
    id:   profile.workspace_id,
    name: ws?.name ?? DEFAULT_WORKSPACE.name,
    slug: ws?.slug ?? DEFAULT_WORKSPACE.slug,
  };
}
```

- GET handler agora chama `resolveWorkspace()` → retorna HTTP 401 se `null`
- Todas as queries usam `workspace.id` / `workspace.name` da sessão
- `profiles` é a fonte de verdade: `profiles.id = auth.uid()` → `profiles.workspace_id`

---

### 2.1.3 — Populamento de `profiles` e correção de `workspaces`

Ações executadas via Supabase MCP (SQL direto — não em migration file pois são dados, não schema):

```sql
-- Corrigir nome do workspace (era "woke")
UPDATE workspaces SET name = 'Woke People' WHERE id = 'a082fe86-...';

-- Mapear utilizadores ao workspace Woke
INSERT INTO profiles (id, workspace_id, role, created_at)
VALUES
  ('487a1072-...', 'a082fe86-...', 'admin', now()),
  ('58980a4c-...', 'a082fe86-...', 'user',  now());
```

| Email | Auth UID | Role |
|---|---|---|
| `ervin.moriyama@gmail.com` | `487a1072-...` | admin |
| `tosi.gabriel@gmail.com` | `58980a4c-...` | user |

---

### 2.1.4 — RLS Hardening (Migration 013)

**Arquivo:** `supabase/migrations/013_rls_hardening.sql`

Substitui todas as políticas `TO public USING (true)` por políticas `TO authenticated` scoped ao workspace do utilizador via `profiles.workspace_id = auth.uid()`.

**Padrão aplicado (12 tabelas de dados):**

```sql
DROP POLICY IF EXISTS "<nome-antigo>" ON public.<tabela>;
CREATE POLICY "<tabela>_select_authenticated"
  ON public.<tabela>
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = (
      SELECT workspace_id FROM public.profiles WHERE id = auth.uid()
    )
  );
```

**Casos especiais:**

| Tabela | Particularidade |
|---|---|
| `semantic_governance_evidence` | Sem `workspace_id` direto — join via `semantic_governance_findings` |
| `insight_feed` | Adicionada também policy UPDATE (`insight_feed_update_authenticated`) para ações de status (Revisar/Resolver/Descartar) |
| `profiles` | Restrita ao próprio utilizador: `USING (id = auth.uid())` |
| `workspaces` | Política `"Allow authenticated read"` existente mantida (sem `workspace_id` — leitura livre para autenticados) |
| `kpi_cache_daily` | 3 policies conflituosas removidas → 1 policy limpa auth-scoped criada |

**Impacto no backend Python:** o pipeline usa `SUPABASE_SERVICE_KEY` que bypassa RLS inteiramente. Nenhuma alteração necessária no backend.

---

### 2.1.5 — Governança de IA (HARD CONSTRAINTS no SYSTEM_PROMPT)

Secção `## Governance & Compliance — HARD CONSTRAINTS` adicionada ao `SYSTEM_PROMPT` em **dois ficheiros** (Python e TypeScript — devem permanecer sincronizados):

- `backend/connectors/ai_narrative.py`
- `frontend/src/app/api/ai/narrative/route.ts`

Quatro constraints invioláveis:

| Constraint | Regra |
|---|---|
| **PROIBIDO — Budget** | Nunca recomendar aumento de spend além do período observado. Qualquer aumento DEVE conter "sujeito à aprovação do gestor" |
| **PROIBIDO — Execution** | IA não pode executar, pausar ou modificar campanhas diretamente. Output é advisory only. P1 MUST include "sujeito à aprovação do gestor" |
| **PROIBIDO — PII** | Processar apenas KPIs agregados. Dados pessoais no input são ignorados silenciosamente |
| **ISOLAMENTO — Stateless** | Cada chamada é completamente stateless. Nenhuma informação de chamadas anteriores ou outros workspaces |

---

### 2.1.6 — UI de Identidade (Dashboard)

**`frontend/src/app/dashboard/page.tsx`** — alterações em `DashSidebar`:

- `LogOut` adicionado aos imports de `lucide-react`
- Signature: `function DashSidebar({ active, onNavigate, userEmail })`
- Bottom da sidebar: badge de workspace substituído por email do utilizador + botão Sair:
  - Avatar circular com inicial do email (gradiente indigo-violet)
  - Email truncado (text-[10px], max-w truncado)
  - Botão "Sair" com `LogOut size={11}` — chama `supabase.auth.signOut()` + `window.location.href = "/login"`
- Header: workspace pill `Building2 + "Woke People"` + email do utilizador visível (font-mono, hidden sm:block)
- `DashboardPage`: `useEffect` busca `supabase.auth.getUser()` → popula `userEmail` state

**`frontend/src/app/login/page.tsx`** — limpeza de segurança:

- Removidos: `alert()` de debug e `console.error` com URL/key do Supabase no output
- Error handling simplificado: `setError(error.message)` apenas

---

### 2.1.7 — Estado pós-v2.1

| Dimensão | Antes (v2.0.1) | Depois (v2.1) |
|---|---|---|
| Auth no dashboard | Middleware protege rota, mas queries usam UUID hardcoded | Sessão real → workspace derivado de `profiles` |
| RLS | `TO public USING (true)` em 12 tabelas | `TO authenticated` scoped ao `profiles.workspace_id` |
| AI governance | Sem constraints explícitas no SYSTEM_PROMPT | 4 HARD CONSTRAINTS invioláveis |
| UI identidade | Sem email/logout | Email + avatar + botão Sair na sidebar |
| `profiles` | 0 linhas (bloqueava resolução de workspace) | 2 linhas — ervin + gabriel → workspace Woke |
| Debug leaks | `alert()` e `console.error` na `/login` | Removidos |

### Segurança pós-v2.1 — Verificações obrigatórias

```bash
grep SUPABASE_SERVICE_KEY frontend/src  # deve retornar 0 resultados
grep sb_secret frontend/src             # deve retornar 0 resultados
```

Ambas passam — service key exclusiva ao backend Python e GitHub Actions.

### Validação

Auth Shield validado com sucesso após login do Gestor. Sessão dinâmica funcional — workspace Woke People resolvido via `profiles` sem UUID hardcoded.

### Arquivos modificados

| Arquivo | Tipo | O que mudou |
|---|---|---|
| `frontend/src/app/api/ai/narrative/route.ts` | Modificado | `resolveWorkspace()` + queries via sessão + governance guards no SYSTEM_PROMPT |
| `backend/connectors/ai_narrative.py` | Modificado | Governance HARD CONSTRAINTS no SYSTEM_PROMPT; `_build_user_message` (já entregue em v2.0.1) |
| `frontend/src/app/dashboard/page.tsx` | Modificado | User email + logout em `DashSidebar`; email no header |
| `frontend/src/app/login/page.tsx` | Modificado | `alert()` e `console.error` removidos |
| `supabase/migrations/013_rls_hardening.sql` | **Novo** | RLS workspace-scoped para 12 tabelas de dados |

---

## v2.1.5 — AI Operations Layer: Ativa

**Data:** Maio 2026  
**Commit:** `1f07c39`  
**Status:** ✅ Validado e em produção

### Objetivo

Tirar a página `/agents` do estado estático de "Preview" e ligá-la ao fluxo real de dados do motor de diagnóstico — tornando o Centro de Operações a primeira superfície de decisão live do SynapseIQ.

### O que foi entregue

#### `/api/agents/decisions` (nova rota server-side)

Rota GET que resolve workspace da sessão (mesmo padrão de `resolveWorkspace()`) e faz duas queries em paralelo:

1. `campaign_summary` → detecta campanhas com `cost > 0 AND conversions = 0` (P1 — Dreno de Verba)
2. `operational_events WHERE category = 'kpi_anomaly'` → anomalias de KPI registadas pelo detector Python

Produz um array `Decision[]` com:

| Card | Tipo | Agente | Origem |
|---|---|---|---|
| Alerta de waste (ex: R$ 669,92) | `alert` | Anomaly Scout | `campaign_summary` determinístico |
| Sugestão de pausa (advisory only) | `suggestion` | Anomaly Scout | derivado do mesmo |
| Anomalia de ROAS | `alert` | Anomaly Scout | `operational_events.kpi_anomaly` |

Todos os cards incluem o campo `rationale` com o raciocínio matemático exposto (critério, threshold, classificação P1/P2).

**Governance guard preservado:** o card de sugestão de pausa inclui explicitamente "Sujeito à aprovação do gestor" no `body` e "PROIBIDO — Execução: advisory only" no `rationale`.

#### `agents/page.tsx`

- `DECISIONS` estáticos removidos
- `useEffect` fetcha `/api/agents/decisions` no mount com cancellation flag
- Loading spinner enquanto os dados chegam
- Header exibe contagem real de decisões pendentes (badge vermelho)
- Disclaimer actualizado: reflecte que as decisões são produzidas pelo motor real (determinístico + Gemini 2.5 Flash), não por agentes autónomos

#### `AgentDecisionFeed`

- Interface `Decision` expandida com `rationale?: string`
- Chip "Raciocínio" renderizado em cada card que inclua o campo — styled identicamente ao chip de SQL query existente

#### `AINarrativeCard`

- Link "Ver no Centro de Operações →" adicionado no rodapé do card (ícone `ExternalLink`, sempre visível no estado success)
- Implementado como `<Link href="/agents">` (Next.js client navigation)

#### `Sidebar`

- Badge "Preview" removido do item "Agentes de IA" — link activo, sem qualificação de roadmap
- Destructuring e renderização condicional do badge removidos do componente

### Arquitectura do fluxo

```
campaign_summary (Supabase)
    ↓ deterministic: cost > 0 AND conversions = 0
/api/agents/decisions (Route Handler)  ←  operational_events (kpi_anomaly)
    ↓ Decision[]
agents/page.tsx (useEffect fetch)
    ↓
AgentDecisionFeed → cards com rationale + approve/reject actions
```

### Decisões técnicas

| Decisão | Motivo |
|---|---|
| Waste derivado de `campaign_summary` (não de `insight_feed`) | `insight_feed` contém insights de múltiplos períodos; `campaign_summary` deduplicado dá o snapshot actual — mesma fonte usada no narrative route |
| Todos os cards atribuídos a `anomaly-scout` | É o único agente com identidade semântica coerente com detecção de anomalias e desperdício — Growth Master e Creative Critic ficam como roadmap |
| `rationale` como campo separado de `body` | `body` é o diagnóstico para o gestor; `rationale` é o raciocínio técnico para auditabilidade — separação de audiências |
| Link "Ver no Centro de Operações" sempre visível (não só em isAlert) | A página de agentes é o destino natural para qualquer diagnóstico, independentemente da urgência |
| Badge "Preview" removido sem criar badge alternativo | O produto está activo — qualificações de roadmap pertencem ao disclaimer interno da página, não à navegação global |

### Arquivos criados/modificados

| Arquivo | Tipo | O que mudou |
|---|---|---|
| `frontend/src/app/api/agents/decisions/route.ts` | **Novo** | Rota server-side com waste detection + KPI anomalies + rationale |
| `frontend/src/app/agents/page.tsx` | Modificado | Fetch live; loading state; pending count real; disclaimer actualizado |
| `frontend/src/components/AgentDecisionFeed.tsx` | Modificado | `rationale?: string` na interface + chip de renderização |
| `frontend/src/components/AINarrativeCard.tsx` | Modificado | Link "Ver no Centro de Operações" no rodapé |
| `frontend/src/components/Sidebar.tsx` | Modificado | Badge "Preview" removido; destructuring limpo |
