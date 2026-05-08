#!/usr/bin/env python3
"""
A-Data Sync — entry point for the SynapseIQ data pipeline.

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
    ENABLE_INSIGHTS,
)
from sync_runs import start_sync_run, finish_sync_run_success, finish_sync_run_error
from sync_ads import sync_campaigns, sync_keywords, ga4_real_data_available
from data_quality import run_data_quality_checks, write_quality_reports
from insights import generate_insights, write_insights


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

    if ga4_real_data_available(bq_client, GA4_DATASET):
        print("[a_data_sync] GA4 data detected — GA4 sync not yet implemented", flush=True)
    else:
        print("[a_data_sync] GA4 not configured — skipping", flush=True)

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
    except Exception as exc:
        print(f"[sync_campaigns] ERROR: {exc}", flush=True)
        if run_id:
            finish_sync_run_error(supabase, run_id, str(exc))
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
    except Exception as exc:
        print(f"[sync_keywords] ERROR: {exc}", flush=True)
        if kw_run_id:
            finish_sync_run_error(supabase, kw_run_id, str(exc))
        sys.exit(1)

    # ── data quality ────────────────────────────────────────────────────────
    # Technical errors (connection, bad query, write failure) → exit 1.
    # A check returning status='failed' is data signal, not a pipeline error.
    try:
        dq_results = run_data_quality_checks(supabase)
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

    # ── insights ────────────────────────────────────────────────────────────────
    # Technical errors (connection, bad query, write failure) → exit 1.
    # Quality blocking is data signal, not a pipeline error.
    if ENABLE_INSIGHTS:
        try:
            ins_results = generate_insights(supabase)
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
        print("[insights] ENABLE_INSIGHTS=false — skipping", flush=True)

    print(
        f"[a_data_sync] done — campaigns={n_campaigns} keywords={n_keywords}",
        flush=True,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SynapseIQ A-Data Sync")
    parser.add_argument("--dry-run", action="store_true", help="Validate without writing to Supabase")
    args = parser.parse_args()
    main(dry_run=args.dry_run)
