# SynapseIQ — Semantic Model

**Version:** 1.0 (v1.3.1)  
**Date:** May 2026  
**Status:** Canonical reference — read before adding new checks, insights, or AI agent prompts.

---

## Core Rule

> **Observed data ≠ technical check ≠ semantic finding ≠ evidence ≠ deterministic insight ≠ AI recommendation ≠ client-validated decision.**

Each concept lives at a different layer of the stack, has different confidence and authority, and must never be presented or consumed as equivalent to another.

---

## Concept Glossary

### 1. Observed Data

**What it is:** Raw measurements ingested from a source platform — GA4 events, Google Ads campaign metrics, landing page URLs, UTM parameters. These are facts about what happened, with no judgment attached.

**Where it lives:** BigQuery (GA4 raw tables), Supabase (`ga4_first_light_summary`, `campaign_summary`, `keyword_analysis`).

**What it is not:** A check result, a finding, or a business decision. Observed data describes volume and presence; it does not classify quality or business meaning.

**UI treatment:** Display as-is with source and period labels. Never imply correctness from volume alone.

**AI agent treatment:** Use as evidence inputs to checks. Never generate recommendations directly from raw counts without routing through a semantic check first.

---

### 2. Technical Data Quality Check

**What it is:** A deterministic rule applied to observed data to verify structural and operational integrity. Checks A–K in `data_quality.py`. Examples: missing campaign IDs, stale GA4 tables, zero-conversion campaigns with cost.

**Where it lives:** `backend/connectors/data_quality.py` → `data_quality_report` table.

**What it is not:** A semantic judgment about business meaning. A campaign with `status=passed` on a freshness check is not necessarily effective.

**UI treatment:** Display in the Data Quality view with score, badge, and details accordion. Do not use in the Growth Intelligence semantic sections.

**AI agent treatment:** Use as data health pre-conditions before running semantic analysis. If a technical check fails critically, flag data as unreliable before interpreting semantic findings.

---

### 3. Semantic Check

**What it is:** A rule that crosses multiple data sources to evaluate whether the measurement setup reflects business intent. Checks L–S in `semantic_governance.py`. Examples: GA4↔Ads overlap, conversion registry mismatch, UTM coverage.

**Where it lives:** `backend/connectors/semantic_governance.py` → `semantic_governance_findings` table. Metadata: `backend/governance/semantic_registry.yml`.

**What it is not:** A definitive business verdict. A semantic check result is an observation about the measurement layer — not about campaign performance.

**UI treatment:** Show in the Growth Intelligence "Findings Semânticos" section. Group by check_name (latest run). Display status badge, severity, affected rows, evidence accordion. Show "Em revisão" badge for checks with `requires_client_validation: true`.

**AI agent treatment:** Consume only checks listed in the semantic registry. Never invent new check semantics at inference time. Flag `requires_client_validation: true` checks for human review before acting on them.

---

### 4. Semantic Finding

**What it is:** The persisted result of a specific semantic check run — one row in `semantic_governance_findings`. Contains the check name, status, severity, affected rows, and JSONB details for the period.

**Where it lives:** Supabase `semantic_governance_findings`.

**What it is not:** An insight or recommendation. Multiple findings of the same check across runs represent recurrence, not severity escalation.

**UI treatment:** Deduplicate by `check_name` (show most recent run as primary). Show recurrence badge ("X runs") and history accordion for older entries.

**AI agent treatment:** Read findings as structured check results. Do not re-interpret the severity; use the registry's `severity_default` as the canonical value. Do not summarize multiple findings of the same check as "N distinct problems."

---

### 5. Evidence

**What it is:** A list-type decomposition of finding details — one row per individual item (e.g., one unregistered Ads action, one suspicious event name). Extracted from the `details` JSONB by the pipeline. Capped at 25 rows per finding per list key.

**Where it lives:** Supabase `semantic_governance_evidence`.

**What it is not:** An independent data quality signal. Evidence items are sub-components of a finding; they cannot be interpreted without the parent finding's context.

**UI treatment:** Show in the "Evidências Técnicas" accordion (collapsed by default). Display `evidence_type`, parent `check_name`, and truncated `evidence_data` JSON. Limit to 50 items rendered.

