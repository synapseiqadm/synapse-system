import os
import sys
from datetime import datetime, timezone, date, timedelta
from typing import List, Dict, Any, Optional
from supabase import Client

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from config import WOKE_WORKSPACE_ID


# Existing get_operational_timeline function
def get_operational_timeline(
    supabase: Client,
    workspace_id: str,
    date_start: date,
    date_end: date,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """
    Fetches and correlates various operational events to build a timeline.
    Includes: operational_events, sync_runs, semantic_governance_findings,
    and relevant KPI changes from kpi_cache_daily.
    """
    timeline_events: List[Dict[str, Any]] = []

    # 1. Fetch operational_events (manual interventions, governance fixes, etc.)
    op_events_resp = (
        supabase.table("operational_events")
        .select("*")
        .eq("workspace_id", workspace_id)
        .gte("occurred_at", date_start.isoformat())
        .lte("occurred_at", (date_end + timedelta(days=1)).isoformat()) # Include end day
        .order("occurred_at", desc=True)
        .limit(limit)
        .execute()
    )
    for event in op_events_resp.data or []:
        timeline_events.append({
            "type": "operational_event",
            "timestamp": event["occurred_at"],
            "title": event["title"] or f"{event['event_type'].replace('_', ' ').title()} - {event['category'].replace('_', ' ').title()}",
            "description": event["description"],
            "details": event["impact_scope"],
            "actor": event["actor"],
            "severity": "info", # Default severity for operational events
        })

    # 2. Fetch sync_runs (data pipeline executions)
    sync_runs_resp = (
        supabase.table("sync_runs")
        .select("started_at,finished_at,status,source_platform,data_source,error_message")
        .eq("workspace_id", workspace_id)
        .gte("started_at", date_start.isoformat())
        .lte("started_at", (date_end + timedelta(days=1)).isoformat())
        .order("started_at", desc=True)
        .limit(limit)
        .execute()
    )
    for run in sync_runs_resp.data or []:
        status = run["status"]
        severity = "success" if status == "success" else ("error" if status == "error" else "info")
        timeline_events.append({
            "type": "sync_run",
            "timestamp": run["started_at"],
            "title": f"Sync {run['source_platform']}/{run['data_source']} {status}",
            "description": run["error_message"] if status == "error" else f"Finished at {run['finished_at']}",
            "details": {"source_platform": run["source_platform"], "data_source": run["data_source"], "status": status},
            "severity": severity,
        })

    # 3. Fetch semantic_governance_findings (data quality issues)
    findings_resp = (
        supabase.table("semantic_governance_findings")
        .select("created_at,check_name,status,severity,details")
        .eq("workspace_id", workspace_id)
        .gte("created_at", date_start.isoformat())
        .lte("created_at", (date_end + timedelta(days=1)).isoformat())
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    for finding in findings_resp.data or []:
        timeline_events.append({
            "type": "governance_finding",
            "timestamp": finding["created_at"],
            "title": f"Governança: {finding['check_name']} ({finding['status']})",
            "description": f"Severidade: {finding['severity']}",
            "details": finding["details"],
            "severity": finding["severity"],
        })

    # Sort all events by timestamp
    timeline_events.sort(key=lambda x: x["timestamp"], reverse=True)

    return timeline_events[:limit]


# Existing get_kpi_diff function
def get_kpi_diff(
    supabase: Client,
    workspace_id: str,
    metric_name: str,
    date_before: date,
    date_after: date,
) -> Optional[Dict[str, Any]]:
    """
    Compares a KPI value between two specific dates.
    This is a simplified version of the Snapshot Diff Engine.
    """
    # Fetch KPI for date_before
    kpi_before_resp = (
        supabase.table("kpi_cache_daily")
        .select("metric_value")
        .eq("workspace_id", workspace_id)
        .eq("date", date_before.isoformat())
        .eq("metric_name", metric_name)
        .limit(1)
        .execute()
    )
    value_before = kpi_before_resp.data[0]["metric_value"] if kpi_before_resp.data else None

    # Fetch KPI for date_after
    kpi_after_resp = (
        supabase.table("kpi_cache_daily")
        .select("metric_value")
        .eq("workspace_id", workspace_id)
        .eq("date", date_after.isoformat())
        .eq("metric_name", metric_name)
        .limit(1)
        .execute()
    )
    value_after = kpi_after_resp.data[0]["metric_value"] if kpi_after_resp.data else None

    if value_before is None or value_after is None:
        return None

    delta = value_after - value_before
    percentage_change = (delta / value_before * 100) if value_before != 0 else (100 if delta > 0 else 0)

    return {
        "metric_name": metric_name,
        "value_before": value_before,
        "value_after": value_after,
        "delta": delta,
        "percentage_change": percentage_change,
    }


# New or modified function to combine timeline and KPI diff for ExecutiveBoardView
def get_executive_momentum_data(
    supabase: Client,
    workspace_id: str,
    date_start: date,
    date_end: date,
    comparison_days: int = 30, # Default for ROAS trend
) -> Dict[str, Any]:
    """
    Fetches operational timeline events and calculates ROAS momentum for ExecutiveBoardView.
    """
    # Calculate comparison period for KPI diff
    # This compares the current period (date_start to date_end) against a previous period
    # of the same duration.
    current_period_duration = (date_end - date_start).days + 1
    comparison_date_end = date_start - timedelta(days=1)
    comparison_date_start = comparison_date_end - timedelta(days=current_period_duration - 1)

    # Fetch KPI diff for ROAS
    roas_diff = get_kpi_diff(
        supabase,
        workspace_id,
        "roas",
        comparison_date_start, # Date for "before" value
        date_end,              # Date for "after" value
    )

    # Fetch operational events for contextual labels
    # Limit to the current period for relevance to the chart
    operational_events = get_operational_timeline(
        supabase,
        workspace_id,
        date_start,
        date_end,
        limit=20 # Fetch a reasonable number of recent events
    )

    # Extract relevant event titles for contextual labels
    contextual_labels = [
        event["title"] for event in operational_events
        if event["type"] == "operational_event" or event["type"] == "governance_finding"
    ]

    return {
        "trend_delta": roas_diff["percentage_change"] if roas_diff else None,
        "contextual_labels": contextual_labels,
    }