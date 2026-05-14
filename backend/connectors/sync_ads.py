import json
import os
import sys
import time as _time
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from google.cloud import bigquery
from google.api_core.exceptions import BadRequest as BQBadRequest
from supabase import Client

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from config import (
    GCP_PROJECT_ID, GOOGLE_ADS_DATASET, GOOGLE_ADS_CUSTOMER_ID,
    WORKSPACE_ID, DATE_RANGE_START, DATE_RANGE_END,
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
            ANY_VALUE(c.daily_budget)                    AS daily_budget
        FROM `{GCP_PROJECT_ID}.{GOOGLE_ADS_DATASET}.{STATS_TABLE}` s
        JOIN (
            SELECT campaign_id,
                   MAX(campaign_name)                           AS campaign_name,
                   MAX(campaign_budget_amount_micros) / 1000000 AS daily_budget
            FROM `{GCP_PROJECT_ID}.{GOOGLE_ADS_DATASET}.{CAMPAIGN_TABLE}`
            GROUP BY campaign_id
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
            "workspace_id":     WORKSPACE_ID,
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


def _parse_final_url(raw: str | None) -> str | None:
    """Normalise final_url regardless of BQ schema type.

    REPEATED STRING schemas return a plain string after ARRAY_AGG.
    STRING schemas may return a JSON-serialised array: '["https://..."]'.
    Both cases are unwrapped to a bare URL string, or None if absent.
    """
    if not raw:
        return None
    raw = raw.strip()
    if raw.startswith("["):
        try:
            parsed = json.loads(raw)
            return parsed[0] if parsed else None
        except (json.JSONDecodeError, IndexError):
            return None
    return raw or None


def _probe_url(url: str) -> tuple[int | None, int | None]:
    """HEAD-request a URL. Returns (http_status_code, load_time_ms). Both None on network error."""
    try:
        req = urllib.request.Request(
            url, method="HEAD", headers={"User-Agent": "SynapseIQ/1.0"},
        )
        t0 = _time.monotonic()
        with urllib.request.urlopen(req, timeout=8) as resp:
            ms = int((_time.monotonic() - t0) * 1000)
            return resp.status, ms
    except urllib.error.HTTPError as exc:
        return exc.code, None
    except Exception:
        return None, None


def sync_ad_groups(
    bq_client: bigquery.Client,
    supabase: Client,
    dry_run: bool = False,
) -> int:
    STATS_TABLE    = f"p_ads_AdGroupBasicStats_{GOOGLE_ADS_CUSTOMER_ID}"
    ADGROUP_TABLE  = f"p_ads_AdGroup_{GOOGLE_ADS_CUSTOMER_ID}"
    AD_TABLE       = f"p_ads_Ad_{GOOGLE_ADS_CUSTOMER_ID}"
    CAMPAIGN_TABLE = f"p_ads_Campaign_{GOOGLE_ADS_CUSTOMER_ID}"

    def _build_query(final_url_expr: str) -> str:
        return f"""
        WITH strength_by_group AS (
            SELECT
                ad_group_id,
                CASE MIN(CASE ad_group_ad_ad_strength
                    WHEN 'POOR'      THEN 0
                    WHEN 'AVERAGE'   THEN 1
                    WHEN 'GOOD'      THEN 2
                    WHEN 'EXCELLENT' THEN 3
                    ELSE 4 END)
                WHEN 0 THEN 'POOR'
                WHEN 1 THEN 'AVERAGE'
                WHEN 2 THEN 'GOOD'
                WHEN 3 THEN 'EXCELLENT'
                ELSE 'UNSPECIFIED' END AS worst_strength,
                {final_url_expr} AS final_url
            FROM `{GCP_PROJECT_ID}.{GOOGLE_ADS_DATASET}.{AD_TABLE}`
            WHERE ad_group_ad_status = 'ENABLED'
            GROUP BY ad_group_id
        )
        SELECT
            ag.ad_group_id,
            ag.ad_group_name,
            c.campaign_id,
            c.campaign_name,
            SUM(s.metrics_cost_micros) / 1000000 AS cost,
            SUM(s.metrics_clicks)                AS clicks,
            SUM(s.metrics_impressions)           AS impressions,
            SUM(s.metrics_conversions)           AS conversions,
            SUM(s.metrics_conversions_value)     AS conv_value,
            str.worst_strength,
            ANY_VALUE(str.final_url) AS final_url
        FROM `{GCP_PROJECT_ID}.{GOOGLE_ADS_DATASET}.{STATS_TABLE}` s
        JOIN (
            SELECT DISTINCT ad_group_id, ad_group_name
            FROM `{GCP_PROJECT_ID}.{GOOGLE_ADS_DATASET}.{ADGROUP_TABLE}`
        ) ag USING (ad_group_id)
        JOIN (
            SELECT DISTINCT campaign_id, campaign_name
            FROM `{GCP_PROJECT_ID}.{GOOGLE_ADS_DATASET}.{CAMPAIGN_TABLE}`
        ) c ON s.campaign_id = c.campaign_id
        LEFT JOIN strength_by_group str USING (ad_group_id)
        WHERE s.segments_date BETWEEN '{DATE_RANGE_START}' AND '{DATE_RANGE_END}'
        GROUP BY
            ag.ad_group_id, ag.ad_group_name,
            c.campaign_id, c.campaign_name,
            str.worst_strength
        HAVING SUM(s.metrics_cost_micros) / 1000000 > 0
        ORDER BY cost DESC
        """

    # Google Ads BQ exports final_urls as REPEATED STRING on some accounts and as
    # plain STRING on others. Try REPEATED first; fall back to STRING on schema mismatch.
    _EXPR_REPEATED = "ARRAY_AGG(ad_group_ad_ad_final_urls[SAFE_OFFSET(0)] IGNORE NULLS LIMIT 1)[SAFE_OFFSET(0)]"
    _EXPR_STRING   = "NULLIF(TRIM(MAX(CAST(ad_group_ad_ad_final_urls AS STRING))), '')"

    print(f"[sync_ad_groups] source={STATS_TABLE} period={DATE_RANGE_START}..{DATE_RANGE_END}", flush=True)

    try:
        results = list(bq_client.query(_build_query(_EXPR_REPEATED)).result())
    except BQBadRequest as exc:
        if "not supported on values of type STRING" in str(exc):
            print("[sync_ad_groups] final_urls is STRING type — retrying with MAX()", flush=True)
            results = list(bq_client.query(_build_query(_EXPR_STRING)).result())
        else:
            raise
    print(f"[sync_ad_groups] {len(results)} rows from BigQuery", flush=True)

    if not results:
        print("[sync_ad_groups] no rows — skipping upsert", flush=True)
        return 0

    # Deduplicate by ad_group_id — keep highest-cost row (export can produce duplicates
    # when the same ad_group_id appears under multiple campaign_id values in the snapshot)
    seen_groups: set[str] = set()
    deduped = []
    for row in sorted(results, key=lambda r: float(r.cost) if r.cost else 0.0, reverse=True):
        if str(row.ad_group_id) not in seen_groups:
            seen_groups.add(str(row.ad_group_id))
            deduped.append(row)
    results = deduped
    print(f"[sync_ad_groups] {len(results)} unique ad groups after dedup", flush=True)

    now = datetime.now(timezone.utc).isoformat()
    records = []
    for row in results:
        cost        = float(row.cost)       if row.cost       else 0.0
        conv_value  = float(row.conv_value) if row.conv_value else 0.0
        clicks      = int(row.clicks)       if row.clicks     else 0
        impressions = int(row.impressions)  if row.impressions else 0
        conversions = float(row.conversions) if row.conversions else 0.0
        roas        = round(conv_value / cost, 2) if cost > 0 else 0.0
        ctr         = round(clicks / impressions, 6) if impressions > 0 else 0.0
        records.append({
            "workspace_id":     WORKSPACE_ID,
            "ad_group_id":      str(row.ad_group_id),
            "ad_group_name":    row.ad_group_name,
            "campaign_id":      str(row.campaign_id),
            "campaign_name":    row.campaign_name,
            "cost":             round(cost, 2),
            "clicks":           clicks,
            "impressions":      impressions,
            "ctr":              ctr,
            "conversions":      conversions,
            "roas":             roas,
            "ad_strength":      row.worst_strength or "UNSPECIFIED",
            "final_url":        _parse_final_url(row.final_url),
            "http_status_code": None,
            "load_time_ms":     None,
            "date_range_start": str(DATE_RANGE_START),
            "date_range_end":   str(DATE_RANGE_END),
            "loaded_at":        now,
        })

    # HTTP probe — dedup by URL to avoid duplicate requests
    probed: dict[str, tuple[int | None, int | None]] = {}
    for rec in records:
        url = rec.get("final_url")
        if url and url not in probed:
            print(f"[sync_ad_groups] probing {url}", flush=True)
            probed[url] = _probe_url(url)
    for rec in records:
        url = rec.get("final_url")
        if url and url in probed:
            rec["http_status_code"], rec["load_time_ms"] = probed[url]

    if dry_run:
        print(f"[sync_ad_groups] --dry-run: would upsert {len(records)} records", flush=True)
        for r in records[:5]:
            print(
                f"  {r['ad_group_name']}: cost=R${r['cost']} ctr={r['ctr']*100:.2f}% "
                f"conv={r['conversions']} strength={r['ad_strength']} "
                f"url={r['final_url']} status={r['http_status_code']}",
                flush=True,
            )
        return len(records)

    supabase.table("ad_group_summary").upsert(
        records,
        on_conflict="workspace_id,ad_group_id,date_range_start,date_range_end",
    ).execute()
    print(f"[sync_ad_groups] upserted {len(records)} records", flush=True)
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
            "workspace_id":     WORKSPACE_ID,
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
                "workspace_id": WORKSPACE_ID,
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
