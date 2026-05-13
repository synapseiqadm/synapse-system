import os
import sys
import hashlib
from datetime import datetime, timezone

from supabase import Client

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from config import (
    WORKSPACE_ID,
    DATE_RANGE_START,
    DATE_RANGE_END,
    GA4_DATASET,
    INSIGHT_MIN_CAMPAIGN_COST,
    INSIGHT_MIN_KEYWORD_COST,
)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _dedupe_key(parts: list) -> str:
    """Short stable hash from a list of string parts. Used for keyword dedupe."""
    combined = "|".join(str(p) for p in parts)
    return hashlib.sha1(combined.encode()).hexdigest()[:16]


def _brl(value: float) -> str:
    """Format a float as pt-BR currency string (R$ 1.234,56)."""
    formatted = f"{value:,.2f}"               # US format: 1,234.56
    return "R$ " + formatted.replace(",", "X").replace(".", ",").replace("X", ".")


def _insight(
    insight_type: str,
    severity: str,
    title: str,
    summary: str,
    recommendation: str,
    evidence: dict,
    source_tables: list,
    confidence: float,
    dedupe_key: str,
) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "workspace_id":     WORKSPACE_ID,
        "insight_type":     insight_type,
        "severity":         severity,
        "status":           "new",
        "title":            title,
        "summary":          summary,
        "recommendation":   recommendation,
        "evidence":         evidence,
        "source_tables":    source_tables,
        "confidence":       confidence,
        "date_range_start": str(DATE_RANGE_START),
        "date_range_end":   str(DATE_RANGE_END),
        "dedupe_key":       dedupe_key,
        "updated_at":       now,
    }


# ── Data quality state ─────────────────────────────────────────────────────────

