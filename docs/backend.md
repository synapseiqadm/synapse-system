# Backend — SynapseIQ

**Stack:** Python 3.x · Supabase SDK · google-cloud-bigquery · google-genai · python-dotenv

**Venv:** `D:\dev\synapse\.venv\` (raiz do repositório, não dentro de `backend/`)

**Execução:**
```bash
# Validação sem escrita
.venv/Scripts/python.exe -m connectors.a_data_sync --dry-run

# Sync completo
.venv/Scripts/python.exe -m connectors.a_data_sync
```

---

## Módulos

### `config.py`
Carrega `.env` via `python-dotenv`. Snapshot `_PROCESS_ENV` antes de `load_dotenv()` (Windows remove variável ao definir `=""` — snapshot garante fail-fast correcto).

`required_env(name)` faz `sys.exit(1)` imediato se a variável estiver ausente.

**Variáveis expostas:**

| Variável | Descrição |
|---|---|
| `APP_ENV` | `production` \| `development` |
| `ALLOW_MOCK_DATA` | `false` em produção |
| `WOKE_WORKSPACE_ID` | UUID do workspace piloto |
| `GCP_PROJECT_ID` | Projecto GCP |
| `BQ_LOCATION` | `southamerica-east1` |
| `GOOGLE_ADS_DATASET` | Dataset BigQuery Google Ads |
| `GOOGLE_ADS_CUSTOMER_ID` | ID do cliente Google Ads |
| `GA4_DATASET` | Dataset BigQuery GA4 (vazio em CI — pendente acesso service account) |
| `SUPABASE_URL` | URL do projecto Supabase |
| `SUPABASE_SERVICE_KEY` | Chave service — nunca no frontend |
| `DATE_RANGE_START` / `DATE_RANGE_END` | Período a sincronizar |
| `INSIGHT_MIN_CAMPAIGN_COST` | Threshold de custo mínimo para insights (default 50) |
| `INSIGHT_MIN_KEYWORD_COST` | Threshold de custo mínimo para insights (default 20) |
| `ENABLE_INSIGHTS` | Activa geração de insights (default true) |
| `MEASUREMENT_CONFIG_PATH` | Path do YAML de governance do tenant |

---

### `sync_runs.py`
Auditoria de execuções do pipeline.

- `start_sync_run(supabase, workspace_id, source_platform, data_source, ...)` → UUID do run
- `finish_sync_run_success(supabase, run_id, rows_loaded)`
- `finish_sync_run_error(supabase, run_id, error_message)`

---

### `sync_ads.py`
BigQuery → Supabase para dados de Google Ads.

- `sync_campaigns(bq_client, supabase, dry_run)` → UPSERT em `campaign_summary` (inclui clicks, impressions, ctr)
- `sync_kpi_cache_daily(bq_client, supabase, dry_run)` → UPSERT em `kpi_cache_daily` (total_cost, conversions, roas por dia)
- `sync_keywords(bq_client, supabase, dry_run)` → UPSERT em `keyword_analysis`
- `ga4_real_data_available(bq_client, ga4_dataset)` → verifica `INFORMATION_SCHEMA.TABLES`
- `can_use_mock_data(app_env, allow_mock)` → bloqueia mock em `production`

---

### `sync_ga4.py`
GA4 First Light (dados resumidos de eventos GA4).

- `get_ga4_tables(bq_client, ga4_dataset)` → lista ordenada de tabelas `events_YYYYMMDD`
- `get_ga4_first_light_summary(bq_client, ga4_dataset, tables)` → dict com total_events, sessions, top_events, conversion_events, etc.
- `sync_ga4_first_light(bq_client, supabase, dry_run, tables, summary)` → UPSERT em `ga4_first_light_summary`
- `GA4_CONVERSION_EVENTS` — lista de eventos de conversão esperados (atenção: divergência com `canonical_events` no YAML — ver dívida técnica em `docs/changelog.md` v1.4.1)

---

### `data_quality.py`
Executa 19 checks de qualidade e escreve em `data_quality_report` via INSERT (cada execução = novo snapshot).

**Checks Google Ads (A–F):**
- A — `campaign_summary_missing_campaign_id`
- B — `campaign_summary_zero_conversions_with_cost`
- C — `keyword_analysis_zero_conversions_with_cost`
- D — `campaign_summary_freshness`
- E — `keyword_analysis_freshness`
- F — `mock_data_presence`

**Checks GA4 (G–K):**
- G — `ga4_dataset_available`
- H — `ga4_events_freshness`
- I — `ga4_has_page_view`
- J — `ga4_has_session_start`
- K — `ga4_has_conversion_events`

**Checks Semantic Governance (L–S):** delegados a `semantic_governance.run_semantic_quality_checks()`.

---

### `insights.py`
Gera insights determinísticos (sem LLM) e faz upsert em `insight_feed`.

**Tipos determinísticos:**
- `campaign_zero_conversions_with_cost`
- `keyword_zero_conversions_with_cost`
- `data_quality_warning_context`
- `ga4_configured_but_no_conversion_events`
- `ga4_not_configured`

**Tipos semânticos** (de `semantic_governance.generate_semantic_insights()`):
- `ga4_ads_overlap_insufficient`, `ads_conversion_action_semantic_review_required`, `paid_sessions_without_funnel_progress`, `utm_campaign_empty_in_paid_urls`

`resolve_obsolete_insights(supabase, insight_type, dry_run)` — marca como `resolved` insights cujas condições desapareceram.

`dedupe_key` para keywords: `sha1[:16]` de `kw_zero_conv|campaign_id|keyword|match_type`.

---

### `semantic_governance.py`
- `load_measurement_config(path)` → carrega YAML do tenant; retorna `None` em qualquer erro (pipeline nunca interrompe)
- `classify_url_environment(url, domains_cfg)` → `"debug" | "local" | "staging" | "preview" | "production" | "unknown"` (prioridade: debug → local → staging → preview → production → unknown)
- `run_semantic_quality_checks(config, supabase, bq_client, ga4_dataset, ga4_tables, ga4_summary, dry_run)` → 8 checks L–S + persistência
- `generate_semantic_insights(config, semantic_dq_results)` → insights a partir de warnings/failed
- `MAX_EVIDENCE_ROWS_PER_FINDING = 25`
- `_PARAM_ALLOWLIST_RE = re.compile(r"^[a-zA-Z0-9_]+$")` — sanitização de parâmetros SQL

**8 Checks Semânticos:**
- L — `ga4_ads_overlap_insufficient`
- M — `ga4_conversion_registry_mismatch`
- N — `ads_conversion_action_not_in_registry`
- O — `ads_conversion_action_semantic_review_required`
- P — `ga4_non_production_traffic_detected`
- Q — `ga4_suspicious_event_names_detected`
- R — `paid_sessions_without_funnel_progress`
- S — `utm_campaign_empty_in_paid_urls`

---

### `semantic_registry.py`
- `load_semantic_registry(path)` → carrega `semantic_registry.yml`; retorno seguro em qualquer erro
- `get_check_metadata(registry, check_name)` → metadados canónicos de um check

---

### `operational_events.py`
- `record_operational_event(supabase, workspace_id, event_type, category, impact_scope, actor, occurred_at, dry_run)` — persiste sem lançar excepção (falha silenciosa com log)
- `detect_kpi_anomaly(supabase, workspace_id, dry_run, lookback_days=30, threshold=0.30)` — detecta desvio > 30% de ROAS vs média 30d; persiste em `operational_events` com `category="kpi_anomaly"`

---

### `timeline_engine.py`
- `get_operational_timeline(supabase, workspace_id, limit)` → eventos recentes de `operational_events`
- `get_kpi_diff(supabase, workspace_id)` → diff de KPI entre períodos
- `get_executive_momentum_data(supabase, workspace_id)` → dados para o Momentum Chart

---

### `ai_narrative.py`
Integração Gemini para geração de narrativas diagnósticas (usado em testes; em produção a chamada é feita pelo frontend via `narrative/route.ts`).

- `generate_narrative(snapshot_rows, workspace_name, is_simulated=False)` → dict com `insight_summary`, `technical_diagnosis`, `recommended_action`, `priority_score`, `_meta`
- Guard: `GEMINI_API_KEY` ausente → erro acionável
- `is_simulated=True` prefixo `[PREVIEW DE TESTE]` no `insight_summary`

---

### `agent_decisions.py`
Motor multi-agente. Gera decisões para a tabela `agent_decisions`.

```python
generate_agent_decisions(
    supabase,
    workspace_id: str,
    campaign_rows: list[dict],    # de campaign_summary, deduplicado
    snapshot_rows: list[dict],    # de fn_campaign_snapshot_delta
    dry_run: bool = False,
) -> int                          # número de rows inseridas
```

**Growth Master:** `roas >= 3.0 AND cost >= 50.0` → suggestion de escala 20%.
- dedupe_key: `f"growth-master-scale-{campaign_name}"`

**Creative Critic:** `metric_name == 'ctr' AND delta_percentage <= -15.0` → suggestion de revisão criativa.
- dedupe_key: `f"creative-critic-ctr-{campaign_name}"`

**Anomaly Scout:** `cost > 0 AND conversions == 0` → alert + suggestion de pausa.
- dedupe_keys: `"anomaly-scout-zero-conv"` e `"anomaly-scout-zero-conv-suggestion"`

Padrão insert-only: busca `dedupe_key`s existentes antes de inserir — nunca duplica.

---

### `a_data_sync.py` — Entry Point

Orquestra todos os módulos na seguinte ordem:

1. `start_sync_run` (auditoria)
2. `sync_campaigns` + `record_operational_event(sync_success)`
3. `sync_kpi_cache_daily` + `detect_kpi_anomaly`
4. `sync_keywords` + `record_operational_event(sync_success)`
5. `sync_ga4_first_light` (se GA4 disponível)
6. `run_data_quality_checks` (checks A–S)
7. `generate_insights` + `resolve_obsolete_insights`
8. `generate_agent_decisions` (Growth Master, Creative Critic, Anomaly Scout)
9. `finish_sync_run_success/error`

`ga4_tables` e `ga4_summary` são buscados uma única vez e passados por parâmetro — zero round-trips duplicados ao BigQuery.

---

## Governance YAML (`woke_measurement_config.yml`)

```yaml
conversion_registry:
  canonical_events: [...]
  intermediate_events: [...]
  intent_events: [...]
  ads_only_conversion_actions: [...]
  # cada evento tem: business_status, provisional_role, requires_client_validation

suspicious_events: [...]

domains:
  production: [...]
  staging: [...]
  local: [localhost, 127.0.0.1]

attribution:
  required_paid_url_params: [utm_source, utm_medium, utm_campaign, ...]
```

---

## Semantic Registry (`semantic_registry.yml`)

8 checks registados com: `label`, `category`, `severity_default`, `source_platform`, `description`, `business_impact`, `recommended_action`, `ui_group`, `evidence_types`, `can_generate_insight`, `requires_client_validation`.

**Regra:** nenhum frontend, insight ou agente deve inventar `label` ou `recommended_action` para um check sem consultar o registry. Checks ausentes do registry → exibir nome técnico com flag `registry_missing`.

---

## Testes

| Ficheiro | Cobertura |
|---|---|
| `backend/tests/test_semantic_governance.py` | 36 testes: deduplicação, config loading, classify_url_environment, check S multi-param, dry-run, evidência truncada |
| `backend/tests/test_ai_narrative.py` | 5 testes: mock pipeline (HIGH-RESOLUTION com CTR/CPC), missing key, invalid JSON, missing field, live API call |
