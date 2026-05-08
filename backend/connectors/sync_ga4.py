import os
import sys
from datetime import datetime, timezone

from google.cloud import bigquery
from supabase import Client

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from config import (
    GCP_PROJECT_ID,
    WOKE_WORKSPACE_ID,
    GA4_DATASET,
    DATE_RANGE_START,
    DATE_RANGE_END,
)

GA4_CONVERSION_EVENTS = [
    "generate_lead",
    "app_criar_conta",
    "mentor_signup_with_auto_signin",
    "quero_ser_premium",
    "sign_up",
    "form_submit",
]

_DATE_START_SUFFIX = DATE_RANGE_START.strftime("%Y%m%d")
_DATE_END_SUFFIX   = DATE_RANGE_END.strftime("%Y%m%d")


# ── Helpers ────────────────────────────────────────────────────────────────────

def ga4_dataset_available(bq_client: bigquery.Client, ga4_dataset: str) -> bool:
    """True if the GA4 dataset exists and contains at least one events_* table."""
    if not ga4_dataset or not ga4_dataset.strip():
        return False
    return len(get_ga4_tables(bq_client, ga4_dataset)) > 0


def get_ga4_tables(bq_client: bigquery.Client, ga4_dataset: str) -> list:
    """Return sorted list of events_YYYYMMDD table names found in the dataset."""
    if not ga4_dataset:
        return []
    query = f"""
        SELECT table_name
        FROM `{GCP_PROJECT_ID}.{ga4_dataset}.INFORMATION_SCHEMA.TABLES`
        WHERE REGEXP_CONTAINS(table_name, r'^events_[0-9]{{8}}$')
        ORDER BY table_name
    """
    try:
        rows = list(bq_client.query(query).result())
        return [r.table_name for r in rows]
    except Exception as exc:
        print(f"[sync_ga4] get_ga4_tables error: {exc}", flush=True)
        return []


def get_ga4_first_light_summary(
    bq_client: bigquery.Client,
    ga4_dataset: str,
    tables: list,
) -> dict:
    """
    Query GA4 events_* tables for the configured date range and return a summary dict.

    Two BigQuery jobs:
      1. Event-level aggregation (totals + top events + conversion counts).
      2. Top landing pages from page_view events.
    """
    # Determine latest table name and date
    latest_table = tables[-1] if tables else None
    latest_event_date = None
    if latest_table:
        raw_date = latest_table.replace("events_", "")  # YYYYMMDD
        try:
            from datetime import date as date_type
            latest_event_date = str(
                date_type(int(raw_date[:4]), int(raw_date[4:6]), int(raw_date[6:8]))
            )
        except (ValueError, IndexError):
            latest_event_date = None

    wildcard_table = f"`{GCP_PROJECT_ID}.{ga4_dataset}.events_*`"

    # ── Query 1: event aggregation ───────────────────────────────────────────
    agg_query = f"""
        SELECT
            event_name,
            COUNT(*)                           AS event_count,
            COUNT(DISTINCT user_pseudo_id)     AS unique_users
        FROM {wildcard_table}
        WHERE _TABLE_SUFFIX BETWEEN '{_DATE_START_SUFFIX}' AND '{_DATE_END_SUFFIX}'
        GROUP BY event_name
        ORDER BY event_count DESC
    """
    agg_rows = list(bq_client.query(agg_query).result())

    # Build lookup maps from the aggregation result
    event_counts  = {r.event_name: int(r.event_count)  for r in agg_rows}
    event_users   = {r.event_name: int(r.unique_users)  for r in agg_rows}

    total_events  = sum(event_counts.values())
    sessions      = event_counts.get("session_start", 0)
    page_views    = event_counts.get("page_view", 0)
    # session_start unique users is the best available proxy without a full scan
    total_users   = event_users.get("session_start", 0)

    top_events = [
        {"event_name": r.event_name, "count": int(r.event_count)}
        for r in agg_rows[:20]
    ]
    conversion_events = {
        evt: event_counts.get(evt, 0)
        for evt in GA4_CONVERSION_EVENTS
    }

    # ── Query 2: top landing pages ───────────────────────────────────────────
    lp_query = f"""
        SELECT
            (SELECT value.string_value
             FROM UNNEST(event_params)
             WHERE key = 'page_location') AS page_location,
            COUNT(*) AS views
        FROM {wildcard_table}
        WHERE _TABLE_SUFFIX BETWEEN '{_DATE_START_SUFFIX}' AND '{_DATE_END_SUFFIX}'
          AND event_name = 'page_view'
        GROUP BY 1
        HAVING page_location IS NOT NULL
        ORDER BY views DESC
        LIMIT 20
    """
    lp_rows = list(bq_client.query(lp_query).result())
    top_landing_pages = [
        {"page_location": r.page_location, "views": int(r.views)}
        for r in lp_rows
    ]

    return {
        "latest_event_table": latest_table,
        "latest_event_date":  latest_event_date,
        "total_events":       total_events,
        "total_users":        total_users,
        "sessions":           sessions,
        "page_views":         page_views,
        "top_events":         top_events,
        "top_landing_pages":  top_landing_pages,
        "conversion_events":  conversion_events,
    }


