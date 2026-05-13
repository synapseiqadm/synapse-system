# Frontend — SynapseIQ

**Framework:** Next.js 16.2.5 (Turbopack) · React 19 · TypeScript 5

---

## Dependências

| Pacote | Versão | Uso |
|---|---|---|
| `next` | 16.2.5 | Framework (Turbopack) |
| `@supabase/ssr` | 0.10.2 | Auth SSR |
| `@supabase/supabase-js` | 2.105.3 | Cliente DB |
| `recharts` | 3.x | Gráficos (MomentumChart, AreaChart) |
| `lucide-react` | 1.x | Ícones |
| `tailwindcss` | 4.x | Estilos |

**Nota:** `@supabase/ssr@0.10.2` não reconhece formato `sb_publishable_...` — usa JWT legacy (`eyJ...`).

---

## Rotas de Página

| Rota | Estado | Descrição |
|---|---|---|
| `/` | Static + Redirect | Redireciona para `/dashboard` |
| `/login` | Static | Auth email/password via Supabase |
| `/dashboard` | Client Component | Painel principal — ExecutiveBoardView + tabs |
| `/agents` | Client Component | Centro de Operações — feed de decisões live + approve/reject |
| `/connectors` | Client Component | Central de Conectores — status live Google Ads + GA4 + tracking integrity banner |
| `/logs` | Client Component | Status do Sync — sync_runs live, cards de saúde |

---

## API Routes

| Rota | Método | Descrição |
|---|---|---|
| `/api/ai/narrative` | GET | Diagnóstico Gemini 2.5 Flash — snapshot delta + campaign data + governance (SECTION 4) + `probable_causes[]` |
| `/api/agents/decisions` | GET | Lê `agent_decisions`; fallback on-the-fly de `campaign_summary`; inclui `probableCauses` determinísticos |
| `/api/agents/action` | PATCH | Persiste `approved`/`rejected` em `agent_decisions` por `dbId` |
| `/api/connectors/status` | GET | Status live de Google Ads + GA4 via `sync_runs`; tracking issues de `data_quality_report` |
| `/api/cron/guardian` | GET | Vercel Cron — alertas P1 via Resend; auth: `Authorization: Bearer <CRON_SECRET>` |
| `/api/workspaces/[id]/growth/overview` | GET | GA4 + campaign + quality + insights |
| `/api/workspaces/[id]/growth/funnel` | GET | `ga4_first_light_summary` |
| `/api/workspaces/[id]/growth/events` | GET | `ga4_first_light_summary` |
| `/api/workspaces/[id]/growth/paid-sessions` | GET | `data_quality_report` |
| `/api/workspaces/[id]/governance/summary` | GET | governance_runs + findings + evidence + quality |
| `/api/workspaces/[id]/governance/runs` | GET | `semantic_governance_runs` |
| `/api/workspaces/[id]/governance/findings` | GET | `semantic_governance_findings` |
| `/api/workspaces/[id]/governance/evidence` | GET | `semantic_governance_evidence` |
| `/api/workspaces/[id]/timeline` | GET | `operational_events` |

**Envelope de resposta** (todas as rotas `/api/workspaces/`):
```json
{
  "ok": true,
  "workspace_id": "<uuid>",
  "filters": { "limit": 100, "..." : "..." },
  "source_tables": ["tabela_a"],
  "generated_at": "2026-05-12T20:00:00.000Z",
  "warnings": [],
  "data": {}
}
```

---

## Autenticação

Implementada em três camadas:

1. **`src/proxy.ts`** (Edge Middleware) — intercepta todos os pedidos; redireciona não-autenticados para `/login`. Substituiu `middleware.ts` (convenção deprecada no Next.js 16).
2. **`src/utils/supabase/server.ts`** — cliente SSR para Server Components / API Routes.
3. **`src/utils/supabase/client.ts`** — cliente browser para `"use client"` components.

Resolução de workspace em API Routes:
```typescript
async function resolveWorkspace(supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("workspace_id").eq("id", user.id).single();
  // ...
  return { id, name, slug };
}
```

---

## Configuração de Workspace

`src/lib/workspace.ts` — fonte única do tenant activo:
```typescript
export const DEFAULT_WORKSPACE = {
  id:   process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_ID   || "<woke-uuid>",
  name: process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_NAME || "Woke People",
  slug: process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG || "woke",
};
```
Nenhum UUID de workspace está duplicado em ficheiros de componente.

---

## Componentes

| Componente | Descrição |
|---|---|
| `ExecutiveBoardView` | Painel Executivo (tab Geral): Health Strip, Prioridades, Performance Pulse (MomentumChart dual-axis, 4 métricas 2×2, seletor 7/15/30d, marcadores timeline), Domain Health, Timeline Operacional |
| `AINarrativeCard` | Card de diagnóstico IA: priority_score dots, insight_summary, technical_diagnosis, `probable_causes[]` com badges por camada, recommended_action; badge PREVIEW quando `is_simulated` |
| `ConnectorCard` | Card de conector: status badge (synced/pending/error/disconnected), lastSync, rowsLoaded, quality summary, botões sync/connect/disconnect |
| `GrowthIntelligenceView` | Tab Growth Intelligence: 7 secções (GA4, funil semântico, eventos, paid sessions, governance findings, evidence) via `Promise.allSettled` |
| `InsightsView` | Tab Insights: deduplicação por `dedupe_key`, group cards para `*_zero_conversions_with_cost`, mutual exclusion semântica, status analista |
| `DataQualityView` | Tab Qualidade: score 0–100, accordion por check, filtro por status |
| `AgentDecisionFeed` | Feed de decisões: filtro por tipo, approve/reject com PATCH + `router.refresh()` + `onRefresh()`, feedback optimista |
| `AgentCard` | Card de agente com status `preview` (oculta métricas de runtime) |
| `SyncRunsTable` | Tabela de execuções com linhas expansíveis, `LogStatusBadge`, empty state |
| `Sidebar` | Navegação hierárquica com badge de workspace, "Status do Sync", "Agentes de IA" com badge Preview |

