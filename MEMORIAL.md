# SynapseIQ — Memorial Descritivo

**Versão:** 2.0  
**Data:** Maio 2026  
**Stack:** Next.js 16 · Supabase · BigQuery · Python · Vercel · GitHub Actions

---

## 1. Visão Geral

O **SynapseIQ** é uma plataforma B2B de inteligência de marketing digital, concebida como um **AI Growth Orchestrator** com arquitectura warehouse-native. O sistema centraliza dados de canais de media paga (Google Ads via BigQuery) num painel analítico multi-tenant, preparado para expansão com GA4 e agentes de IA.

O workspace piloto é a agência **Woke** (`workspace_id: a082fe86-a65f-4c9b-9442-fe775f47e3fc`), cujos dados de Google Ads são sincronizados diariamente a partir do BigQuery para o Supabase.

---

## 2. Arquitectura do Sistema

```
GitHub (synapseiqadm/synapse-system)
│
├── frontend/          → Next.js 16 App Router  →  Vercel (produção)
│                                                    synapse-system.vercel.app
├── backend/
│   └── connectors/
│       ├── a_data_sync.py   → Entry point (substitui sync_woke.py)
│       ├── config.py        → Configuração e fail-fast
│       ├── sync_runs.py     → Auditoria de execuções
│       ├── sync_ads.py      → Lógica BigQuery → Supabase
│       └── sync_woke.py     → DEPRECATED (mantido para referência)
│
├── supabase/migrations/
│   ├── 001_sync_runs.sql
│   └── 002_metadata_and_constraints.sql
│
└── .github/workflows/
    └── sync_data.yml     → GitHub Actions (cron diário 06h BRT)
```

**Fluxo de dados:**
```
Google Ads
  → Airbyte Transfer
    → BigQuery (synapsesystem.raw_google_ads_woke)
      → a_data_sync.py (orquestra config + sync_runs + sync_ads)
        → Supabase (campaign_summary / keyword_analysis / sync_runs)
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
| `lucide-react` | 1.x | Ícones |
| `tailwindcss` | 4.x | Estilos |

### 3.2 Estrutura de Rotas

| Rota | Tipo | Descrição |
|---|---|---|
| `/` | Static + Redirect | Redireciona permanentemente para `/dashboard` |
| `/login` | Static | Autenticação com email/password via Supabase Auth |
| `/dashboard` | Client Component | Painel principal de analytics |
| `/agents` | Static | Central de Agentes de IA (mockup) |
| `/connectors` | Static | Central de Conectores (mockup) |
| `/logs` | Static | Log de Execução (mockup) |

### 3.3 Autenticação

Implementada com `@supabase/ssr` em três camadas:

- **`src/proxy.ts`** (Edge Middleware) — intercepta todos os pedidos, verifica sessão e redireciona utilizadores não autenticados para `/login`. Substituiu `middleware.ts` (convenção deprecada no Next.js 16).
- **`src/utils/supabase/server.ts`** — cliente SSR para Server Components, com fallback para variáveis sem prefixo `NEXT_PUBLIC_`.
- **`src/utils/supabase/client.ts`** — cliente browser para Client Components (`"use client"`).

Chaves utilizadas:
- **Anon JWT key** (`eyJ...`) → `NEXT_PUBLIC_SUPABASE_ANON_KEY` — browser e server
- **Service key** (`sb_secret_...`) → `SUPABASE_SERVICE_KEY` — backend Python e GitHub Actions exclusivamente

### 3.4 Dashboard (`/dashboard`)

O dashboard é um Client Component com três vistas navegáveis via sidebar:

#### Vista: Geral
- Selector de período (7d / 15d / 30d)
- 3 Metric Cards: Investimento Total, Conversões, ROAS Médio
- Gráfico dual-axis (Recharts): Custo (eixo esquerdo) vs. ROAS (eixo direito)
- Dados de `kpi_cache_daily` filtrados por workspace e período

#### Vista: Campanhas → Visão Geral
- Strip de KPIs: Total investido, Campanhas activas, ROAS médio
- Grid de `CampaignCard` com glassmorphism
- Share of Spend bar por campanha
- ROAS badge com semáforo: verde ≥ 3.0x · âmbar ≥ 1.5x · vermelho < 1.5x
- Dados de `campaign_summary` ordenados por custo

#### Vista: Campanhas → Palavras-chave
- Strip de KPIs: Custo total, Cliques totais, Conversões
- Tabela com 7 colunas: Keyword · Tipo · Campanha · Cliques · Custo · Conv. · CPA
- Filtro por match type: Broad (azul) · Phrase (âmbar) · Exact (verde)
- Campo de busca full-text por keyword ou campanha
- CPA calculado: Custo ÷ Conversões
- Footer com contagem e custo total filtrado
- Dados de `keyword_analysis` ordenados por conversões DESC

### 3.5 Sidebar

Estrutura hierárquica com expansão animada:
```
├── Geral
├── Campanhas ▾
│   ├── Visão Geral
│   └── Palavras-chave
├── ──────────
├── Canais
└── Configurações
```

---

## 4. Backend — A-Data Sync (Python)

### 4.1 Estrutura de Módulos

```
backend/connectors/
├── __init__.py
├── config.py        → Validação fail-fast de env vars; constantes de configuração
├── sync_runs.py     → Helpers de auditoria: start / finish_success / finish_error
├── sync_ads.py      → sync_campaigns() + sync_keywords() + ga4_real_data_available()
├── a_data_sync.py   → Entry point: orquestra sync + auditoria + --dry-run
└── sync_woke.py     → DEPRECATED — mantido para referência histórica
```

### 4.2 Dependências
```
supabase
google-cloud-bigquery
python-dotenv
```

### 4.3 Módulos

#### `config.py`
- Carrega `.env` via `python-dotenv`
- `_require(name)` faz `sys.exit(1)` imediato se a variável obrigatória estiver ausente
- Expõe: `APP_ENV`, `ALLOW_MOCK_DATA`, `WOKE_WORKSPACE_ID`, `GCP_PROJECT_ID`, `BQ_LOCATION`, `GOOGLE_ADS_DATASET`, `GOOGLE_ADS_CUSTOMER_ID`, `GA4_DATASET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DATE_RANGE_START`, `DATE_RANGE_END`

#### `sync_runs.py`
- `start_sync_run()` → insere registo com `status='running'`; retorna UUID do run
- `finish_sync_run_success(run_id, rows_loaded)` → atualiza para `status='success'`
- `finish_sync_run_error(run_id, error_message)` → atualiza para `status='error'`

#### `sync_ads.py`
- `sync_campaigns(bq_client, supabase, dry_run)` → UPSERT em `campaign_summary`
- `sync_keywords(bq_client, supabase, dry_run)` → UPSERT em `keyword_analysis`
- `ga4_real_data_available(bq_client, ga4_dataset)` → verifica `INFORMATION_SCHEMA.TABLES` do dataset GA4
- `can_use_mock_data(app_env, allow_mock)` → bloqueia mock em `production`

#### `a_data_sync.py` (entry point)
```bash
# Validação sem escrita
cd backend && python -m connectors.a_data_sync --dry-run

