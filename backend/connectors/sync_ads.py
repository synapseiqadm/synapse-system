import os
import sys
from datetime import date, datetime, timezone
from google.cloud import bigquery
from supabase import Client

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from config import (
    GCP_PROJECT_ID, GOOGLE_ADS_DATASET, GOOGLE_ADS_CUSTOMER_ID,
    WOKE_WORKSPACE_ID, DATE_RANGE_START, DATE_RANGE_END,
)


def ga4_real_data_available(bq_client: bigquery.Client, ga4_dataset: str) -> bool:
    if not ga4_dataset:
        return False
    query = f"""
        SELECT COUNT(*) AS cnt
        FROM `{GCP_PROJECT_ID}.{ga4_dataset}.INFORMATION_SCHEMA.TABLES`
        WHERE table_name LIKE 'events_%'
    """
    try:
        result = list(bq_client.query(query).result())
        return result[0].cnt > 0
    except Exception:
        return False


def can_use_mock_data(app_env: str, allow_mock: bool) -> bool:
    if app_env == "production":
        return False
    return allow_mock


def sync_campaigns(
    bq_client: bigquery.Client,
    supabase: Client,
    dry_run: bool = False,
) -> int:
    STATS_TABLE    = f"p_ads_CampaignStats_{GOOGLE_ADS_CUSTOMER_ID}"
    CAMPAIGN_TABLE = f"p_ads_Campaign_{GOOGLE_ADS_CUSTOMER_ID}"

    QUERY = f"""
        SELECT
            c.campaign_id,
            c.campaign_name                              AS name,
            SUM(s.metrics_cost_micros) / 1000000         AS cost,
            SUM(s.metrics_conversions)                   AS conv,
            SUM(s.metrics_conversions_value)             AS conv_value,
            SUM(s.metrics_clicks)                        AS clicks,
            SUM(s.metrics_impressions)                   AS impressions,
            c.daily_budget
        FROM `{GCP_PROJECT_ID}.{GOOGLE_ADS_DATASET}.{STATS_TABLE}` s
        JOIN (
            SELECT campaign_id, campaign_name,
                   MAX(campaign_budget_amount_micros) / 1000000 AS daily_budget
            FROM `{GCP_PROJECT_ID}.{GOOGLE_ADS_DATASET}.{CAMPAIGN_TABLE}`
            GROUP BY campaign_id, campaign_name
        ) c
          ON CAST(REGEXP_EXTRACT(s.campaign_base_campaign, r'/campaigns/(\\d+)') AS INT64)
             = c.campaign_id
        WHERE s.segments_date BETWEEN '{DATE_RANGE_START}' AND '{DATE_RANGE_END}'
        GROUP BY c.campaign_id, c.campaign_name, c.daily_budget
        HAVING cost > 0
        ORDER BY cost DESC
    """

    print(f"[sync_campaigns] source={STATS_TABLE} period={DATE_RANGE_START}..{DATE_RANGE_END}", flush=True)

    results = list(bq_client.query(QUERY).result())
    print(f"[sync_campaigns] {len(results)} rows from BigQuery", flush=True)

    if not results:
        print("[sync_campaigns] no rows with cost > 0 — skipping upsert", flush=True)
        return 0

    period_days = (
        date.fromisoformat(str(DATE_RANGE_END)) -
        date.fromisoformat(str(DATE_RANGE_START))
    ).days + 1

    now = datetime.now(timezone.utc).isoformat()
    records = []
    for row in results:
        cost        = float(row.cost)       if row.cost       else 0.0
        conv_value  = float(row.conv_value) if row.conv_value else 0.0
        roas        = round(conv_value / cost, 2) if cost > 0 else 0.0
        clicks      = int(row.clicks)       if row.clicks      else 0
        impressions = int(row.impressions)  if row.impressions else 0
        ctr         = round(clicks / impressions, 6) if impressions > 0 else 0.0
        try:
            daily_budget = float(row.daily_budget) if row.daily_budget is not None else None
        except Exception:
            daily_budget = None
        budget_total = round(daily_budget * period_days, 2) if daily_budget is not None else None
        records.append({
            "workspace_id":     WOKE_WORKSPACE_ID,
            "campaign_id":      str(row.campaign_id),
            "campaign_name":    row.name,
            "cost":             round(cost, 2),
            "conversions":      float(row.conv) if row.conv else 0.0,
            "roas":             roas,
            "clicks":           clicks,
            "impressions":      impressions,
            "ctr":              ctr,
            "daily_budget":     daily_budget,
            "budget_total":     budget_total,
            "data_source":      "google_ads",
            "source_platform":  "google_ads",
            "is_mock":          False,
            "date_range_start": str(DATE_RANGE_START),
            "date_range_end":   str(DATE_RANGE_END),
            "loaded_at":        now,
        })

    if dry_run:
        print(f"[sync_campaigns] --dry-run: would upsert {len(records)} records", flush=True)
        for r in records[:5]:
            ctr_pct = round(r["ctr"] * 100, 2)
            print(
                f"  {r['campaign_name']}: "
                f"Clicks: {r['clicks']}, Impressions: {r['impressions']}, "
                f"CTR: {ctr_pct}%, Cost: R${r['cost']}",
                flush=True,
            )
        return len(records)

    supabase.table("campaign_summary").upsert(
        records,
        on_conflict="workspace_id,campaign_id,date_range_start,date_range_end",
    ).execute()
    print(f"[sync_campaigns] upserted {len(records)} records", flush=True)
    return len(records)


