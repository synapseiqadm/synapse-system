# Changelog — SynapseIQ

Histórico de versões em ordem cronológica. Para detalhes completos ver `MEMORIAL_LEGACY.md`.

---

## v1.0 — A-Data Ads + A-Insights + Data Quality
Pipeline Google Ads → Supabase. Checks A–F. Insights determinísticos (campaign_zero_conversions, keyword_zero_conversions). Dashboard inicial.

## v1.1 — GA4 First Light + Semantic Governance
`sync_ga4.py`. Checks G–K (GA4). Semantic Governance: 8 checks L–S, `semantic_governance_runs/_findings/_evidence`. 36 testes unitários.

## v1.2 — Data Marts e API Contracts
8 endpoints App Router sob `/api/workspaces/[id]/`. Tipos TypeScript (`growth.ts`, `governance.ts`). `handleApiRoute`, `makeEnvelope`, `parseApiFilters`. Envelope JSON estável.

## v1.3 — Frontend GA4 MVP
`GrowthIntelligenceView` com 7 secções: GA4 First Light, funil semântico, eventos, paid sessions, governance findings/evidence. `Promise.allSettled` com isolamento por secção.

## v1.3.1 — Semantic Model and Rule Registry
`docs/semantic_model.md`. `backend/governance/semantic_registry.yml` (8 checks com metadados canónicos). `semantic_registry.py` loader. Espelho `semanticRegistry.ts` no frontend.

## v1.4.1 — Measurement Config Bridge
`measurementConfig.ts` — espelho TypeScript da `conversion_registry`. `getConfiguredFunnelStep()` com prioridade `isConversion` → mapa → regex.

Dívida técnica: divergência entre `GA4_CONVERSION_EVENTS` (sync_ga4.py) e `canonical_events` (YAML). Requer confirmação do cliente.

## v1.4.2 — KPI Cache Daily Refresh
`sync_kpi_cache_daily()` em `sync_ads.py`. Consulta `p_ads_CampaignStats_6627867790` no BigQuery. 3 métricas por dia: total_cost, conversions, roas. 87 records (29 dias × 3).

## v1.4.3 — Scheduled Data Sync MVP
`.github/workflows/sync_data.yml`: cron `0 9 * * *`, `workflow_dispatch` com `dry_run`, concurrency guard, GCP creds via base64.

## v1.4.4 — Sync Observability Logs
`/logs` page com dados reais de `sync_runs`. Cards de saúde (healthy/warning/error). `SyncRunsTable`. Migration 009 (RLS sync_runs scoped ao workspace Woke).

## v1.4.4.1 — Navigation & Preview Hygiene
"Log de Execução" → "Status do Sync". Badge `Preview` em Agentes. `AgentCard` status `preview` oculta métricas de runtime. Disclaimer na página `/agents`.

## v1.6 — Semantic Funnel Intelligence
`funnel.ts` — `computeFunnelIntelligence()`. Progressão de funil (Aquisição → Landing → Engajamento → Intenção → Conversão) com barras semânticas. Integração Governance → Growth (eventos suspeitos impactam leitura executiva).

## v1.6.1 — Insight Consolidation Engine
Deduplicação frontend por `dedupe_key` (mais recente por tipo). Group cards para `campaign_zero_conversions_with_cost` e `keyword_zero_conversions_with_cost`. Mutual exclusion semântica (`MUTUALLY_EXCLUSIVE_TYPES`). `InsightCard` modo compacto.

## v1.7.1 — Executive Overview Layer
Substituição de `GeralView` (métricas brutas) por `ExecutiveBoardView` (5 domínios: Health, Prioridades, Operational Snapshot, Domain Health, Timeline). `computeDecisionBrief()`.

## v1.7.2 — Executive Density & Performance Pulse
Layout 5 cards verticais → 3 linhas em grid. Performance Pulse (col-span-2) com 3 métricas + MiniAreaChart de ROAS 30d.