**AI agent treatment:** Use evidence items to build context for recommendations. Never surface individual evidence items as top-level findings. Always attribute evidence to its parent finding and check.

---

### 6. Insight

**What it is:** A deterministic rule-based observation about a business condition, generated from the results of data quality and semantic checks. Non-LLM. Generated by `insights.py`. Upserted with deduplication; respects analyst status (reviewed/dismissed/resolved).

**Where it lives:** Supabase `insight_feed`.

**What it is not:** An AI opinion. Insights are deterministic — they fire when specific conditions are met and resolve when they clear. They do not carry confidence scores beyond what the rule encodes.

**UI treatment:** Show in the Insights view with title, summary, recommendation, and status controls (Revisar → Resolver / Descartar / Reabrir). Microcopy: "Estes insights são determinísticos e baseados em regras."

**AI agent treatment:** Use insights as structured business signals. Never override analyst-assigned status (reviewed/dismissed/resolved). Only generate new insights for check types listed in the registry with `can_generate_insight: true`.

---

### 7. Recommendation

**What it is:** An actionable suggestion derived from one or more findings and insights, potentially generated by an AI agent. Unlike insights, recommendations may be probabilistic and context-sensitive.

**Where it lives:** Not yet persisted. Future: a dedicated `recommendation_feed` table (v1.5+).

**What it is not:** A decision. Recommendations are advisory. They require human review before any budget or campaign change.

**UI treatment (future):** Display with explicit confidence level, source reasoning, and a "Aceitar / Descartar" control. Never auto-apply.

**AI agent treatment:** Generate only when the triggering finding has `can_generate_insight: true` in the registry. Always cite the source finding and check name. Flag if any input finding has `requires_client_validation: true`.

---

### 8. Conversion Candidate

**What it is:** A GA4 event or Ads conversion action that has been observed in real data and is structurally consistent with being a conversion, but has NOT been validated as the official KPI by the client.

**Where it lives:** `conversion_registry` in `woke_measurement_config.yml` with `business_status: "candidate"` or `status: "observed"`.

**What it is not:** A validated conversion. Treating a candidate as a confirmed conversion would inflate reported KPIs.

**UI treatment:** Show as "candidato a conversão" with italic disclaimer: "Eventos candidatos a conversão refletem o mapeamento semântico atual. A conversão definitiva depende de validação explícita do cliente."

**AI agent treatment:** Never count candidates in conversion totals. Reference as "potential conversion event" with explicit caveat. Do not use as primary KPI input.

---

### 9. Validated Conversion

**What it is:** A GA4 event or Ads conversion action that the client has explicitly confirmed as the official conversion KPI for the workspace.

**Where it lives:** `conversion_registry` with `business_status: "validated"` (not yet present for Woke as of v1.3.1).

**What it is not:** Assumed by SynapseIQ. The system cannot unilaterally designate a validated conversion — only the client can.

**UI treatment:** Display without disclaimer once validated. Use in KPI cards with full confidence.

**AI agent treatment:** Only treat as conversion KPI when `business_status: "validated"` is present in the registry. Refuse to hardcode conversion event names in prompts.

---

### 10. Review Required

**What it is:** A flag on an Ads conversion action or GA4 event indicating that the current configuration requires explicit semantic review before use as a KPI or in attribution reporting.

**Where it lives:** `requires_client_validation: true` in the registry and in `woke_measurement_config.yml`. Surfaces via the `ads_conversion_action_semantic_review_required` check (check O).

**What it is not:** A blocking error. The pipeline continues; the flag is visible but non-breaking.

**UI treatment:** Display "Em revisão" badge (violet) on findings. Do not suppress the data — show it with the badge.

**AI agent treatment:** Escalate to human review before including the flagged item in any recommendation or attribution report. Do not silently use a review-required conversion in calculations.

---

### 11. Funnel Step

**What it is:** A semantic classification of a GA4 event into one of five ordered stages: `acquisition` → `landing` → `engagement` → `intent` → `conversion`. Defined in the growth API's funnel mapping.

