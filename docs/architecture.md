# Arquitectura — SynapseIQ

**Estado actual:** v4.5 (Maio 2026)

---

## Estrutura de Repositório

```
GitHub (synapseiqadm/synapse-system)
│
├── frontend/                        → Next.js 16 App Router → Vercel (produção)
│   └── src/
│       ├── app/
│       │   ├── page.tsx             → redirect → /dashboard
│       │   ├── login/page.tsx       → autenticação Supabase
│       │   ├── dashboard/page.tsx   → painel principal
│       │   ├── agents/page.tsx      → Centro de Operações (feed de decisões live)
│       │   ├── connectors/page.tsx  → Central de Conectores (live — sync_runs + data_quality_report)
│       │   ├── logs/page.tsx        → Status do Sync (sync_runs live)
│       │   └── api/
│       │       ├── ai/narrative/route.ts
│       │       ├── agents/decisions/route.ts
│       │       ├── agents/action/route.ts
│       │       ├── connectors/status/route.ts  → sync_runs + data_quality_report por plataforma
│       │       ├── cron/guardian/route.ts       → Vercel Cron P1 alertas via Resend
│       │       ├── admin/workspaces/route.ts   → lista workspaces (superadmin only)
│       │       ├── workspaces/switch/route.ts  → define cookie de workspace activo
│       │       └── workspaces/[workspace_id]/
│       │           ├── growth/{overview,funnel,events,paid-sessions}/route.ts
│       │           ├── governance/{summary,runs,findings,evidence}/route.ts
│       │           └── timeline/route.ts
│       ├── components/
│       │   ├── ExecutiveBoardView.tsx   → Painel Executivo (tab Geral)
│       │   ├── AINarrativeCard.tsx      → Card diagnóstico Gemini + BudgetPacingBadge + probable_causes UI
│       │   ├── GrowthIntelligenceView.tsx
│       │   ├── InsightsView.tsx
│       │   ├── DataQualityView.tsx
│       │   ├── AgentDecisionFeed.tsx    → feed approve/reject + causas prováveis
│       │   ├── ConnectorCard.tsx        → card de conector com status live
│       │   ├── AgentCard.tsx
│       │   ├── SyncRunsTable.tsx
│       │   ├── Sidebar.tsx
│       │   └── ...
│       ├── lib/
│       │   ├── workspace.ts         → DEFAULT_WORKSPACE (fonte única de tenant ID)
│       │   ├── resolve-workspace.ts → resolveWorkspace() — cookie synapseiq_workspace → DB lookup
│       │   ├── api/{common,growth,governance,sync_runs}.ts
│       │   ├── funnel.ts
│       │   ├── decision.ts
│       │   ├── measurementConfig.ts
│       │   ├── semanticRegistry.ts
│       │   └── mail.ts              → sendGuardianAlert() via Resend SDK; mock logger se key ausente
│       └── utils/supabase/{client,server,admin}.ts  → admin.ts: createAdminClient() server-only
│
├── backend/connectors/
│   ├── a_data_sync.py           → entry point do pipeline
│   ├── config.py                → env vars + fail-fast
│   ├── sync_runs.py             → auditoria de execuções
│   ├── sync_ads.py              → BigQuery → campaign_summary / ad_group_summary / keyword_analysis / kpi_cache_daily
│   ├── sync_ga4.py              → GA4 First Light
│   ├── data_quality.py          → 19 checks A–S
│   ├── insights.py              → gerador determinístico + semântico
│   ├── semantic_governance.py   → 8 checks L–S + persistência
│   ├── semantic_registry.py     → loader do registry YAML
│   ├── timeline_engine.py       → queries de timeline + KPI diff
│   ├── operational_events.py    → record_operational_event + detect_kpi_anomaly
│   ├── ai_narrative.py          → integração Gemini (backend, usado em testes)
│   ├── agent_decisions.py       → motor multi-agente (Growth Master, Creative Critic, Anomaly Scout)
│   └── sync_woke.py             → DEPRECATED
│
├── backend/governance/
│   ├── semantic_registry.yml
│   ├── templates/tenant_measurement_config.template.yml
│   └── tenants/
│       ├── woke_measurement_config.yml
│       ├── pigz_measurement_config.yml
│       └── cacau_measurement_config.yml
│
├── backend/tests/
│   ├── test_semantic_governance.py   → 36 testes unitários
│   └── test_ai_narrative.py          → 5 testes (4 mock + 1 live)
│
├── supabase/migrations/             → 017 migrations aplicadas (000–017)
├── frontend/vercel.json             → Vercel Cron: /api/cron/guardian a cada 4h
│
├── docs/
│   ├── architecture.md              ← este ficheiro
│   ├── database.md
│   ├── backend.md
│   ├── frontend.md
│   ├── changelog.md
│   ├── security.md
│   ├── semantic_model.md
│   └── sql/
│       ├── fn_campaign_snapshot_delta.sql
│       └── ...drafts (NÃO aplicar como migration)
│
├── .github/workflows/sync_data.yml       → Woke People (cron diário 09h UTC / 06h BRT)
├── .github/workflows/sync_data_pigz.yml  → Pigz (cron 09:30 UTC / 06:30 BRT)
└── .github/workflows/sync_data_cacau.yml → Cacau Turismo (cron 10h UTC / 07h BRT)
```