## v1.7.3 — Performance Pulse Enrichment
4 métricas em grade 2×2: Sessões, Investimento, Conversão, ROAS. `fmtBRLCompact()`. `ChartPoint.spend` para overlays futuros.

## v1.7.4 — Operational Momentum Visualization
`MomentumChart` sub-componente. `trendDelta` (7d vs 7d anterior). `isAnomaly` (desvio > 30% da média 30d). Delta badge persistente. Cor dinâmica emerald/red.

## v1.7.4b — Pulse Enrichment
Linha de custo no chart (dual YAxis ocultos). Marcadores de timeline operacional (S/G/I). Seletor de período 7d/15d/30d (client-side, zero queries adicionais).

## v1.7.4c — Executive Insight Card (AI Narrative UI)
`AINarrativeCard.tsx`. Borda lateral dinâmica por `priority_score`. Badge "PREVIEW DE TESTE" quando `is_simulated`. `commit: 3cfc82c`

## v1.8 — Causal Intelligence Infrastructure
**v1.8.1:** Migrations 010 (`operational_events`) e 011 (RLS).  
**v1.8.2:** Correção de indentação em `a_data_sync.py`. API Route `/timeline`. Módulos `operational_events.py` + `timeline_engine.py`.  
**v1.8.3:** `detect_kpi_anomaly()` — desvio > 30% de ROAS vs média 30d → persiste em `operational_events`.  
**v1.8.4:** Marcadores `!` (orange) no Momentum Chart. Tooltips contextuais na Timeline com `impact_scope`.

## v1.8.5 — Clicks & Impressions Sync
`sync_campaigns()` actualizado com `metrics_clicks`, `metrics_impressions`. CTR derivado. 9 campanhas com dados reais: 2.877 clicks, 70.641 impressões.

## v1.9.1 — Snapshot Engine: SQL Delta Logic
`fn_campaign_snapshot_delta(target_workspace_id UUID)` — rolling window, 6 métricas (spend, conversions, clicks, cpa, cpc, ctr), filtro `ABS(delta) > 15%`. `docs/sql/fn_campaign_snapshot_delta.sql`.

## v1.9.2 — Narrative Generator: AI Diagnostic Layer
`ai_narrative.py` — integração Gemini (google-genai SDK). SYSTEM_PROMPT com biblioteca de padrões causais HIGH-RESOLUTION (CTR/CPC). `generate_narrative()`. Testes: 4 mock + 1 live.

## v1.9.5 — Intelligence Activation: GCP Migration
`GEMINI_API_KEY` configurada em `backend/.env`. Generative Language API habilitada no GCP. Bootstrap de testes corrigido.

## v1.9.6 — Model ID Alignment: gemini-2.5-flash
`gemini-1.5-flash` → `gemini-2.5-flash`. `max_output_tokens: 512 → 2048`. `thinkingConfig: { thinkingBudget: 0 }`. `commit: ac77d69`

## v2.0 — AI Narrative Frontend Integration
`/api/ai/narrative` route (Next.js). SYSTEM_PROMPT copiado para o frontend (mantido em sync). `AINarrativeCard` activado com dados live. `OfflineCard` quando `GEMINI_API_KEY` ausente.

## v2.1 — Auth Shield: RLS Hardening
Migration 013: substituição de `TO public USING (true)` por `TO authenticated` workspace-scoped via `profiles` em 12 tabelas. `resolveWorkspace()` nas routes de API (dinâmica, sem hardcode). SYSTEM_PROMPT: 4 constraints invioláveis de governança. Dashboard: avatar + email + logout. `commit: 390e62f`

## v2.2 — Persistence, Memory & Multi-Agent Activation
Migration 014: `agent_decisions` + trigger `agent_decisions_preserve_status` + RLS.  
`agent_decisions.py`: motor multi-agente (Growth Master, Creative Critic, Anomaly Scout).  
`a_data_sync.py`: integração do pipeline de agentes.  
`/api/agents/decisions`: lê DB primeiro, fallback on-the-fly.  
`/api/agents/action`: PATCH approve/reject.  
`AgentDecisionFeed`: `dbId`, async `resolve()`, feedback "Aprovado ✓".  
`commit: 8de1bbd`

