import os
import sys
from datetime import datetime, timezone
from typing import Optional
from supabase import Client

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from config import APP_ENV, WORKSPACE_ID, DATE_RANGE_START, DATE_RANGE_END
from sync_ga4 import GA4_CONVERSION_EVENTS


# ── Internal helpers ──────────────────────────────────────────────────────────

def _result(
    check_name: str,
    check_category: str,
    status: str,
    severity: str,
    target_table: str,
    affected_rows: int = 0,
    metric_value: Optional[float] = None,
    threshold_value: Optional[float] = None,
    details: Optional[dict] = None,
    source_platform: str = "google_ads",
) -> dict:
    return {
        "workspace_id":     WORKSPACE_ID,
        "check_name":       check_name,
        "check_category":   check_category,
        "status":           status,
        "severity":         severity,
        "source_platform":  source_platform,
        "target_table":     target_table,
        "metric_value":     metric_value,
        "threshold_value":  threshold_value,
        "affected_rows":    affected_rows,
        "details":          details,
        "date_range_start": str(DATE_RANGE_START),
        "date_range_end":   str(DATE_RANGE_END),
    }


def _parse_loaded_at(raw: str) -> datetime:
    dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


# ── Individual checks ─────────────────────────────────────────────────────────

def check_campaigns_missing_campaign_id(supabase: Client) -> dict:
    """A — campaign_summary rows where campaign_id is NULL or empty string."""
    null_resp = (
        supabase.table("campaign_summary")
        .select("id", count="exact")
        .eq("workspace_id", WORKSPACE_ID)
        .gte("date_range_start", str(DATE_RANGE_START))
        .lte("date_range_end", str(DATE_RANGE_END))
        .is_("campaign_id", "null")
        .execute()
    )
    empty_resp = (
        supabase.table("campaign_summary")
        .select("id", count="exact")
        .eq("workspace_id", WORKSPACE_ID)
        .gte("date_range_start", str(DATE_RANGE_START))
        .lte("date_range_end", str(DATE_RANGE_END))
        .eq("campaign_id", "")
        .execute()
    )
    affected = (null_resp.count or 0) + (empty_resp.count or 0)
    return _result(
        check_name      = "campaign_summary_missing_campaign_id",
        check_category  = "completeness",
        status          = "failed" if affected > 0 else "passed",
        severity        = "high",
        target_table    = "campaign_summary",
        affected_rows   = affected,
        metric_value    = float(affected),
        threshold_value = 0.0,
    )


def check_campaigns_zero_conversions_with_cost(supabase: Client) -> dict:
    """B — campaigns with cost > 0 and conversions = 0."""
    resp = (
        supabase.table("campaign_summary")
        .select("campaign_id,campaign_name,cost,conversions")
        .eq("workspace_id", WORKSPACE_ID)
        .gte("date_range_start", str(DATE_RANGE_START))
        .lte("date_range_end", str(DATE_RANGE_END))
        .gt("cost", 0)
        .eq("conversions", 0)
        .order("cost", desc=True)
        .execute()
    )
    rows = resp.data or []
    affected = len(rows)
    return _result(
        check_name      = "campaign_summary_zero_conversions_with_cost",
        check_category  = "consistency",
        status          = "warning" if affected > 0 else "passed",
        severity        = "medium",
        target_table    = "campaign_summary",
        affected_rows   = affected,
        metric_value    = float(affected),
        threshold_value = 0.0,
        details         = {"examples": rows[:10]} if rows else None,
    )