def get_previous_insight_state(supabase: Client, dedupe_key: str) -> dict | None:
    """
    Recupera o estado do mesmo insight no período anterior.
    Base para o 'Snapshot Diff Engine' (v1.8).
    """
    resp = (
        supabase.table("insight_feed")
        .select("evidence,severity,status,created_at")
        .eq("workspace_id", WORKSPACE_ID)
        .eq("dedupe_key", dedupe_key)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None

def get_latest_data_quality_state(supabase: Client) -> dict:
    """
    Returns aggregated state from the most recent execution of each check.
    Reads from data_quality_report ordered by checked_at desc, deduplicates
    by check_name keeping the freshest row.
    """
    resp = (
        supabase.table("data_quality_report")
        .select("check_name,status,severity,checked_at")
        .eq("workspace_id", WORKSPACE_ID)
        .order("checked_at", desc=True)
        .limit(100)
        .execute()
    )
    rows = resp.data or []

    seen: dict = {}
    for row in rows:
        name = row["check_name"]
        if name not in seen or row["checked_at"] > seen[name]["checked_at"]:
            seen[name] = row
    latest = list(seen.values())

    warnings    = [r for r in latest if r["status"] == "warning"]
    failed      = [r for r in latest if r["status"] == "failed"]
    critical    = [r for r in failed  if r["severity"] == "critical"]
    failed_high = [r for r in failed  if r["severity"] == "high"]

    latest_checked_at = max((r["checked_at"] for r in latest), default=None)

    return {
        "all_checks":       latest,
        "warnings":         warnings,
        "failed":           failed,
        "critical":         critical,
        "failed_high":      failed_high,
        "warning_count":    len(warnings),
        "failed_count":     len(failed),
        "critical_count":   len(critical),
        "latest_checked_at": latest_checked_at,
    }


def should_block_insights(dq_state: dict) -> bool:
    """Block performance insights when there is at least one critical quality failure."""
    return dq_state["critical_count"] > 0


# ── Individual generators ──────────────────────────────────────────────────────

def generate_campaign_zero_conversion_insights(
    supabase: Client, dq_state: dict
) -> list:
    """Insight A — campaigns with cost >= threshold and zero conversions."""
    resp = (
        supabase.table("campaign_summary")
        .select("campaign_id,campaign_name,cost,conversions,roas")
        .eq("workspace_id", WORKSPACE_ID)
        .gte("date_range_start", str(DATE_RANGE_START))
        .lte("date_range_end",   str(DATE_RANGE_END))
        .gte("cost", INSIGHT_MIN_CAMPAIGN_COST)
        .eq("conversions", 0)
        .eq("is_mock", False)
        .order("cost", desc=True)
        .execute()
    )
    rows = resp.data or []
    insights = []
    for row in rows:
        cost      = float(row["cost"])
        severity  = "high" if cost >= 500 else "medium"
        dedupe    = f"campaign_zero_conv_{row['campaign_id']}"
        insights.append(_insight(
            insight_type   = "campaign_zero_conversions_with_cost",
            severity       = severity,
            title          = "Campanha com custo e zero conversões",
            summary        = (
                f"A campanha \"{row['campaign_name']}\" consumiu {_brl(cost)} "
                f"no período analisado e não registrou conversões."
            ),
            recommendation = (
                "Revisar termos de busca, segmentação, criativos e landing page "
                "antes de aumentar investimento."
            ),
            evidence       = {
                "campaign_id":       row["campaign_id"],
                "campaign_name":     row["campaign_name"],
                "cost":              cost,
                "conversions":       float(row["conversions"]),
                "roas":              float(row["roas"]) if row["roas"] is not None else None,
                "date_range_start":  str(DATE_RANGE_START),
                "date_range_end":    str(DATE_RANGE_END),
            },
            source_tables  = ["campaign_summary", "data_quality_report"],
            confidence     = 0.85,
            dedupe_key     = dedupe,
        ))
    return insights


def generate_keyword_zero_conversion_insights(
    supabase: Client, dq_state: dict
) -> list:
    """Insight B — keywords with cost >= threshold and zero conversions."""
    resp = (
        supabase.table("keyword_analysis")
        .select("campaign_id,campaign_name,keyword,match_type,cost,conversions")
        .eq("workspace_id", WORKSPACE_ID)
        .gte("date_range_start", str(DATE_RANGE_START))
        .lte("date_range_end",   str(DATE_RANGE_END))
        .gte("cost", INSIGHT_MIN_KEYWORD_COST)
        .eq("conversions", 0)
        .eq("is_mock", False)
        .order("cost", desc=True)
        .execute()
    )
    rows = resp.data or []
    insights = []
    for row in rows:
        cost     = float(row["cost"])
        severity = "high" if cost >= 200 else "medium"
        dedupe   = _dedupe_key([
            "kw_zero_conv",
            row.get("campaign_id", ""),
            row["keyword"],
            row["match_type"],
        ])
        insights.append(_insight(
            insight_type   = "keyword_zero_conversions_with_cost",
            severity       = severity,
            title          = "Keyword com custo e zero conversões",
            summary        = (
                f"A keyword \"{row['keyword']}\" consumiu {_brl(cost)} "
                f"no período analisado e não gerou conversões."
            ),
            recommendation = (
                "Avaliar intenção de busca, correspondência, termos negativos e "
                "alinhamento com a landing page."
            ),
            evidence       = {
                "campaign_name":    row["campaign_name"],
                "keyword":          row["keyword"],
                "match_type":       row["match_type"],
                "cost":             cost,
                "conversions":      float(row["conversions"]),
                "date_range_start": str(DATE_RANGE_START),
                "date_range_end":   str(DATE_RANGE_END),
            },
            source_tables  = ["keyword_analysis", "data_quality_report"],
            confidence     = 0.80,
            dedupe_key     = dedupe,
        ))
    return insights


def generate_data_quality_context_insight(dq_state: dict) -> list:
    """Insight C — contextual warning when data quality checks have issues."""
    if dq_state["warning_count"] == 0 and dq_state["failed_count"] == 0:
        return []

    affected = [r["check_name"] for r in dq_state["warnings"] + dq_state["failed"]]
    severity = "high" if dq_state["critical_count"] > 0 else "medium"

    return [_insight(
        insight_type   = "data_quality_warning_context",
        severity       = severity,
        title          = "Dados exigem atenção antes da análise",
        summary        = (
            "Foram encontrados warnings de qualidade nos dados. "
            "Isso não indica falha técnica, mas exige cautela na leitura dos resultados."
        ),
        recommendation = (
            "Revisar os checks de qualidade antes de tomar decisões "
            "estratégicas ou operacionais."
        ),
        evidence       = {
            "warning_count":      dq_state["warning_count"],
            "failed_count":       dq_state["failed_count"],
            "critical_count":     dq_state["critical_count"],
            "affected_checks":    affected,
            "latest_checked_at":  dq_state["latest_checked_at"],
        },
        source_tables  = ["data_quality_report"],
        confidence     = 0.90,
        dedupe_key     = "dq_warning_context",
    )]


def resolve_obsolete_insights(
    supabase: Client,
    insight_type: str,
    dry_run: bool = False,
) -> int:
    """
    Mark all 'new' insights of the given type across ALL periods as 'resolved'.
    Used to retire stale informational insights when the underlying condition
    has been remediated (e.g. ga4_not_configured → GA4 is now configured).

    Returns the number of rows updated (or that would be updated in dry-run).
    """
    resp = (
        supabase.table("insight_feed")
        .select("id,dedupe_key,date_range_start,date_range_end")
        .eq("workspace_id", WORKSPACE_ID)
        .eq("insight_type", insight_type)
        .eq("status", "new")
        .execute()
    )
    rows = resp.data or []
    if not rows:
        return 0

    if dry_run:
        print(
            f"[insights] --dry-run: would resolve {len(rows)} '{insight_type}' insight(s)",
            flush=True,
        )
        for r in rows:
            print(
                f"  resolve {r['dedupe_key']} "
                f"({r['date_range_start']}..{r['date_range_end']})",
                flush=True,
            )
        return len(rows)

    ids = [r["id"] for r in rows]
    supabase.table("insight_feed").update({"status": "resolved"}).in_("id", ids).execute()
    print(
        f"[insights] resolved {len(ids)} obsolete '{insight_type}' insight(s)",
        flush=True,
    )
    return len(ids)


def generate_ga4_no_conversion_events_insight(
    ga4_dataset: str,
    ga4_summary: dict,
) -> list:
    """Insight E — GA4 available but none of the expected conversion events found."""
    conversion_events = ga4_summary.get("conversion_events", {})
    if any(v > 0 for v in conversion_events.values()):
        return []

    return [_insight(
        insight_type   = "ga4_configured_but_no_conversion_events",
        severity       = "medium",
        title          = "GA4 disponível, mas nenhum evento de conversão encontrado",
        summary        = (
            f"O dataset GA4 '{ga4_dataset}' está ativo e com dados no período, "
            "mas nenhum dos eventos de conversão esperados foi registrado."
        ),
        recommendation = (
            "Revisar o contrato de eventos no GTM, as configurações de conversão "
            "no GA4 e o Growth Measurement Playbook para garantir que os eventos "
            "estão sendo disparados e mapeados corretamente."
        ),
        evidence       = {
            "ga4_dataset":        ga4_dataset,
            "expected_events":    list(conversion_events.keys()),
            "conversion_events":  conversion_events,
            "date_range_start":   str(DATE_RANGE_START),
            "date_range_end":     str(DATE_RANGE_END),
        },
        source_tables  = ["ga4_first_light_summary"],
        confidence     = 0.80,
        dedupe_key     = "ga4_no_conversion_events",
    )]


def generate_ga4_status_insight(ga4_dataset: str, ga4_available: bool) -> list:
    """Insight D — GA4 status insight based on configuration and data availability.

    - GA4_DATASET empty           → ga4_not_configured
    - GA4_DATASET set, no tables  → ga4_configured_but_incomplete
    - GA4_DATASET set, has data   → no insight (suppress)
    """
    if not ga4_dataset or not ga4_dataset.strip():
        return [_insight(
            insight_type   = "ga4_not_configured",
            severity       = "medium",
            title          = "GA4 ainda não está disponível para análise comportamental",
            summary        = (
                "Os insights atuais usam dados de Google Ads. "
                "Dados comportamentais do GA4 ainda não estão disponíveis no pipeline."
            ),
            recommendation = (
                "Concluir a carga real do GA4 no BigQuery para cruzar mídia, "
                "engajamento e conversões on-site."
            ),
            evidence       = {
                "ga4_dataset":      "",
                "date_range_start": str(DATE_RANGE_START),
                "date_range_end":   str(DATE_RANGE_END),
            },
            source_tables  = ["data_quality_report"],
            confidence     = 0.75,
            dedupe_key     = "ga4_not_configured",
        )]

    if not ga4_available:
        return [_insight(
            insight_type   = "ga4_configured_but_incomplete",
            severity       = "medium",
            title          = "GA4 configurado mas sem dados disponíveis no período",
            summary        = (
                f"O dataset GA4 '{ga4_dataset}' está configurado, mas nenhuma tabela "
                "events_* foi encontrada no BigQuery para o período analisado."
            ),
            recommendation = (
                "Verificar se o dataset está correto e se o Airbyte/pipeline GA4 "
                "está exportando eventos para o BigQuery."
            ),
            evidence       = {
                "ga4_dataset":      ga4_dataset,
                "date_range_start": str(DATE_RANGE_START),
                "date_range_end":   str(DATE_RANGE_END),
            },
            source_tables  = ["data_quality_report"],
            confidence     = 0.80,
            dedupe_key     = "ga4_configured_but_incomplete",
        )]

    # GA4 configured and has data — no informational insight needed
    return []


# ── Orchestration ──────────────────────────────────────────────────────────────

def generate_insights(
    supabase: Client,
    ga4_available: bool = False,
    ga4_summary: dict | None = None,
    measurement_config: dict | None = None,
    semantic_dq_results: list | None = None,
) -> list:
    """
    Run all deterministic insight generators and return list of insight dicts.

    Raises on technical failure (connection error, bad query).
    Blocking due to data quality is NOT a technical failure — returns a single
    data_quality_blocker insight instead of raising.
    """
    print(
        f"[insights] running deterministic insights for workspace={WORKSPACE_ID} "
        f"period={DATE_RANGE_START}..{DATE_RANGE_END}",
        flush=True,
    )

    dq_state = get_latest_data_quality_state(supabase)
    print(
        f"[insights] data quality state: "
        f"warnings={dq_state['warning_count']} "
        f"failed={dq_state['failed_count']} "
        f"critical={dq_state['critical_count']}",
        flush=True,
    )

    if should_block_insights(dq_state):
        print(
            "[insights] BLOCKED: critical data quality failure — "
            "skipping performance insights",
            flush=True,
        )
        blocker = _insight(
            insight_type   = "data_quality_blocker",
            severity       = "critical",
            title          = "Insights bloqueados por falha crítica de qualidade",
            summary        = (
                "Há falhas críticas nos checks de qualidade. "
                "Os insights de performance foram bloqueados para evitar conclusões incorretas."
            ),
            recommendation = (
                "Corrigir as falhas críticas de qualidade antes de re-executar o pipeline."
            ),
            evidence       = {
                "critical_checks":  [r["check_name"] for r in dq_state["critical"]],
                "date_range_start": str(DATE_RANGE_START),
                "date_range_end":   str(DATE_RANGE_END),
            },
            source_tables  = ["data_quality_report"],
            confidence     = 1.0,
            dedupe_key     = "dq_blocker",
        )
        return [blocker]

    all_insights: list = []

    camp = generate_campaign_zero_conversion_insights(supabase, dq_state)
    print(
        f"[insights] campaign_zero_conversions_with_cost: {len(camp)} insight"
        f"{'s' if len(camp) != 1 else ''}",
        flush=True,
    )
    all_insights.extend(camp)

    kw = generate_keyword_zero_conversion_insights(supabase, dq_state)
    print(
        f"[insights] keyword_zero_conversions_with_cost: {len(kw)} insight"
        f"{'s' if len(kw) != 1 else ''}",
        flush=True,
    )
    all_insights.extend(kw)

    dq_ctx = generate_data_quality_context_insight(dq_state)
    print(
        f"[insights] data_quality_warning_context: {len(dq_ctx)} insight"
        f"{'s' if len(dq_ctx) != 1 else ''}",
        flush=True,
    )
    all_insights.extend(dq_ctx)

    ga4_ctx = generate_ga4_status_insight(GA4_DATASET, ga4_available)
    print(
        f"[insights] ga4_status: {len(ga4_ctx)} insight"
        f"{'s' if len(ga4_ctx) != 1 else ''}",
        flush=True,
    )
    all_insights.extend(ga4_ctx)

    if ga4_available and ga4_summary:
        ga4_conv = generate_ga4_no_conversion_events_insight(GA4_DATASET, ga4_summary)
        print(
            f"[insights] ga4_no_conversion_events: {len(ga4_conv)} insight"
            f"{'s' if len(ga4_conv) != 1 else ''}",
            flush=True,
        )
        all_insights.extend(ga4_conv)

    # ── Semantic insights ──────────────────────────────────────────────────────
    if measurement_config is not None and semantic_dq_results:
        try:
            from semantic_governance import generate_semantic_insights
            sem_ins = generate_semantic_insights(measurement_config, semantic_dq_results)
            print(
                f"[insights] semantic_governance: {len(sem_ins)} insight"
                f"{'s' if len(sem_ins) != 1 else ''}",
                flush=True,
            )
            all_insights.extend(sem_ins)
        except Exception as exc:
            print(f"[insights] semantic governance insights error (skipped): {exc}", flush=True)

    return all_insights


def write_insights(supabase: Client, insights: list) -> None:
    """
    Upsert insights into insight_feed, preserving analyst-managed status.

    Strategy (Opção B):
    1. Fetch existing (dedupe_key → status) for this workspace+period in one query.
    2. For each incoming insight that already exists, keep its current status
       instead of resetting to 'new'. All other fields (evidence, summary,
       severity, updated_at, etc.) are always refreshed.
    3. Upsert with ON CONFLICT DO UPDATE — safe because status is now correct.

    New insights:    status = 'new'  (set by _insight())
    Existing insights: status preserved (reviewed / dismissed / resolved kept)
    """
    if not insights:
        print("[insights] no insights to write", flush=True)
        return

    dedupe_keys = [ins["dedupe_key"] for ins in insights]
    existing_resp = (
        supabase.table("insight_feed")
        .select("dedupe_key,status")
        .eq("workspace_id", WORKSPACE_ID)
        .eq("date_range_start", str(DATE_RANGE_START))
        .eq("date_range_end", str(DATE_RANGE_END))
        .in_("dedupe_key", dedupe_keys)
        .execute()
    )
    existing_status: dict = {
        row["dedupe_key"]: row["status"]
        for row in (existing_resp.data or [])
    }

    preserved = 0
    for ins in insights:
        saved = existing_status.get(ins["dedupe_key"])
        if saved and saved != "new":
            ins["status"] = saved
            preserved += 1

    supabase.table("insight_feed").upsert(
        insights,
        on_conflict="workspace_id,dedupe_key,date_range_start,date_range_end",
    ).execute()
    print(
        f"[insights] inserted/upserted {len(insights)} insights"
        + (f" ({preserved} with preserved status)" if preserved else ""),
        flush=True,
    )