## v2.2.1 — Bugfix: Persistência de Decisões via UI
**Problema:** F5 revertia status para `pending`.  
**Causa 1:** `agent_decisions` vazia → fallback → `dbId=undefined` → PATCH não chamado.  
**Causa 2:** `router.refresh()` não re-dispara `useEffect(fn, [])`.  
**Fix:** Seed via Supabase MCP (2 rows). `onRefresh` callback em `AgentDecisionFeed`. `refetch()` extraído em `agents/page.tsx`.  
`commit: bce1f2e`

## v2.2.2 — Produção: Activação da Inteligência
**Problema:** `/api/ai/narrative` → 503 em produção.  
**Causa:** `GEMINI_API_KEY` ausente nas env vars do Vercel.  
**Fix:** Chave adicionada ao vault Vercel. Redeploy automático. Fix secundário: `p_workspace_id` → `target_workspace_id` em `a_data_sync.py`.  
**Validação:** 503 eliminados; requests autenticados → 200 com diagnóstico Gemini.  
`commit: 7bb3b0a`

---

## 🏁 Encerramento — Fase 2: Persistência, Memória & Activação Multi-Agente

**Data:** 2026-05-13 | **Baseline para Fase 3:** v2.2.2

A Fase 2 fez a plataforma evoluir de pipeline de dados estático para ecossistema de agentes autónomos com memória em banco de dados e loop de feedback humano via interface.

### Entregas v2.0 → v2.2.2

**Motor Multi-Agente & Persistência**
- Tabela `agent_decisions` com RLS + trigger `agent_decisions_preserve_status`
- Agentes: Growth Master · Creative Critic · Anomaly Scout — decisões persistentes no Supabase
- Loop de feedback: `/agents` com approve/reject; estado preservado após reload (fix v2.2.1)

**Narrativa em Produção**
- `/api/ai/narrative` com Gemini 2.5 Flash (server-side, REST)
- `fn_campaign_snapshot_delta` — janela rolling 30d → diagnóstico de performance
- `GEMINI_API_KEY` activa no vault Vercel (fix v2.2.2)

**Governança & Qualidade**
- 19 checks (A–S): Google Ads (A–F), GA4 (G–K), Semantic Governance (L–S)
- Documentação técnica reestruturada: `docs/` (6 ficheiros) + `MEMORIAL.md` como índice

### Baseline para Fase 3

| Componente | Estado |
|---|---|
| Backend Python | Estável — pipeline diário |
| Database | Migration 014 aplicada |
| Frontend Next.js 16 | Funcional — App Router |
| Auth | Activa — Supabase SSR workspace-scoped |
| IA | Gemini 2.5 Flash em produção |

### Fase 3 — Detective & Guardian (próximo)

- **3.1** — `/connectors` com dados reais de `data_quality_report`
- **3.2** — Taxonomia Causal no SYSTEM_PROMPT (Tracking → Criativo → Audiência → LP)
- **3.3** — Alertas P1: Vercel Cron Jobs + Resend (sem nova infra)
- **3.4** — Forecaster: desbloqueado após Migration 015 (`budget_total`) + ingestão Google Ads

> A Fase 2 estabeleceu os "músculos" (agentes e persistência). A Fase 3 é o "cérebro" — o sistema passa a entender *por que* os números mudaram.

---

## v3.1 — Glass Box: Conectores com Dados Reais

**Problema:** `/connectors` mostrava dados estáticos; banner de tracking sempre verde independente do estado real.