def check_keywords_zero_conversions_with_cost(supabase: Client) -> dict:
    """C — keywords with cost > 0 and conversions = 0."""
    count_resp = (
        supabase.table("keyword_analysis")
        .select("id", count="exact")
        .eq("workspace_id", WORKSPACE_ID)
        .gte("date_range_start", str(DATE_RANGE_START))
        .lte("date_range_end", str(DATE_RANGE_END))
        .gt("cost", 0)
        .eq("conversions", 0)
        .execute()
    )
    affected = count_resp.count or 0

    examples_resp = (
        supabase.table("keyword_analysis")
        .select("campaign_name,keyword,match_type,cost,conversions")
        .eq("workspace_id", WORKSPACE_ID)
        .gte("date_range_start", str(DATE_RANGE_START))
        .lte("date_range_end", str(DATE_RANGE_END))
        .gt("cost", 0)
        .eq("conversions", 0)
        .order("cost", desc=True)
        .limit(10)
        .execute()
    )
    examples = examples_resp.data or []

    return _result(
        check_name      = "keyword_analysis_zero_conversions_with_cost",
        check_category  = "consistency",
        status          = "warning" if affected > 0 else "passed",
        severity        = "medium",
        target_table    = "keyword_analysis",
        affected_rows   = affected,
        metric_value    = float(affected),
        threshold_value = 0.0,
        details         = {"examples": examples} if examples else None,
    )


def _freshness_check(supabase: Client, table: str, check_name: str) -> dict:
    """Shared freshness logic: checks loaded_at of the most recent record."""
    resp = (
        supabase.table(table)
        .select("loaded_at")
        .eq("workspace_id", WORKSPACE_ID)
        .not_.is_("loaded_at", "null")
        .order("loaded_at", desc=True)
        .limit(1)
        .execute()
    )
    now = datetime.now(timezone.utc)

    if not resp.data:
        return _result(
            check_name     = check_name,
            check_category = "freshness",
            status         = "failed",
            severity       = "high",
            target_table   = table,
            details        = {"reason": "no records with loaded_at found"},
        )

    raw = resp.data[0]["loaded_at"]
    most_recent = _parse_loaded_at(raw)
    age_hours = (now - most_recent).total_seconds() / 3600

    if age_hours <= 24:
        status = "passed"
        severity = "low"
    elif age_hours <= 48:
        status = "warning"
        severity = "medium"
    else:
        status = "failed"
        severity = "high"

    return _result(
        check_name      = check_name,
        check_category  = "freshness",
        status          = status,
        severity        = severity,
        target_table    = table,
        metric_value    = round(age_hours, 2),
        threshold_value = 24.0,
        details         = {"most_recent_loaded_at": raw, "age_hours": round(age_hours, 2)},
    )


def check_campaign_summary_freshness(supabase: Client) -> dict:
    """D — freshness of campaign_summary based on loaded_at."""
    return _freshness_check(supabase, "campaign_summary", "campaign_summary_freshness")


def check_keyword_analysis_freshness(supabase: Client) -> dict:
    """E — freshness of keyword_analysis based on loaded_at."""
    return _freshness_check(supabase, "keyword_analysis", "keyword_analysis_freshness")


def check_mock_data_presence(supabase: Client) -> dict:
    """F — detects is_mock=true rows; fails in production, warns in dev/staging."""
    camp_resp = (
        supabase.table("campaign_summary")
        .select("id", count="exact")
        .eq("workspace_id", WORKSPACE_ID)
        .eq("is_mock", True)
        .execute()
    )
    kw_resp = (
        supabase.table("keyword_analysis")
        .select("id", count="exact")
        .eq("workspace_id", WORKSPACE_ID)
        .eq("is_mock", True)
        .execute()
    )
    total_mock = (camp_resp.count or 0) + (kw_resp.count or 0)

    if total_mock == 0:
        status = "passed"
        severity = "low"
    elif APP_ENV == "production":
        status = "failed"
        severity = "critical"
    else:
        status = "warning"
        severity = "medium"

    return _result(
        check_name      = "mock_data_presence",
        check_category  = "integrity",
        status          = status,
        severity        = severity,
        target_table    = "campaign_summary,keyword_analysis",
        affected_rows   = total_mock,
        metric_value    = float(total_mock),
        threshold_value = 0.0,
        details         = {
            "mock_in_campaign_summary": camp_resp.count or 0,
            "mock_in_keyword_analysis": kw_resp.count or 0,
            "environment": APP_ENV,
        } if total_mock > 0 else None,
    )


# ── GA4 checks ────────────────────────────────────────────────────────────────