def sync_keywords(
    bq_client: bigquery.Client,
    supabase: Client,
    dry_run: bool = False,
) -> int:
    STATS_TABLE    = f"ads_KeywordStats_{GOOGLE_ADS_CUSTOMER_ID}"
    KEYWORD_TABLE  = f"ads_Keyword_{GOOGLE_ADS_CUSTOMER_ID}"
    CAMPAIGN_TABLE = f"p_ads_Campaign_{GOOGLE_ADS_CUSTOMER_ID}"

    QUERY = f"""
        SELECT
            c.campaign_id,
            c.campaign_name,
            k.ad_group_criterion_keyword_text       AS keyword,
            k.ad_group_criterion_keyword_match_type AS match_type,
            SUM(s.metrics_clicks)                   AS clicks,
            SUM(s.metrics_cost_micros) / 1000000    AS cost,
            SUM(s.metrics_conversions)              AS conversions
        FROM `{GCP_PROJECT_ID}.{GOOGLE_ADS_DATASET}.{STATS_TABLE}` s
        JOIN (
            SELECT DISTINCT
                ad_group_criterion_criterion_id,
                ad_group_id,
                ad_group_criterion_keyword_text,
                ad_group_criterion_keyword_match_type,
                campaign_id
            FROM `{GCP_PROJECT_ID}.{GOOGLE_ADS_DATASET}.{KEYWORD_TABLE}`
        ) k
          ON  s.ad_group_criterion_criterion_id = k.ad_group_criterion_criterion_id
          AND s.ad_group_id                     = k.ad_group_id
        JOIN (
            SELECT DISTINCT campaign_id, campaign_name
            FROM `{GCP_PROJECT_ID}.{GOOGLE_ADS_DATASET}.{CAMPAIGN_TABLE}`
        ) c
          ON s.campaign_id = c.campaign_id
        WHERE s._DATA_DATE BETWEEN '{DATE_RANGE_START}' AND '{DATE_RANGE_END}'
        GROUP BY
            c.campaign_id, c.campaign_name,
            k.ad_group_criterion_keyword_text,
            k.ad_group_criterion_keyword_match_type
        HAVING clicks > 0
        ORDER BY cost DESC
    """

    print(f"[sync_keywords] source={STATS_TABLE} period={DATE_RANGE_START}..{DATE_RANGE_END}", flush=True)

    results = list(bq_client.query(QUERY).result())
    print(f"[sync_keywords] {len(results)} rows from BigQuery", flush=True)

    if not results:
        print("[sync_keywords] no rows with clicks > 0 — skipping upsert", flush=True)
        return 0

    now = datetime.now(timezone.utc).isoformat()
    records = []
    for row in results:
        cost = float(row.cost) if row.cost else 0.0
        records.append({
            "workspace_id":     WOKE_WORKSPACE_ID,
            "campaign_id":      str(row.campaign_id),
            "campaign_name":    row.campaign_name,
            "keyword":          row.keyword,
            "match_type":       row.match_type,
            "clicks":           int(row.clicks)        if row.clicks      else 0,
            "cost":             round(cost, 2),
            "conversions":      float(row.conversions) if row.conversions else 0.0,
            "data_source":      "google_ads",
            "source_platform":  "google_ads",
            "is_mock":          False,
            "date_range_start": str(DATE_RANGE_START),
            "date_range_end":   str(DATE_RANGE_END),
            "loaded_at":        now,
        })

    if dry_run:
        print(f"[sync_keywords] --dry-run: would upsert {len(records)} records", flush=True)
        return len(records)

    supabase.table("keyword_analysis").upsert(
        records,
        on_conflict="workspace_id,campaign_id,keyword,match_type,date_range_start,date_range_end",
    ).execute()
    print(f"[sync_keywords] upserted {len(records)} records", flush=True)
    return len(records)