**Entregues:**
- Nova API route `/api/connectors/status` — lê `sync_runs` (Google Ads + GA4) e `data_quality_report`; mapeia status real (synced/pending/error)
- Página `/connectors` reescrita: dados live, stats bar (Conectados/Aguardando/Com Erro/Desconectados), `ConnectorCard` com quality summary
- `hasCriticalIssues` — banner vermelho apenas para `status=failed` ou `severity=high/critical`
- **Fix (`412e84c`):** triple-cache bug: `force-dynamic` + `revalidate=0` na route + `{ cache: "no-store" }` no fetch + `setTrackingIssues([])` antes do await

`commit: db3b8b7, 412e84c`

---

## v3.2 — Detective: Taxonomia Causal no Gemini

**Entregues:**
- **SYSTEM_PROMPT:** Layer 0 — Tracking Integrity (avaliado antes de qualquer padrão); regras explícitas por check UTM/GA4; tracking failures elevam para P1 (não P3)
- **SECTION 4 — Governance Signals** injectada no payload com categorias `[TRACKING]` / `[DATA]` / `[SEMANTIC]`
- Fetch paralelo de `data_quality_report` (failed/warning, deduplicado por `check_name`) na narrative route
- `buildUserMessage()` actualizado para aceitar `governanceFindings` e construir SECTION 4

`commit: db3b8b7`

---

## v3.3 — Guardian: Alertas P1 Autónomos

**Entregues:**
- `/api/cron/guardian/route.ts` — handler Vercel Cron; auth `Authorization: Bearer <CRON_SECRET>`; admin client com `SUPABASE_SERVICE_KEY` (bypassa RLS)
- `lib/mail.ts` — `sendGuardianAlert()` via Resend SDK; mock logger sem throw quando key ausente; template HTML dark theme
- `frontend/vercel.json` — `"schedule": "0 */4 * * *"` (a cada 4h)
- **Idempotência:** verifica `operational_events` por `event_type=guardian_alert` + `decision_id` antes de enviar; regista após envio
- **P1 proxy:** `metadata.is_critical === true` (sem coluna `priority_score` em `agent_decisions`; `is_critical` definido pelo Anomaly Scout quando `total_waste >= R$500`)
- **Validado:** email entregue em produção local — "R$ 745.91 em gasto sem conversão — 7 campanha(s)", Anomaly Scout, CTA funcional

`commit: 857e54c`

---

## v3.5 — Causal JSON: `probable_causes[]` Estruturado

**Entregues:**
- **SYSTEM_PROMPT:** bloco de output `probable_causes[]` com schema `layer | confidence | cause | evidence`; tracking sempre primeiro se SECTION 4 tem falhas; máx 3 items; `confidence = high/medium/low`
- **`AINarrativeCard.tsx`:** secção "Causas Prováveis" com badges por camada (TRACKING=red, CREATIVE=amber, AUDIENCE=violet, LANDING=orange, BUDGET=emerald) e dots de confiança
- **`AgentDecisionFeed.tsx`:** `deriveProbableCauses()` determinístico (GA4 sessions → CTR → governance → landing fallback); badges ALTA/MÉD/BAIXA
- **`/api/agents/decisions`:** `ProbableCause` interface; parallel fetch `campaign_summary` + `ga4_first_light_summary` + `semantic_governance_findings`
- Normalização: `parsed.probable_causes = Array.isArray(...) ? ... : []`

`commit: 93fb3f3`

---

## v3.4 — Forecaster: Ingestão de Orçamento

**Entregues:**
- **Migration 015** (`015_campaign_summary_budget.sql`): `ADD COLUMN IF NOT EXISTS daily_budget NUMERIC` + `budget_total NUMERIC` — aplicado no Supabase `synapse-system`
- **`sync_ads.py`:** Campaign subquery usa `MAX(campaign_budget_amount_micros) / 1e6 AS daily_budget` com `GROUP BY`; `budget_total = daily_budget × period_days`; try/except fallback para NULL; `from datetime import date` adicionado
- **`narrative/route.ts`:** `CampaignRow` extendido com `daily_budget` + `budget_total`; SELECT actualizado; SECTION 1 appends `· budget_total R$X` quando disponível; debug console.logs removidos (pós-validação v3.2/v3.5)

