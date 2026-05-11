#!/usr/bin/env python3
"""
A-Data Sync - entry point for the SynapseIQ data pipeline.

Usage (from backend/):
    python -m connectors.a_data_sync
    python -m connectors.a_data_sync --dry-run
    python connectors/a_data_sync.py --dry-run
"""
import os
import sys
import argparse

sys.stdout.reconfigure(encoding="utf-8")

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from config import (
    APP_ENV, WOKE_WORKSPACE_ID,
    GCP_PROJECT_ID, BQ_LOCATION, GA4_DATASET,
    SUPABASE_URL, SUPABASE_SERVICE_KEY,
    DATE_RANGE_START, DATE_RANGE_END,
    ENABLE_INSIGHTS, MEASUREMENT_CONFIG_PATH,
)
from sync_runs import start_sync_run, finish_sync_run_success, finish_sync_run_error
from sync_ads import sync_campaigns, sync_keywords, sync_kpi_cache_daily
from sync_ga4 import (
    sync_ga4_first_light,
    get_ga4_tables,
    get_ga4_first_light_summary,
)
from data_quality import run_data_quality_checks, write_quality_reports
from insights import generate_insights, write_insights, resolve_obsolete_insights
from semantic_governance import load_measurement_config
from operational_events import record_operational_event


