import os
import sys
from datetime import datetime, timezone
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
            SUM(s.metrics_conversions_value)             AS conv_value
        FROM `{GCP_PROJECT_ID}.{GOOGLE_ADS_DATASET}.{STATS_TABLE}` s
        JOIN (
            SELECT DISTINCT campaign_id, campaign_name
            FROM `{GCP_PROJECT_ID}.{GOOGLE_ADS_DATASET}.{CAMPAIGN_TABLE}`
        ) c
          ON CAST(REGEXP_EXTRACT(s.campaign_base_campaign, r'/campaigns/(\\d+)') AS INT64)
             = c.campaign_id
        WHERE s.segments_date BETWEEN '{DATE_RANGE_START}' AND '{DATE_RANGE_END}'
        GROUP BY c.campaign_id, c.campaign_name
        HAVING cost > 0
        ORDER BY cost DESC
    """

    print(f"[sync_campaigns] source={STATS_TABLE} period={DATE_RANGE_START}..{DATE_RANGE_END}", flush=True)

    results = list(bq_client.query(QUERY).result())
    print(f"[sync_campaigns] {len(results)} rows from BigQuery", flush=True)

    if not results:
        print("[sync_campaigns] no rows with cost > 0 — skipping upsert", flush=True)
        return 0

    now = datetime.now(timezone.utc).isoformat()
    records = []
    for row in results:
        cost       = float(row.cost)       if row.cost       else 0.0
        conv_value = float(row.conv_value) if row.conv_value else 0.0
        roas       = round(conv_value / cost, 2) if cost > 0 else 0.0
        records.append({
            "workspace_id":     WOKE_WORKSPACE_ID,
            "campaign_id":      str(row.campaign_id),
            "campaign_name":    row.name,
            "cost":             round(cost, 2),
            "conversions":      float(row.conv) if row.conv else 0.0,
            "roas":             roas,
            "data_source":      "google_ads",
            "source_platform":  "google_ads",
            "is_mock":          False,
            "date_range_start": str(DATE_RANGE_START),
            "date_range_end":   str(DATE_RANGE_END),
            "loaded_at":        now,
        })

    if dry_run:
        print(f"[sync_campaigns] --dry-run: would upsert {len(records)} records", flush=True)
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