`commit: 156d48d`

---

## v4.1 — Burn Rate Predictor & Budget Pacing

**Entregues:**
- **`computePeriodCtx()`** — deriva `daysElapsed`, `totalDays`, `progressPct` de `campaign_summary.date_range_*` + `new Date()` do servidor; sem hardcode
- **SECTION 1 — `[CONTEXT]`** injectado: `Today is X. Period: A..B (N days). Progress: D/N days (P%).`
- **SYSTEM_PROMPT — `## Financial Forecaster`:** diretriz completa com `burn_rate = cost ÷ days_elapsed`, `estimated_total_spend = burn_rate × total_days`, thresholds `over` (+5%) / `under` (-15%) / `on_track`, `days_until_exhaustion = FLOOR((budget − cost) ÷ burn_rate)`
- **Output JSON** extendido com `budget_pacing?` (opcional — omitido quando sem dados de orçamento)
- **`BudgetPacingBadge`** em `AINarrativeCard.tsx`: vermelho (`over`) · índigo (`under`) · esmeralda (`on_track`); mostra `estimated_total_spend`, `days_until_exhaustion`, `recommendation`
- **SELECT** inclui `date_range_start` + `date_range_end` para derivação do período
- **`vercel.json`:** cron corrigido de `0 */4 * * *` → `0 9 * * *` (Hobby plan — 1×/dia às 9h UTC)
- **Validado em produção:** badge PACING: ESTOURO · R$3.092,40 projetado · recomendação de redução de lance

`commit: 2716aa9, c73c61e`

---

## v4.2 — Playbook Engine: Checklist de Contingência

**Entregues:**
- **SYSTEM_PROMPT — `## Playbook Engine — [ACTIONABLE_PLAYBOOKS]`:** diretriz MANDATORY — `pacing_status ∈ {over, under}` → Gemini DEVE gerar `suggested_playbooks[]` com 2–4 items; `on_track` → array vazio; sem `budget_pacing` → campo omitido
- **Schema por item:** `{ task: string (pt-BR, ≤80 chars), impact: string (pt-BR, ≤60 chars), effort: "low" | "medium" | "high" }`
- **Output JSON** extendido com `suggested_playbooks?` (opcional — omitido quando sem `budget_pacing`)
- **Tipo `SuggestedPlaybook`** em `route.ts`; normalização defensiva (filtra items sem `task` ou `effort` inválido)
- **`PlaybookChecklist`** em `AINarrativeCard.tsx`: checkboxes visuais (sem estado), badges de esforço BAIXO/MÉDIO/ALTO (esmeralda/âmbar/vermelho), linha de impacto financeiro; renderiza entre `BudgetPacingBadge` e `probable_causes`
- **RLS (Task 1):** confirmado já completo via migration 013 — `sync_runs` e `operational_events` já usam padrão `TO authenticated` workspace-scoped; sem migration adicional necessária
- **Deploy:** auto-deployed via GitHub integration (webhook reposto); produção `READY` em `dpl_AabagCPAnrYvDKCMSU9Wexww3Pxy`

`commit: 7c6f334`

---

## 🏁 Encerramento — Fase 3: Detective & Guardian

**Data:** 2026-05-13 | **Commits:** `db3b8b7` → `156d48d`

A Fase 3 transformou o SynapseIQ de sistema de alertas de performance para sistema de diagnóstico causal. O sistema agora entende *por que* os números mudaram, classifica falhas por camada (Tracking → Criativo → Audiência → Landing → Orçamento), e dispara alertas críticos de forma autónoma.

### Baseline para Fase 4

