# SynapseIQ — Memorial Descritivo

**Versão:** 3.0  
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
│   └── connectors/
│       ├── a_data_sync.py       → Entry point (orquestra todos os módulos)
│       ├── config.py            → Configuração e fail-fast
│       ├── sync_runs.py         → Auditoria de execuções
│       ├── sync_ads.py          → BigQuery → Supabase (campaigns + keywords)
│       ├── data_quality.py      → A-Data: checks de qualidade dos dados
│       ├── insights.py          → A-Insights: geração determinística de insights
│       └── sync_woke.py         → DEPRECATED (mantido para referência)
│
├── supabase/migrations/
│   ├── 001_sync_runs.sql
│   ├── 002_metadata_and_constraints.sql
│   ├── 003_data_quality_report.sql
│   └── 004_insight_feed.sql
│
├── docs/sql/
│   └── insight_feed_rls_hardening_future.sql  → Draft (NÃO aplicar sem auth)
│
└── .github/workflows/
    └── sync_data.yml     → GitHub Actions (cron diário 06h BRT)
```

**Fluxo de dados:**
```
Google Ads
  → Airbyte Transfer
    → BigQuery (synapsesystem.raw_google_ads_woke)
      → a_data_sync.py
          ├── sync_ads.py      → campaign_summary / keyword_analysis
          ├── data_quality.py  → data_quality_report
          └── insights.py      → insight_feed
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

Client Component com navegação via sidebar. `NavItem` union: `"geral" | "campanhas" | "keywords" | "qualidade" | "insights" | "canais" | "configuracoes"`.

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
├── config.py         → Validação fail-fast; constantes de configuração
├── sync_runs.py      → Helpers de auditoria: start / finish_success / finish_error
├── sync_ads.py       → sync_campaigns() + sync_keywords() + ga4_real_data_available()
├── data_quality.py   → 6 checks A–F; escreve em data_quality_report
├── insights.py       → 4 geradores determinísticos; escreve em insight_feed
├── a_data_sync.py    → Entry point: orquestra tudo + auditoria + --dry-run
└── sync_woke.py      → DEPRECATED — mantido para referência histórica
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
- Expõe: `APP_ENV`, `ALLOW_MOCK_DATA`, `WOKE_WORKSPACE_ID`, `GCP_PROJECT_ID`, `BQ_LOCATION`, `GOOGLE_ADS_DATASET`, `GOOGLE_ADS_CUSTOMER_ID`, `GA4_DATASET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DATE_RANGE_START`, `DATE_RANGE_END`, `INSIGHT_MIN_CAMPAIGN_COST` (default 50), `INSIGHT_MIN_KEYWORD_COST` (default 20), `ENABLE_INSIGHTS` (default true)

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
Executa 6 checks de qualidade (A–F) e escreve resultados em `data_quality_report`:
- **A** — Cobertura de conversões (campanha com custo mas zero conversões)
- **B** — Dados recentes (última carga dentro de janela esperada)
- **C** — Integridade de workspace (registos sem `workspace_id`)
- **D** — ROAS anómalo (campanhas com ROAS > threshold suspeito)
- **E** — Keywords órfãs (keywords sem campanha associada)
- **F** — GA4 não configurado (dataset GA4 vazio ou ausente)

Estratégia de escrita: INSERT (não upsert) — cada execução cria novos registos com timestamp; o dashboard deduplica por `check_name` mantendo o mais recente.

#### `insights.py`
Gera 4 tipos de insights determinísticos (sem LLM) e faz upsert em `insight_feed`:
- **campaign_zero_conversions_with_cost** — campanhas com custo ≥ `INSIGHT_MIN_CAMPAIGN_COST` e zero conversões
- **keyword_zero_conversions_with_cost** — keywords com custo ≥ `INSIGHT_MIN_KEYWORD_COST` e zero conversões
- **data_quality_warning_context** — aviso contextual quando há checks em warning/failed
- **ga4_not_configured** — informativo quando `GA4_DATASET` está vazio

Bloqueio: se houver checks críticos em `data_quality_report`, o pipeline substitui todos os insights por um único `data_quality_blocker` e não executa os geradores de performance.

Estratégia de upsert: fetch-before-upsert — consulta `(dedupe_key → status)` antes de upsert para preservar status analista (`reviewed` / `dismissed` / `resolved`). Novos insights entram com `status='new'`.

`dedupe_key`: texto estável por insight. Para keywords usa `sha1[:16]` de `kw_zero_conv|campaign_id|keyword|match_type`.

#### `a_data_sync.py` (entry point)
```bash
# Validação sem escrita
.venv/Scripts/python.exe -m connectors.a_data_sync --dry-run

# Sync completo
.venv/Scripts/python.exe -m connectors.a_data_sync
```