def check_ga4_dataset_available(ga4_dataset: str, tables: list) -> dict:
    """G — GA4 dataset configured and has events_* tables in BigQuery."""
    if not ga4_dataset:
        return _result(
            check_name      = "ga4_dataset_available",
            check_category  = "availability",
            status          = "warning",
            severity        = "medium",
            target_table    = "ga4_first_light_summary",
            source_platform = "ga4",
            details         = {"reason": "GA4_DATASET env var not configured"},
        )
    if not tables:
        return _result(
            check_name      = "ga4_dataset_available",
            check_category  = "availability",
            status          = "failed",
            severity        = "high",
            target_table    = "ga4_first_light_summary",
            source_platform = "ga4",
            details         = {"ga4_dataset": ga4_dataset, "reason": "no events_* tables found"},
        )
    return _result(
        check_name      = "ga4_dataset_available",
        check_category  = "availability",
        status          = "passed",
        severity        = "low",
        target_table    = "ga4_first_light_summary",
        source_platform = "ga4",
        affected_rows   = len(tables),
        metric_value    = float(len(tables)),
        details         = {
            "ga4_dataset":   ga4_dataset,
            "tables_found":  len(tables),
            "latest_table":  tables[-1],
        },
    )


def check_ga4_events_freshness(tables: list) -> dict:
    """H — freshness of the most recent events_* table based on its date suffix."""
    from datetime import date as date_type
    latest = tables[-1]  # e.g. events_20260507
    raw_date = latest.replace("events_", "")
    try:
        tbl_date = date_type(int(raw_date[:4]), int(raw_date[4:6]), int(raw_date[6:8]))
        age_days = (date_type.today() - tbl_date).days
    except (ValueError, IndexError):
        return _result(
            check_name      = "ga4_events_freshness",
            check_category  = "freshness",
            status          = "warning",
            severity        = "medium",
            target_table    = "ga4_first_light_summary",
            source_platform = "ga4",
            details         = {"reason": "could not parse date from table name", "table": latest},
        )

    if age_days <= 2:
        status, severity = "passed", "low"
    elif age_days <= 7:
        status, severity = "warning", "medium"
    else:
        status, severity = "failed", "high"

    return _result(
        check_name      = "ga4_events_freshness",
        check_category  = "freshness",
        status          = status,
        severity        = severity,
        target_table    = "ga4_first_light_summary",
        source_platform = "ga4",
        metric_value    = float(age_days),
        threshold_value = 2.0,
        details         = {"latest_table": latest, "age_days": age_days},
    )


def check_ga4_has_page_view(summary: dict) -> dict:
    """I — GA4 data contains page_view events."""
    page_views = summary.get("page_views", 0)
    return _result(
        check_name      = "ga4_has_page_view",
        check_category  = "completeness",
        status          = "passed" if page_views > 0 else "warning",
        severity        = "medium",
        target_table    = "ga4_first_light_summary",
        source_platform = "ga4",
        affected_rows   = page_views,
        metric_value    = float(page_views),
        threshold_value = 0.0,
        details         = {"page_view_count": page_views},
    )


def check_ga4_has_session_start(summary: dict) -> dict:
    """J — GA4 data contains session_start events."""
    sessions = summary.get("sessions", 0)
    return _result(
        check_name      = "ga4_has_session_start",
        check_category  = "completeness",
        status          = "passed" if sessions > 0 else "warning",
        severity        = "medium",
        target_table    = "ga4_first_light_summary",
        source_platform = "ga4",
        affected_rows   = sessions,
        metric_value    = float(sessions),
        threshold_value = 0.0,
        details         = {"session_start_count": sessions},
    )


def check_ga4_has_conversion_events(summary: dict) -> dict:
    """K — expected conversion events are present in the GA4 data."""
    conversion_events = summary.get("conversion_events", {})
    found     = {k: v for k, v in conversion_events.items() if v > 0}
    not_found = [k for k, v in conversion_events.items() if v == 0]

    return _result(
        check_name      = "ga4_has_conversion_events",
        check_category  = "completeness",
        status          = "passed" if found else "warning",
        severity        = "medium",
        target_table    = "ga4_first_light_summary",
        source_platform = "ga4",
        affected_rows   = len(found),
        metric_value    = float(len(found)),
        threshold_value = 1.0,
        details         = {
            "found":     found,
            "not_found": not_found,
            "expected":  GA4_CONVERSION_EVENTS,
        },
    )