| Componente | Estado |
|---|---|
| Backend Python | Pipeline diário + budget sync (daily_budget, budget_total) |
| Database | Migration 015 aplicada — 15 migrations no total |
| Frontend Next.js | Connectors live + Narrative causal + Guardian UI |
| IA | Gemini 2.5 Flash com Layer 0 + SECTION 4 + probable_causes[] |
| Alertas | Guardian a cada 4h — validado; Resend mock local / domínio pendente |

### Fase 4 — Candidatos

- **Forecaster activo:** usar `daily_budget` + `budget_total` para diagnósticos de pace (orçamento consumido vs projetado)
- **Multi-tenant onboarding:** substituir policies `TO public` scoped ao UUID Woke por `TO authenticated` dinâmico
- **Creative Critic enrichment:** ingestão de dados de anúncio (ad_name, ad_group) para diagnóstico a nível criativo
- **Self-healing suggestions:** sugestões de realocação de budget com preview de impacto quantificado

---

## v4.3 — Ad Group Intelligence: Creative Critic

**Entregues:**
- **Migration 016** (`016_ad_group_summary.sql`): tabela `ad_group_summary` com RLS workspace-scoped — `workspace_id, ad_group_id, ad_group_name, campaign_id, campaign_name, cost, clicks, impressions, ctr, conversions, roas, ad_strength, date_range_start, date_range_end`; constraint UNIQUE `(workspace_id, ad_group_id, date_range_start, date_range_end)`
- **`sync_ad_groups()`** em `sync_ads.py`: BigQuery CTE `strength_by_group` (pior ad strength por grupo) + JOIN `AdGroupBasicStats` + `AdGroup` + `Campaign`; dedup Python por `ad_group_id` (mantém linha de maior custo — artefacto do BigQuery export); upsert Supabase com ON CONFLICT DO NOTHING; 18 grupos únicos carregados
- **`a_data_sync.py`**: bloco completo de ad groups (sync_runs + operational_events + error handling); log final inclui `ad_groups=N`
- **`narrative/route.ts` — SECTION 5 [CREATIVE_CONTEXT]**: fetch paralelo `ad_group_summary` (ordered por `cost DESC`); 3 drains (cost > 0, conv = 0) + 2 top performers (ROAS ou CTR) injectados no user message
- **SYSTEM_PROMPT — `## Ad Group Intelligence — [CREATIVE_CONTEXT]`**: drain rule (cost > R$100 → citar nome explicitamente em `technical_diagnosis` + item obrigatório em `suggested_playbooks` com effort='low'); CTR < 1% → evidência "CTR crítico"; top performer (CTR > 10% + conv > 0) → `recommended_action`; Ad Strength signal (POOR/AVERAGE → qualidade criativa; GOOD/EXCELLENT → audiência/landing page; UNSPECIFIED → padrões vídeo CTR < 0,5%)
- **Validado:** 18 ad groups em `ad_group_summary`; SECTION 5 injectada com grupo 'B2B Exata' (drain) e top performers

`commit: [v4.3 commit hash]`

---

## v4.3.1 — Fix Agent Ordering + Drain Threshold Adjustment

**Problema 1:** `.order("date", desc=True)` em `a_data_sync.py` causava erro não-fatal `column campaign_summary.date does not exist` em cada execução do pipeline — bloco `agent_decisions` falhava silenciosamente.  
**Fix:** `.order("date_range_end", desc=True)` — coluna correcta para obter as campanhas mais recentes.

**Problema 2:** Limiar R$500 na regra de drain do Ad Group Intelligence era alto demais — maior drain activo ('B2B Exata', ~R$200) nunca atingia o threshold; regra nunca disparava.  
**Fix:** Limiar baixado de R$500 → R$100 em dois pontos do SYSTEM_PROMPT em `narrative/route.ts`.

**Docs:** `changelog.md`, `frontend.md`, `architecture.md` actualizados para v4.3.1.

`commit: feat(v4.3.1): fix agent ordering, adjust drain threshold and update docs`

---

## v4.4 — Landing Page Critic: HTTP Probe + SECTION 6 [LP_HEALTH]