**Where it lives:** Mapping in `frontend/src/lib/api/growth.ts` (FUNNEL_STEP_MAP). Display labels in `GrowthIntelligenceView.tsx` (FUNNEL_STEP_LABELS).

**What it is not:** A hard business boundary. The current mapping is based on observed event semantics and is provisional until the conversion step is validated.

**UI treatment:** Show as colored badge per step. Add conversion disclaimer for events in the `conversion` step that are candidates.

**AI agent treatment:** Use funnel steps as navigation structure for session analysis. Always check whether the conversion step events are candidates or validated before reporting conversion rates.

---

### 12. Source Event

**What it is:** A raw GA4 event exactly as it appears in BigQuery — identified by `event_name`, with no semantic classification applied.

**Where it lives:** BigQuery GA4 raw tables (`events_YYYYMMDD`).

**What it is not:** A business event. A source event named `form_start` may or may not represent meaningful user intent depending on context.

**UI treatment:** Display in top events list with count. No business label unless the event is in the conversion registry.

**AI agent treatment:** Always map to registry before interpreting. Unknown source events should be flagged as "unmapped" — never assigned business meaning at inference time.

---

### 13. Business Event

**What it is:** A source event that has been mapped to a business concept through the semantic registry, with an assigned `funnel_stage`, `business_status`, and `provisional_role`.

**Where it lives:** `conversion_registry` in `woke_measurement_config.yml`.

**What it is not:** Interchangeable with a source event. Two source events may map to the same business concept (aliases), or the same event name may carry different business meaning in different tenants.

**UI treatment:** Display the business label (from registry) alongside the technical event name. Show `provisional_role` as tooltip or sub-label when not yet validated.

**AI agent treatment:** Always resolve business events through the registry. Never assume event names carry the same semantics across tenants. The registry is per-tenant.

---

## Concept Boundaries — Quick Reference

| Layer | Lives in | Confidence | Who decides |
|---|---|---|---|
| Observed Data | BigQuery / Supabase raw tables | None — neutral | Source platform |
| Technical Check | `data_quality_report` | Deterministic rule | Pipeline |
| Semantic Check | `semantic_governance_findings` | Deterministic rule | Pipeline + registry |
| Evidence | `semantic_governance_evidence` | Sub-component of finding | Pipeline |
| Insight | `insight_feed` | Deterministic rule | Pipeline |
| Recommendation | (future) | Probabilistic | AI agent (advisory only) |
| Conversion Candidate | `conversion_registry` | Structural observation | SynapseIQ (provisional) |
| Validated Conversion | `conversion_registry` | Confirmed | **Client only** |
| Review Required | `semantic_registry.yml` flag | N/A | Client + SynapseIQ jointly |

---

## Registry Integrity Rule

> **No frontend component, deterministic insight generator, or AI agent may create a `label`, `business_impact`, or `recommended_action` for a check without reading `semantic_registry.yml` first.**

| Situation | Required behavior |
|---|---|
| `check_name` found in registry | Use `label`, `description`, `business_impact`, `recommended_action` from the registry as the canonical source. Do not override or supplement with hardcoded strings. |
| `check_name` **not** found in registry | Display the raw technical name as a fallback. Tag the item `registry_missing` in the UI. Do not invent a label or recommendation. |
| `requires_client_validation_when_warning: true` and result is `warning` | Escalate to human review before surfacing any recommendation. Do not auto-apply. |

**Applies to:**
- React components that render findings or insights (`FindingsSection`, `InsightsView`, future recommendation views)
- `insights.py` when adding new semantic insight types
- Any AI agent generating recommendations from finding results

**Why this rule exists:** the registry is the single boundary between what the pipeline observed (a finding) and what the product communicates (a label and recommendation). Crossing that boundary without the registry produces labels that diverge across versions, across layers, and across tenants — the exact semantic drift this model was created to prevent.

---

## Registry Reference

Check metadata → `backend/governance/semantic_registry.yml`  
Tenant conversion registry → `backend/governance/tenants/woke_measurement_config.yml`  
Python loader → `backend/connectors/semantic_registry.py`