O venv está na raiz do repositório (`D:\dev\synapse\.venv\`), não dentro de `backend/`.

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

### 5.2 Migrations aplicadas

| Ficheiro | O que faz |
|---|---|
| `001_sync_runs.sql` | Cria tabela `sync_runs` |
| `002_metadata_and_constraints.sql` | Adiciona colunas de metadata; altera tipos; cria UNIQUE constraints para upsert |
| `003_data_quality_report.sql` | Cria tabela `data_quality_report` com RLS pública |
| `004_insight_feed.sql` | Cria tabela `insight_feed` com RLS pública e UNIQUE de dedupe |

**Regra importante:** migrations aplicadas nunca devem ser modificadas — risco de checksum drift no Supabase CLI.

### 5.3 RLS — Estado atual e plano

Todas as tabelas de dados têm política pública de SELECT (`TO public USING (true)`) porque o dashboard usa a anon key sem autenticação de utilizador. `public.profiles` existe mas tem 0 linhas.

O ficheiro `docs/sql/insight_feed_rls_hardening_future.sql` documenta a política endurecida (workspace-scoped, `TO authenticated`) a aplicar quando:
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

- **Trigger:** `cron: "0 9 * * *"` (06:00 BRT) + `workflow_dispatch`
- **Runner:** `ubuntu-latest`
- **Comando:** `cd backend && python -m connectors.a_data_sync`
- **Secrets necessários:**

| Secret | Uso |
|---|---|
| `GOOGLE_CREDENTIALS_JSON` | Conteúdo JSON da service account GCP |
| `SUPABASE_URL` | URL do projecto Supabase |
| `SUPABASE_SERVICE_KEY` | Chave service (server-only) |

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
| `DATE_RANGE_DAYS` | `30` |

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
| Migrations aplicadas nunca são modificadas | Risco de checksum drift no Supabase CLI; comentários/anotações vão em documentação, não no SQL |
| Drafts de migration em `docs/sql/` não em `supabase/migrations/` | Evita aplicação acidental por CI/CD |
| `data_quality_report` usa INSERT, não upsert | Cada execução é um novo snapshot; dashboard deduplica por `check_name` mantendo mais recente |
| `insight_feed` usa fetch-before-upsert | Preserva status analista (`reviewed`/`dismissed`/`resolved`) entre reprocessamentos |
| `dedupe_key` como hash sha1[:16] para keywords | Keywords têm caracteres especiais; hash estável evita collisions e tamanho fixo |
| `workspace_id` centralizado em `src/lib/workspace.ts` | Era duplicado em 3 componentes; fonte única facilita troca de tenant e suporta override por env var |
| Tenant identificado em sidebar + header + views | Dashboard multi-tenant futuro — identificação visual desde o MVP evita ambiguidade nos dados |

---

## 8. Próximos Passos

### Pendentes desde v2.0
- [ ] Integração GA4 com `data_source: "ga4"` — `ga4_real_data_available()` já preparado em `sync_ads.py`
- [ ] Popular `kpi_cache_daily` via script de sync (alimenta a vista Geral do dashboard)
- [ ] Agentes de IA com LangChain (páginas `/agents` já scaffoldadas)
- [ ] Alertas automáticos por e-mail quando ROAS < threshold (tabela `sync_runs` disponível como gatilho)
- [ ] Remover código de debug (`alert` / `console.error`) da página `/login` após confirmar login em produção
- [ ] Remover `sync_woke.py` DEPRECATED após próximo ciclo de sync bem-sucedido

### Novos (v3.0)
- [ ] Adicionar `NEXT_PUBLIC_DEFAULT_WORKSPACE_*` às variáveis de ambiente no Vercel
- [ ] Implementar autenticação no dashboard (pré-requisito para RLS endurecida)
- [ ] Aplicar `docs/sql/insight_feed_rls_hardening_future.sql` quando auth estiver pronto
- [ ] Aplicar mesma política endurecida a `campaign_summary`, `keyword_analysis`, `data_quality_report`, `kpi_cache_daily`
- [ ] Multi-workspace: selector de workspace na sidebar (base estrutural já presente em `WorkspaceSelector.tsx`)
- [ ] Expandir A-Insights: novos tipos de insight (ROAS anómalo, budget quase esgotado, tendência de queda)
- [ ] Dashboard de insights com histórico temporal (gráfico de insights por semana)

### Concluídos em v3.0
- [x] A-Data Quality: pipeline de checks + `DataQualityView` com score de saúde e accordion por check
- [x] A-Insights v1: pipeline determinístico (4 tipos) + `InsightsView` com gestão de status
- [x] Preservação de status analista no upsert de insights (fetch-before-upsert)
- [x] Centralização do `workspace_id` em `src/lib/workspace.ts`
- [x] Identificação visual do tenant ativo: sidebar (seção "Cliente"), header (badge pill), DataQualityView e InsightsView