# Sync completo
cd backend && python -m connectors.a_data_sync
```

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
```

#### `keyword_analysis`
```sql
workspace_id     UUID
campaign_id      TEXT          -- era BIGINT; alterado para TEXT (migration 002)
campaign_name    TEXT
keyword          TEXT
match_type       TEXT
clicks           INT
cost             NUMERIC
conversions      NUMERIC(10,2) -- era INT; alterado para NUMERIC (migration 002)
data_source      TEXT  DEFAULT 'google_ads'
source_platform  TEXT
is_mock          BOOLEAN DEFAULT FALSE
date_range_start DATE
date_range_end   DATE
loaded_at        TIMESTAMPTZ DEFAULT NOW()
UNIQUE (workspace_id, campaign_id, keyword, match_type, date_range_start, date_range_end)
```

#### `sync_runs` *(auditoria — criada em migration 001)*
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

#### `kpi_cache_daily` *(referenciada pelo dashboard — ainda não populada por script)*
```sql
workspace_id   UUID
date           DATE
metric_name    TEXT   -- 'total_cost' | 'roas' | 'conversions'
metric_value   NUMERIC
channel        TEXT
```

### 5.2 Migrations aplicadas

| Ficheiro | O que faz |
|---|---|
| `supabase/migrations/001_sync_runs.sql` | Cria tabela `sync_runs` |
| `supabase/migrations/002_metadata_and_constraints.sql` | Adiciona colunas de metadata; altera tipos; cria UNIQUE constraints para upsert |

### 5.3 Utilizadores Auth

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

- **Variáveis de ambiente injectadas pelo workflow** (não são secrets):

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
| `os.environ.setdefault()` no config | Dev local usa path Windows; CI injeta credencial via secret (não sobrescreve) |
| `python -m connectors.a_data_sync` | Execução como módulo; resolve imports relativos sem hacks de sys.path no CI |

---

## 8. Próximos Passos Sugeridos

- [ ] Integração GA4 com `data_source: "ga4"` — `ga4_real_data_available()` já preparado em `sync_ads.py`
- [ ] Popular `kpi_cache_daily` via script de sync (alimenta a vista Geral do dashboard)
- [ ] Agentes de IA com LangChain (páginas `/agents` já scaffoldadas)
- [ ] Multi-workspace: selector de workspace no sidebar
- [ ] Row Level Security (RLS) no Supabase por `workspace_id`
- [ ] Alertas automáticos por e-mail quando ROAS < threshold (tabela `sync_runs` já disponível como gatilho)
- [ ] Remover código de debug (`alert` / `console.error`) da página `/login` após confirmar login em produção
- [ ] Rodar `sync_woke.py` DEPRECATED e removê-lo após próximo ciclo de sync bem-sucedido com `a_data_sync.py`