---

## Fluxo de Dados

```
Google Ads (BigQuery raw_google_ads_woke)
    ↓
sync_ads.py
    ├── sync_campaigns()        → campaign_summary
    ├── sync_ad_groups()        → ad_group_summary
    ├── sync_kpi_cache_daily()  → kpi_cache_daily
    └── sync_keywords()         → keyword_analysis

GA4 (BigQuery analytics_289891960)
    ↓
sync_ga4.py                     → ga4_first_light_summary

data_quality.py (checks A–F Ads, G–K GA4, L–S via semantic_governance)
    ↓
    data_quality_report

semantic_governance.py (8 checks L–S)
    ↓
    semantic_governance_runs / _findings / _evidence

insights.py
    ↓
    insight_feed

operational_events.py
    ↓
    operational_events (anomalias + sync events)

agent_decisions.py (Growth Master, Creative Critic, Anomaly Scout)
    ↓
    agent_decisions

                    ↓ (tudo no Supabase)
            Next.js API Routes
                    ↓
              Dashboard + /agents + /connectors

Vercel Cron (a cada 4h) → /api/cron/guardian
    ├── lê agent_decisions (type=alert, status=pending, metadata.is_critical=true)
    ├── verifica idempotência via operational_events (guardian_alert + decision_id)
    ├── envia email via Resend SDK (sendGuardianAlert)
    └── regista em operational_events
```

---

## Multi-tenancy

| Dimensão | Implementação |
|---|---|
| Isolamento | RLS em todas as tabelas; queries sempre filtradas por `workspace_id` |
| Auth | Supabase Auth SSR — `profiles.workspace_id` resolve o tenant da sessão |
| Workspace pivot | `resolve-workspace.ts` — `resolveWorkspace()`: cookie `synapseiq_workspace` → DB lookup → fallback `profiles.workspace_id` |
| Superadmin | `profiles.role='superadmin'` → bypass via `SUPABASE_SERVICE_KEY`; sidebar workspace switcher visível apenas para superadmin |
| Workspace switch | `/api/workspaces/switch` define cookie `synapseiq_workspace`; `/api/admin/workspaces` lista todos (superadmin only) |
| Onboarding | Assistido (manual via admin) — sem self-service UI ainda |
| Tenants activos | Woke People (`a082fe86`), Pigz (`63fd5033`), Cacau Turismo (`b7126974`) |

### Tenants e Pipelines

| Tenant | workspace_id | Google Ads Customer ID | BQ Dataset | Cron (UTC) |
|---|---|---|---|---|
| Woke People | `a082fe86-...` | `6627867790` | `raw_google_ads_woke` | `0 9 * * *` |
| Pigz | `63fd5033-...` | `8378967509` | `raw_google_ads_pigz` | `30 9 * * *` |
| Cacau Turismo | `b7126974-...` | `7184417498` | `raw_google_ads_cacau` | `0 10 * * *` |

---

## CI/CD

### GitHub Actions — 3 Pipelines por Tenant

| Workflow | Tenant | Cron (UTC) | Cron (BRT) |
|---|---|---|---|
| `sync_data.yml` | Woke People | `0 9 * * *` | 06h |
| `sync_data_pigz.yml` | Pigz | `30 9 * * *` | 06:30h |
| `sync_data_cacau.yml` | Cacau Turismo | `0 10 * * *` | 07h |

**Padrão comum a todos os workflows:**

| Campo | Valor |
|---|---|
| Input | `dry_run` (boolean, default `true`) |
| Concurrency | `group: a-data-sync-<tenant>`, `cancel-in-progress: false` |
| Runner | `ubuntu-latest` |
| Comando | `cd backend && python -m connectors.a_data_sync [--dry-run]` |
| GCP creds | `GOOGLE_CREDENTIALS_JSON` (base64) → `/tmp/gcp_credentials.json` → removido com `if: always()` |
| Env tenant | `WORKSPACE_ID`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_DATASET` específicos por tenant |

**Comportamento do cron:** `inputs.dry_run` não existe em execuções agendadas — condição avalia `false` → pipeline executa sem `--dry-run`.

### Vercel (frontend)

| Campo | Valor |
|---|---|
| URL produção | `synapse-system.vercel.app` |
| Projecto | `synapse-system` (team `synapse-iq`) |
| Root Directory | `frontend/` |
| Framework | Next.js |
| Node | 24.x |
| Deploy trigger | Push para `main` via GitHub integration |