# ── Sync ───────────────────────────────────────────────────────────────────────

def sync_ga4_first_light(
    bq_client: bigquery.Client,
    supabase: Client,
    dry_run: bool = False,
    tables: list | None = None,
    summary: dict | None = None,
) -> int:
    """
    Fetch GA4 first light summary from BigQuery and upsert into ga4_first_light_summary.

    Returns the number of records upserted (0 or 1).
    Raises on technical failure (bad query, write error).

    Optional `tables` and `summary` can be passed in to avoid re-querying BigQuery
    when the caller has already fetched them.
    """
    print(
        f"[sync_ga4] dataset={GA4_DATASET} "
        f"period={DATE_RANGE_START}..{DATE_RANGE_END}",
        flush=True,
    )

    if tables is None:
        tables = get_ga4_tables(bq_client, GA4_DATASET)
    if not tables:
        print("[sync_ga4] no events_* tables found — skipping", flush=True)
        return 0

    print(f"[sync_ga4] {len(tables)} events_* table(s) found; latest={tables[-1]}", flush=True)

    if summary is None:
        summary = get_ga4_first_light_summary(bq_client, GA4_DATASET, tables)

    print(
        f"[sync_ga4] summary: total_events={summary['total_events']} "
        f"total_users={summary['total_users']} "
        f"sessions={summary['sessions']} "
        f"page_views={summary['page_views']}",
        flush=True,
    )

    found_conversions = {k: v for k, v in summary["conversion_events"].items() if v > 0}
    if found_conversions:
        print(f"[sync_ga4] conversion events found: {found_conversions}", flush=True)
    else:
        print("[sync_ga4] no expected conversion events found in range", flush=True)

    if dry_run:
        print("[sync_ga4] --dry-run: would upsert 1 ga4_first_light_summary record", flush=True)
        print(
            f"  latest_table={summary['latest_event_table']} "
            f"top_events={len(summary['top_events'])} "
            f"landing_pages={len(summary['top_landing_pages'])}",
            flush=True,
        )
        return 1

    now = datetime.now(timezone.utc).isoformat()
    record = {
        "workspace_id":       WOKE_WORKSPACE_ID,
        "ga4_dataset":        GA4_DATASET,
        "latest_event_table": summary["latest_event_table"],
        "latest_event_date":  summary["latest_event_date"],
        "total_events":       summary["total_events"],
        "total_users":        summary["total_users"],
        "sessions":           summary["sessions"],
        "page_views":         summary["page_views"],
        "top_events":         summary["top_events"],
        "top_landing_pages":  summary["top_landing_pages"],
        "conversion_events":  summary["conversion_events"],
        "source_platform":    "ga4",
        "data_source":        "bigquery",
        "is_mock":            False,
        "date_range_start":   str(DATE_RANGE_START),
        "date_range_end":     str(DATE_RANGE_END),
        "loaded_at":          now,
        "updated_at":         now,
    }

    supabase.table("ga4_first_light_summary").upsert(
        record,
        on_conflict="workspace_id,ga4_dataset,date_range_start,date_range_end",
    ).execute()
    print("[sync_ga4] upserted 1 ga4_first_light_summary record", flush=True)
    return 1