# ── Orchestration ─────────────────────────────────────────────────────────────

def run_data_quality_checks(
    supabase: Client,
    bq_client=None,
    ga4_dataset: str = "",
    measurement_config: Optional[dict] = None,
    ga4_tables: Optional[list] = None,
    ga4_summary: Optional[dict] = None,
    dry_run: bool = False,
) -> list:
    """Run all quality checks and return list of result dicts.

    Raises on technical failure (connection error, bad query).
    Does NOT raise when a check returns status='failed' — that is expected data.

    Optional ga4_tables / ga4_summary can be pre-fetched by the caller to avoid
    duplicate BigQuery round-trips.
    """
    print(
        f"[data_quality] running checks for workspace={WORKSPACE_ID} "
        f"period={DATE_RANGE_START}..{DATE_RANGE_END}",
        flush=True,
    )

    results = []

    # ── Google Ads checks (A–F) ─────────────────────────────────────────────
    for fn in [
        check_campaigns_missing_campaign_id,
        check_campaigns_zero_conversions_with_cost,
        check_keywords_zero_conversions_with_cost,
        check_campaign_summary_freshness,
        check_keyword_analysis_freshness,
        check_mock_data_presence,
    ]:
        result = fn(supabase)
        print(
            f"[data_quality] {result['check_name']}: {result['status']} "
            f"affected_rows={result['affected_rows']}",
            flush=True,
        )
        results.append(result)

    # ── GA4 checks (G–K) — always run G; H–K only when dataset+tables exist ─
    # Use pre-fetched tables/summary if provided; otherwise fetch here.
    if ga4_tables is None:
        ga4_tables = []
        if ga4_dataset and bq_client is not None:
            try:
                from sync_ga4 import get_ga4_tables, get_ga4_first_light_summary
                ga4_tables = get_ga4_tables(bq_client, ga4_dataset)
                if ga4_tables and ga4_summary is None:
                    ga4_summary = get_ga4_first_light_summary(bq_client, ga4_dataset, ga4_tables)
            except Exception as exc:
                print(f"[data_quality] GA4 data fetch error (checks H–K skipped): {exc}", flush=True)

    ga4_check_results = [check_ga4_dataset_available(ga4_dataset, ga4_tables)]

    if ga4_tables:
        ga4_check_results.append(check_ga4_events_freshness(ga4_tables))

    if ga4_summary is not None:
        ga4_check_results.append(check_ga4_has_page_view(ga4_summary))
        ga4_check_results.append(check_ga4_has_session_start(ga4_summary))
        ga4_check_results.append(check_ga4_has_conversion_events(ga4_summary))

    for result in ga4_check_results:
        print(
            f"[data_quality] {result['check_name']}: {result['status']} "
            f"affected_rows={result['affected_rows']}",
            flush=True,
        )
    results.extend(ga4_check_results)

    # ── Semantic Governance checks (L–S) ────────────────────────────────────
    if measurement_config is not None:
        try:
            from semantic_governance import run_semantic_quality_checks
            sem_results = run_semantic_quality_checks(
                config      = measurement_config,
                supabase    = supabase,
                bq_client   = bq_client,
                ga4_dataset = ga4_dataset,
                ga4_tables  = ga4_tables,
                ga4_summary = ga4_summary,
                dry_run     = dry_run,
            )
            results.extend(sem_results)
        except Exception as exc:
            print(f"[data_quality] semantic governance error (skipped): {exc}", flush=True)

    return results


def write_quality_reports(supabase: Client, results: list) -> None:
    """Insert quality check results into data_quality_report. History is preserved."""
    supabase.table("data_quality_report").insert(results).execute()
    print(f"[data_quality] inserted {len(results)} quality checks", flush=True)