**Entregues:**
- **Migration 017** (`017_ad_group_summary_url.sql`): `ADD COLUMN IF NOT EXISTS final_url TEXT, http_status_code INTEGER, load_time_ms INTEGER` em `ad_group_summary`
- **`sync_ad_groups()` em `sync_ads.py`**: BigQuery CTE extrai `final_url` via `ARRAY_AGG(ad_group_ad_ad_final_urls[SAFE_OFFSET(0)] IGNORE NULLS LIMIT 1)`; `_probe_url()` faz HEAD request (urllib.request stdlib, timeout 8s) por URL única; armazena `http_status_code` + `load_time_ms`; NULL para PMax/Display
- **`narrative/route.ts`**: tipo `LandingPageRow`; 5º fetch paralelo de `ad_group_summary WHERE final_url IS NOT NULL`; dedup por URL; `buildUserMessage()` gera SECTION 6 `[LP_HEALTH]`; SYSTEM_PROMPT `## Landing Page Critic` com 4 regras: 404+R$100 → P1 obrigatório, load>3s+R$100 → medium confidence, todas 2xx → sem ruído, N/A → inconclusivo; ponto 11 em `## Your role`

**Comportamento:**
- URL com 404 + custo > R$100 → P1, `technical_diagnosis` cita URL, `suggested_playbooks` inclui redirect com `effort='low'`
- Status N/A (WAF ou timeout) → tratado como inconclusivo, não eleva prioridade
- PMax/Display → `final_url=NULL` → skip probe → graceful

`commit: 0ab80e5`

---

## v4.5 — Multi-Tenant Agency Model + Pigz Onboarding

**Entregues:**

**Arquitectura multi-tenant (superadmin):**
- `profiles.role='superadmin'` — bypass de workspace via `SUPABASE_SERVICE_KEY` (Plan B)
- `frontend/src/lib/resolve-workspace.ts` — `resolveWorkspace()` partilhado: cookie `synapseiq_workspace` → DB lookup; substitui 4 implementações inline nas routes `/api/agents/action`, `/api/agents/decisions`, `/api/ai/narrative`, `/api/connectors/status`
- `frontend/src/utils/supabase/admin.ts` — `createAdminClient()` server-only, nunca `NEXT_PUBLIC_`
- `/api/admin/workspaces` — lista todos os workspaces (superadmin only, via `SUPABASE_SERVICE_KEY`)
- `/api/workspaces/switch` — define cookie `synapseiq_workspace` com `workspace_id` escolhido
- `Sidebar.tsx` — dropdown workspace switcher visível apenas para `role='superadmin'`

**Backend multi-tenant:**
- `WOKE_WORKSPACE_ID` → `WORKSPACE_ID` em `config.py` e 7 ficheiros backend
- `sync_ads.py`: `_parse_final_url()` normaliza esquemas STRING vs REPEATED do BigQuery export; fallback `MAX()` para tenants com `final_urls` como STRING (Pigz); `ANY_VALUE(str.final_url)` no GROUP BY externo

**Pigz onboarding:**
- `.github/workflows/sync_data_pigz.yml` — cron `30 9 * * *` (06:30 BRT); `WORKSPACE_ID: 63fd5033`, `GOOGLE_ADS_CUSTOMER_ID: 8378967509`, `GOOGLE_ADS_DATASET: raw_google_ads_pigz`
- `.github/workflows/sync_data_cacau.yml` — cron `0 10 * * *` (07:00 BRT); `WORKSPACE_ID: b7126974`, `GOOGLE_ADS_CUSTOMER_ID: 7184417498`, `GOOGLE_ADS_DATASET: raw_google_ads_cacau`
- `governance/tenants/pigz_measurement_config.yml` + `cacau_measurement_config.yml` — configs de governança por tenant
- **Validado:** Pigz pipeline — 7 campanhas, 10 ad_groups, 26 keywords

`commit: 8c5684b`
