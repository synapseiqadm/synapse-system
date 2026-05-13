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