---

## Dashboard — Estrutura de Tabs

```
/dashboard
├── Geral            → ExecutiveBoardView
├── Growth Intelligence → GrowthIntelligenceView
├── Campanhas
│   ├── Visão Geral  → grid de CampaignCard (ROAS, CTR, CPC)
│   └── Palavras-chave → tabela keyword_analysis com filtros
├── Qualidade        → DataQualityView
└── Insights         → InsightsView
```

---

## AI Narrative Route (`/api/ai/narrative`)

Chama Gemini 2.5 Flash REST API directamente (não usa SDK Python):

```typescript
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
```

Parâmetros: `responseMimeType: "application/json"`, `temperature: 0.2`, `maxOutputTokens: 2048`, `thinkingConfig: { thinkingBudget: 0 }`.

Guard: `if (!GEMINI_API_KEY) return 503` — dispara antes do auth check.

Workspace resolution: `resolveWorkspace()` → 401 se sem sessão → 200 + JSON diagnóstico se autenticado.

**Payload — 4 secções injectadas no user message:**

| Secção | Fonte | Conteúdo |
|---|---|---|
| SECTION 1 | `campaign_summary` | `campaign_name · spend · conversions · CPA · ROAS [· budget_total quando disponível]` |
| SECTION 2 | Derivação on-the-fly | Campanhas com spend > 0 e conversões = 0 (CRITICAL se total > R$500) |
| SECTION 3 | `fn_campaign_snapshot_delta` | Delta D-1 vs D-8 por métrica, filtro `ABS(delta) > 15%` |
| SECTION 4 | `data_quality_report` | Findings failed/warning — `[TRACKING]` / `[DATA]` / `[SEMANTIC]` |

**SYSTEM_PROMPT — Framework de diagnóstico:**
- **P1/P2/P3** — classificação de prioridade com impacto em BRL obrigatório para P1/P2
- **Layer 0 — Tracking Integrity** — avaliado antes de qualquer padrão de performance; falhas `[TRACKING]` elevam para P1
- **Causal pattern library** — HIGH-RESOLUTION (CTR/CPC) + BASELINE
- **`probable_causes[]`** — array estruturado: `layer | confidence | cause | evidence`; tracking sempre primeiro; máx 3 items

**Output JSON:**
```typescript
{
  insight_summary:     string;   // pt-BR, max 100 chars
  technical_diagnosis: string;   // English, 2–3 sentences
  recommended_action:  string;   // pt-BR, executable
  priority_score:      1 | 2 | 3 | 4 | 5;
  probable_causes:     ProbableCause[];
  is_simulated:        false;
}
```

---

## Agents Route (`/api/agents/decisions`)

Padrão primário/fallback:
1. **Primário:** lê `agent_decisions` ordenado por `created_at DESC`, limit 50; mapeia `row.id → dbId`.
2. **Fallback:** se tabela vazia → derivação on-the-fly de `campaign_summary` + `operational_events` (sem `dbId`).

Guard de aprovação: `if (d.dbId)` — sem `dbId`, PATCH não é chamado.

---

## Tipos TypeScript

| Ficheiro | Tipos |
|---|---|
| `src/types/growth.ts` | `ApiQueryFilters`, `GrowthOverviewResponse`, `CampaignSummaryContract`, `GrowthFunnelResponse`, ... |
| `src/types/governance.ts` | `GovernanceRun`, `GovernanceFinding`, `GovernanceEvidence`, `GovernanceSummaryResponse`, ... |
| `src/components/AgentDecisionFeed.tsx` | `Decision`, `DecisionType`, `DecisionStatus`, `ProbableCause`, `CauseConfidence`, `CauseLayer` (exportados) |
| `src/components/AgentCard.tsx` | `Agent`, `AgentStatus` (exportados) |

**`ProbableCause`** (em `AgentDecisionFeed.tsx`):
```typescript
interface ProbableCause {
  confidence: "high" | "medium" | "low";   // badge ALTA / MÉD / BAIXA
  layer:      "tracking" | "creative" | "audience" | "landing" | "budget";
  cause:      string;   // ex: "Tracking quebrado"
  evidence:   string;   // ex: "GA4 sessions = 0, Ads clicks = 847"
}
```
Derivação determinística em `/api/agents/decisions`: GA4 sessions (tracking) → CTR médio (creative) → governance findings (tracking/qualidade) → fallback landing page. Sem chamada Gemini.

---

## Lib Helpers

| Ficheiro | Funções principais |
|---|---|
| `lib/api/common.ts` | `handleApiRoute`, `makeEnvelope`, `parseApiFilters`, `validateWorkspaceId`, `readRows` |
| `lib/api/sync_runs.ts` | `computeHealth`, `latestPerExpectedSource`, `timeAgo`, `mapBadgeStatus` |
| `lib/funnel.ts` | `computeFunnelIntelligence`, `isSuspiciousEventName` |
| `lib/decision.ts` | `computeDecisionBrief` |
| `lib/measurementConfig.ts` | `EVENT_FUNNEL_MAP`, `getConfiguredFunnelStep` |
| `lib/semanticRegistry.ts` | Espelho estático do `semantic_registry.yml` para uso no frontend |
| `lib/mail.ts` | `sendGuardianAlert(payload)` via Resend SDK; mock logger (sem throw) se `RESEND_API_KEY` ausente; template HTML dark theme |
