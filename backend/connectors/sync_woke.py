import os
import sys
from google.cloud import bigquery
from supabase import create_client, Client
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding="utf-8")

# Carrega as variáveis do .env
load_dotenv()

# ==========================================
# CONFIGURAÇÕES
# ==========================================
WOKE_WORKSPACE_ID = "a082fe86-a65f-4c9b-9442-fe775f47e3fc"

# Local dev fallback — CI sets this via environment/secret before importing
os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", r"D:\dev\synapse\credentials.json")
# Inicializa clientes
try:
    bq_client = bigquery.Client(project="synapsesystem", location="southamerica-east1")
    supabase: Client = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))
except Exception as e:
    print(f"❌ Erro ao inicializar clientes: {e}")

def sync_real_campaigns():
    STATS_TABLE    = "p_ads_CampaignStats_6627867790"
    CAMPAIGN_TABLE = "p_ads_Campaign_6627867790"

    QUERY = f"""
        SELECT
            c.campaign_name                              AS name,
            SUM(s.metrics_cost_micros) / 1000000         AS cost,
            SUM(s.metrics_conversions)                   AS conv,
            SUM(s.metrics_conversions_value)             AS conv_value
        FROM `synapsesystem.raw_google_ads_woke.{STATS_TABLE}` s
        JOIN (
            SELECT DISTINCT campaign_id, campaign_name
            FROM `synapsesystem.raw_google_ads_woke.{CAMPAIGN_TABLE}`
        ) c
          ON CAST(REGEXP_EXTRACT(s.campaign_base_campaign, r'/campaigns/(\\d+)') AS INT64)
             = c.campaign_id
        WHERE s.segments_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
        GROUP BY 1
        HAVING cost > 0
        ORDER BY cost DESC
    """
    
    print(f"🔍 Consultando BigQuery na tabela {STATS_TABLE}...")
    
    try:
        query_job = bq_client.query(QUERY)
        results = query_job.result()
        
        campaign_records = []
        for row in results:
            cost       = float(row.cost)       if row.cost       else 0.0
            conv_value = float(row.conv_value) if row.conv_value else 0.0
            roas       = round(conv_value / cost, 2) if cost > 0 else 0.0

            campaign_records.append({
                "workspace_id":  WOKE_WORKSPACE_ID,
                "campaign_name": row.name,
                "cost":          round(cost, 2),
                "conversions":   int(row.conv) if row.conv else 0,
                "roas":          roas
            })

        if campaign_records:
            print(f"🗑️  Limpando registos antigos do workspace...")
            supabase.table("campaign_summary").delete().eq(
                "workspace_id", WOKE_WORKSPACE_ID
            ).execute()

            print(f"📦 Inserindo {len(campaign_records)} campanhas com nomes reais...")
            supabase.table("campaign_summary").insert(campaign_records).execute()
            print("✅ Sucesso! As campanhas reais da Woke já estão no Supabase.")
        else:
            print("⚠️ Nenhuma campanha com investimento encontrada.")

    except Exception as e:
        print(f"❌ Erro na extração: {e}")

def sync_keywords():
    STATS_TABLE    = "ads_KeywordStats_6627867790"
    KEYWORD_TABLE  = "ads_Keyword_6627867790"
    CAMPAIGN_TABLE = "p_ads_Campaign_6627867790"

    QUERY = f"""
        SELECT
            c.campaign_name,
            k.ad_group_criterion_keyword_text       AS keyword,
            k.ad_group_criterion_keyword_match_type AS match_type,
            SUM(s.metrics_clicks)                   AS clicks,
            SUM(s.metrics_cost_micros) / 1000000    AS cost,
            SUM(s.metrics_conversions)              AS conversions
        FROM `synapsesystem.raw_google_ads_woke.{STATS_TABLE}` s
        JOIN (
            SELECT DISTINCT
                ad_group_criterion_criterion_id,
                ad_group_id,
                ad_group_criterion_keyword_text,
                ad_group_criterion_keyword_match_type,
                campaign_id
            FROM `synapsesystem.raw_google_ads_woke.{KEYWORD_TABLE}`
        ) k
          ON  s.ad_group_criterion_criterion_id = k.ad_group_criterion_criterion_id
          AND s.ad_group_id                     = k.ad_group_id
        JOIN (
            SELECT DISTINCT campaign_id, campaign_name
            FROM `synapsesystem.raw_google_ads_woke.{CAMPAIGN_TABLE}`
        ) c
          ON s.campaign_id = c.campaign_id
        WHERE s._DATA_DATE >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
        GROUP BY 1, 2, 3
        HAVING clicks > 0
        ORDER BY cost DESC
    """

    print(f"🔍 Consultando keywords no BigQuery ({STATS_TABLE})...")

    try:
        results = list(bq_client.query(QUERY).result())
        print(f"   {len(results)} keywords encontradas com cliques > 0.")

        if not results:
            print("⚠️  Nenhuma keyword com cliques encontrada.")
            return

        records = []
        for row in results:
            cost = float(row.cost) if row.cost else 0.0
            records.append({
                "workspace_id":  WOKE_WORKSPACE_ID,
                "campaign_name": row.campaign_name,
                "keyword":       row.keyword,
                "match_type":    row.match_type,
                "clicks":        int(row.clicks)       if row.clicks       else 0,
                "cost":          round(cost, 2),
                "conversions":   int(float(row.conversions)) if row.conversions else 0,
            })

        print(f"📦 Enviando {len(records)} keywords para o Supabase (keyword_analysis)...")
        supabase.table("keyword_analysis").upsert(
            records,
            on_conflict="workspace_id,campaign_name,keyword"
        ).execute()
        print("✅ Keywords sincronizadas com sucesso!")

    except Exception as e:
        print(f"❌ Erro na extração de keywords: {e}")


if __name__ == "__main__":
    sync_real_campaigns()
    sync_keywords()