def main(dry_run: bool = False) -> None:
    print(
        f"[a_data_sync] env={APP_ENV} dry_run={dry_run} "
        f"period={DATE_RANGE_START}..{DATE_RANGE_END}",
        flush=True,
    )

    from google.cloud import bigquery
    from supabase import create_client

    bq_client = bigquery.Client(project=GCP_PROJECT_ID, location=BQ_LOCATION)
    supabase  = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # ── Measurement config (optional - pipeline continues if absent) ───────
    measurement_config = load_measurement_config(MEASUREMENT_CONFIG_PATH)

    _scope_base = {"date_range_start": str(DATE_RANGE_START), "date_range_end": str(DATE_RANGE_END)}

    # ── campaigns ──────────────────────────────────────────────────────────
    run_id = None
    if not dry_run:
        run_id = start_sync_run(
            supabase,
            workspace_id     = WOKE_WORKSPACE_ID,
            source_platform  = "google_ads",
            data_source      = "campaign_summary",
            is_mock          = False,
            date_range_start = DATE_RANGE_START,
            date_range_end   = DATE_RANGE_END,
        )
    try:
        n_campaigns = sync_campaigns(bq_client, supabase, dry_run=dry_run)
        if run_id:
            finish_sync_run_success(supabase, run_id, n_campaigns)
        record_operational_event(
            supabase,
            event_type="system_change",
            category="sync_success",
            title="Sync Google Ads Campaigns successful",
            description=f"{n_campaigns} campaigns loaded.",
            impact_scope={**_scope_base, "source_platform": "google_ads", "data_source": "campaign_summary", "status": "success", "rows_loaded": n_campaigns},
            actor="system",
            dry_run=dry_run,
        )
    except Exception as exc:
        record_operational_event(
            supabase,
            event_type="system_change",
            category="sync_error",
            title="Sync Google Ads Campaigns failed",
            description=str(exc),
            impact_scope={**_scope_base, "source_platform": "google_ads", "data_source": "campaign_summary", "status": "error"},
            actor="system",
            dry_run=dry_run,
        )
        print(f"[sync_campaigns] ERROR: {exc}", flush=True)
        if run_id:
            finish_sync_run_error(supabase, run_id, str(exc))
        sys.exit(1)

    # ── kpi_cache_daily ────────────────────────────────────────────────────
    kpi_run_id = None
    if not dry_run:
        kpi_run_id = start_sync_run(
            supabase,
            workspace_id     = WOKE_WORKSPACE_ID,
            source_platform  = "google_ads",
            data_source      = "kpi_cache_daily",
            is_mock          = False,
            date_range_start = DATE_RANGE_START,
            date_range_end   = DATE_RANGE_END,
        )
    try:
        n_kpi = sync_kpi_cache_daily(bq_client, supabase, dry_run=dry_run)
        if kpi_run_id:
            finish_sync_run_success(supabase, kpi_run_id, n_kpi)
        record_operational_event(
            supabase,
            event_type="system_change",
            category="sync_success",
            title="Sync Google Ads KPI Cache successful",
            description=f"{n_kpi} KPI records loaded.",
            impact_scope={**_scope_base, "source_platform": "google_ads", "data_source": "kpi_cache_daily", "status": "success", "rows_loaded": n_kpi},
            actor="system",
            dry_run=dry_run,
        )
    except Exception as exc:
        record_operational_event(
            supabase,
            event_type="system_change",
            category="sync_error",
            title="Sync Google Ads KPI Cache failed",
            description=str(exc),
            impact_scope={**_scope_base, "source_platform": "google_ads", "data_source": "kpi_cache_daily", "status": "error"},
            actor="system",
            dry_run=dry_run,
        )
        print(f"[sync_kpi_cache_daily] ERROR: {exc}", flush=True)
        if kpi_run_id:
            finish_sync_run_error(supabase, kpi_run_id, str(exc))
        sys.exit(1)

    # ── keywords ───────────────────────────────────────────────────────────
    kw_run_id = None
    if not dry_run:
        kw_run_id = start_sync_run(
            supabase,
            workspace_id     = WOKE_WORKSPACE_ID,
            source_platform  = "google_ads",
            data_source      = "keyword_analysis",
            is_mock          = False,
            date_range_start = DATE_RANGE_START,
            date_range_end   = DATE_RANGE_END,
        )
    try:
        n_keywords = sync_keywords(bq_client, supabase, dry_run=dry_run)
        if kw_run_id:
            finish_sync_run_success(supabase, kw_run_id, n_keywords)
        record_operational_event(
            supabase,
            event_type="system_change",
            category="sync_success",
            title="Sync Google Ads Keywords successful",
            description=f"{n_keywords} keywords loaded.",
            impact_scope={**_scope_base, "source_platform": "google_ads", "data_source": "keyword_analysis", "status": "success", "rows_loaded": n_keywords},
            actor="system",
            dry_run=dry_run,
        )
    except Exception as exc:
        record_operational_event(
            supabase,
            event_type="system_change",
            category="sync_error",
            title="Sync Google Ads Keywords failed",
            description=str(exc),
            impact_scope={**_scope_base, "source_platform": "google_ads", "data_source": "keyword_analysis", "status": "error"},
            actor="system",
            dry_run=dry_run,
        )
        print(f"[sync_keywords] ERROR: {exc}", flush=True)
        if kw_run_id:
            finish_sync_run_error(supabase, kw_run_id, str(exc))
        sys.exit(1)

    # ── GA4 First Light ────────────────────────────────────────────────────
    # Runs only if GA4_DATASET is configured and has events_* tables.
    # tables/summary fetched once here; passed into sync, DQ, and insights to
    # avoid duplicate BigQuery round-trips.
    ga4_available = False
    ga4_tables:   list        = []
    ga4_summary:  dict | None = None
    n_ga4 = 0  # initialised here to prevent NameError if ga4_available stays False
    if GA4_DATASET:
        try:
            ga4_tables    = get_ga4_tables(bq_client, GA4_DATASET)
            ga4_available = len(ga4_tables) > 0
            if ga4_available:
                ga4_summary = get_ga4_first_light_summary(bq_client, GA4_DATASET, ga4_tables)
                n_ga4 = sync_ga4_first_light(
                    bq_client, supabase,
                    dry_run=dry_run,
                    tables=ga4_tables,
                    summary=ga4_summary,
                )
                print(f"[a_data_sync] GA4 first light: {n_ga4} record(s)", flush=True)
                record_operational_event(
                    supabase,
                    event_type="system_change",
                    category="sync_success",
                    title="Sync GA4 First Light successful",
                    description=f"{n_ga4} records loaded.",
                    impact_scope={**_scope_base, "source_platform": "ga4", "data_source": "ga4_first_light_summary", "status": "success", "rows_loaded": n_ga4},
                    actor="system",
                    dry_run=dry_run,
                )
                resolve_obsolete_insights(supabase, "ga4_not_configured", dry_run=dry_run)
                resolve_obsolete_insights(supabase, "ga4_configured_but_incomplete", dry_run=dry_run)
            else:
                print("[a_data_sync] GA4 dataset configured but no events_* tables found - skipping", flush=True)
                resolve_obsolete_insights(supabase, "ga4_not_configured", dry_run=dry_run)
        except Exception as exc:
            print(f"[sync_ga4] ERROR (technical failure): {exc}", flush=True)
            record_operational_event(
                supabase,
                event_type="system_change",
                category="sync_error",
                title="Sync GA4 First Light failed",
                description=str(exc),
                impact_scope={**_scope_base, "source_platform": "ga4", "data_source": "ga4_first_light_summary", "status": "error"},
                actor="system",
                dry_run=dry_run,
            )
            sys.exit(1)
    else:
        print("[a_data_sync] GA4_DATASET not configured - skipping GA4 sync", flush=True)

    # ── data quality ────────────────────────────────────────────────────────
    # Technical errors (connection, bad query, write failure) → exit 1.
    # A check returning status='failed' is data signal, not a pipeline error.
    try:
        dq_results = run_data_quality_checks(
            supabase,
            bq_client          = bq_client,
            ga4_dataset        = GA4_DATASET,
            measurement_config = measurement_config,
            ga4_tables         = ga4_tables,
            ga4_summary        = ga4_summary,
            dry_run            = dry_run,
        )
        if dry_run:
            print(
                f"[data_quality] --dry-run: would insert {len(dq_results)} quality checks",
                flush=True,
            )
        else:
            write_quality_reports(supabase, dq_results)
    except Exception as exc:
        print(f"[data_quality] ERROR (technical failure): {exc}", flush=True)
        sys.exit(1)

    semantic_dq_results = [
        r for r in dq_results if r.get("check_category") == "semantic_governance"
    ]

    # ── insights ────────────────────────────────────────────────────────────────
    # Technical errors (connection, bad query, write failure) → exit 1.
    # Quality blocking is data signal, not a pipeline error.
    if ENABLE_INSIGHTS:
        try:
            ins_results = generate_insights(
                supabase,
                ga4_available       = ga4_available,
                ga4_summary         = ga4_summary,
                measurement_config  = measurement_config,
                semantic_dq_results = semantic_dq_results,
            )
            if dry_run:
                print(
                    f"[insights] --dry-run: would upsert {len(ins_results)} insights",
                    flush=True,
                )
                for ins in ins_results:
                    print(
                        f"  [{ins['severity']:8}] {ins['insight_type']}: {ins['title']}",
                        flush=True,
                    )
            else:
                write_insights(supabase, ins_results)
        except Exception as exc:
            print(f"[insights] ERROR (technical failure): {exc}", flush=True)
            sys.exit(1)
    else:
        print("[insights] ENABLE_INSIGHTS=false - skipping", flush=True)

    print(
        f"[a_data_sync] done - campaigns={n_campaigns} kpi={n_kpi} keywords={n_keywords}",
        flush=True,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SynapseIQ A-Data Sync")
    parser.add_argument("--dry-run", action="store_true", help="Validate without writing to Supabase")
    args = parser.parse_args()
    main(dry_run=args.dry_run)