def sync_kpi_cache_daily(
    bq_client: bigquery.Client,
    supabase: Client,
    dry_run: bool = False,
) -> int:
    STATS_TABLE = f"p_ads_CampaignStats_{GOOGLE_ADS_CUSTOMER_ID}"

    QUERY = f"""
        SELECT
            s.segments_date                          AS date,
            SUM(s.metrics_cost_micros) / 1000000     AS total_cost,
            SUM(s.metrics_conversions)               AS conversions,
            SUM(s.metrics_conversions_value)         AS conv_value
        FROM `{GCP_PROJECT_ID}.{GOOGLE_ADS_DATASET}.{STATS_TABLE}` s
        WHERE s.segments_date BETWEEN '{DATE_RANGE_START}' AND '{DATE_RANGE_END}'
        GROUP BY s.segments_date
        HAVING SUM(s.metrics_cost_micros) / 1000000 > 0
        ORDER BY s.segments_date
    """

    print(f"[sync_kpi_cache_daily] source={STATS_TABLE} period={DATE_RANGE_START}..{DATE_RANGE_END}", flush=True)

    results = list(bq_client.query(QUERY).result())
    n_days = len(results)
    print(f"[sync_kpi_cache_daily] {n_days} days from BigQuery", flush=True)

    if not results:
        print("[sync_kpi_cache_daily] no days with cost > 0 — skipping upsert", flush=True)
        return 0

    now = datetime.now(timezone.utc).isoformat()
    records = []
    for row in results:
        date       = str(row.date)
        total_cost = round(float(row.total_cost) if row.total_cost else 0.0, 4)
        conversions = round(float(row.conversions) if row.conversions else 0.0, 4)
        conv_value  = float(row.conv_value) if row.conv_value else 0.0
        roas        = round(conv_value / total_cost, 4) if total_cost > 0 else 0.0

        for metric_name, metric_value in (
            ("total_cost",  total_cost),
            ("conversions", conversions),
            ("roas",        roas),
        ):
            records.append({
                "workspace_id": WOKE_WORKSPACE_ID,
                "date":         date,
                "metric_name":  metric_name,
                "metric_value": metric_value,
                "channel":      "google_ads",
                "updated_at":   now,
            })

    if dry_run:
        print(
            f"[sync_kpi_cache_daily] --dry-run: {n_days} days × 3 metrics = {len(records)} records"
            f" would be upserted",
            flush=True,
        )
        return len(records)

    supabase.table("kpi_cache_daily").upsert(
        records,
        on_conflict="workspace_id,date,metric_name,channel",
    ).execute()
    print(f"[sync_kpi_cache_daily] upserted {len(records)} records ({n_days} days)", flush=True)
    return len(records)
