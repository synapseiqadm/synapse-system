import os
import sys
from datetime import datetime, timezone, timedelta
from typing import Optional
from supabase import Client

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from config import WOKE_WORKSPACE_ID, APP_ENV


def record_operational_event(
    supabase: Client,
    event_type: str,
    category: str,
    title: str,
    description: Optional[str],
    impact_scope: dict,
    actor: str = "system",
    evidence_id: Optional[str] = None,
    dry_run: bool = False,
):
    """
    Records an operational event in the 'operational_events' table.
    """
    event_data = {
        "workspace_id": WOKE_WORKSPACE_ID,
        "event_type": event_type,
        "category": category,
        "title": title,
        "description": description,
        "impact_scope": impact_scope,
        "actor": actor,
        "evidence_id": evidence_id,
    }
    if not dry_run:
        try:
            supabase.table("operational_events").insert(event_data).execute()
            print(f"[operational_events] Recorded event: {title}", flush=True)
        except Exception as exc:
            print(f"[operational_events] WARNING: Could not record event '{title}': {exc}", flush=True)
    else:
        print(f"[operational_events] --dry-run: Would record event: {title}", flush=True)


def detect_kpi_anomaly(
    supabase: Client,
    metric_name: str = "roas",
    lookback_days: int = 30,
    threshold: float = 0.30,
    dry_run: bool = False,
) -> None:
    """
    Queries kpi_cache_daily for the last `lookback_days` of `metric_name`,
    computes the period mean, and fires a kpi_anomaly event if the most recent
    value deviates beyond ±`threshold` (default 30%) from that mean.

    Mirrors the frontend MomentumChart anomaly logic so backend and UI agree
    on what constitutes an anomaly.
    """
    today      = datetime.now(timezone.utc).date()
    date_start = (today - timedelta(days=lookback_days)).isoformat()

    try:
        resp = (
            supabase.table("kpi_cache_daily")
            .select("date, metric_value")
            .eq("workspace_id", WOKE_WORKSPACE_ID)
            .eq("metric_name", metric_name)
            .gte("date", date_start)
            .order("date", desc=False)
            .execute()
        )
    except Exception as exc:
        print(f"[detect_kpi_anomaly] WARNING: Could not fetch {metric_name}: {exc}", flush=True)
        return

    rows = [r for r in (resp.data or []) if r.get("metric_value") is not None]
    if len(rows) < 2:
        print(
            f"[detect_kpi_anomaly] Not enough data for {metric_name} "
            f"({len(rows)} rows in last {lookback_days}d) — skipping",
            flush=True,
        )
        return

    values    = [float(r["metric_value"]) for r in rows]
    mean      = sum(values) / len(values)
    last      = values[-1]
    last_date = rows[-1]["date"]

    if mean == 0:
        return

    deviation     = (last - mean) / mean          # signed ratio
    deviation_pct = deviation * 100

    if abs(deviation) <= threshold:
        print(
            f"[detect_kpi_anomaly] {metric_name} within normal range "
            f"(last={last:.4f}, mean={mean:.4f}, Δ={deviation_pct:+.1f}%)",
            flush=True,
        )
        return

    direction = "above" if deviation > 0 else "below"
    record_operational_event(
        supabase,
        event_type="anomaly",
        category="kpi_anomaly",
        title=f"{metric_name.upper()} anomaly: {deviation_pct:+.1f}% vs {lookback_days}d mean",
        description=(
            f"{metric_name.upper()} on {last_date} was {last:.4f}x, "
            f"{abs(deviation_pct):.1f}% {direction} the "
            f"{lookback_days}d mean of {mean:.4f}x."
        ),
        impact_scope={
            "metric_name":    metric_name,
            "last_value":     round(last, 4),
            "mean_value":     round(mean, 4),
            "deviation_pct":  round(deviation_pct, 2),
            "last_date":      last_date,
            "lookback_days":  lookback_days,
            "threshold_pct":  round(threshold * 100, 1),
        },
        actor="system",
        dry_run=dry_run,
    )
    print(
        f"[detect_kpi_anomaly] Anomaly recorded: "
        f"{metric_name} {deviation_pct:+.1f}% vs {lookback_days}d mean",
        flush=True,
    )