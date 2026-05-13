import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveWorkspace } from "@/lib/resolve-workspace";

export const dynamic   = "force-dynamic";
export const revalidate = 0;

// Checks that affect reliability of all performance diagnosis
const TRACKING_CHECKS = new Set([
  "ga4_dataset_available",
  "ga4_ads_overlap_insufficient",
  "utm_campaign_empty_in_paid_urls",
  "ga4_non_production_traffic_detected",
  "ga4_suspicious_event_names_detected",
]);

const GOOGLE_ADS_CHECKS = new Set([
  "campaign_summary_missing_campaign_id",
  "campaign_summary_zero_conversions_with_cost",
  "keyword_analysis_zero_conversions_with_cost",
  "campaign_summary_freshness",
  "keyword_analysis_freshness",
  "mock_data_presence",
]);

const GA4_CHECKS = new Set([
  "ga4_dataset_available",
  "ga4_events_freshness",
  "ga4_has_page_view",
  "ga4_has_session_start",
  "ga4_has_conversion_events",
]);

function formatRelativeTime(ts: string | null): string | null {
  if (!ts) return null;
  const diffH = (Date.now() - new Date(ts).getTime()) / 3_600_000;
  if (diffH < 1) return "Menos de 1h atrás";
  if (diffH < 24) return `${Math.round(diffH)}h atrás`;
  const diffD = Math.floor(diffH / 24);
  return diffD === 1 ? "Ontem" : `${diffD} dias atrás`;
}

function mapSyncStatus(status: string | undefined): "synced" | "pending" | "error" {
  if (status === "success") return "synced";
  if (status === "error")   return "error";
  return "pending";
}

type SyncRun = { status: string; finished_at: string; rows_loaded: number; error_message: string | null };
type QualityRow = { check_name: string; status: string; severity: string };

function qualitySummary(checks: QualityRow[], checkSet: Set<string>) {
  const relevant = checks.filter((r) => checkSet.has(r.check_name));
  return {
    passed:  relevant.filter((r) => r.status === "passed").length,
    warning: relevant.filter((r) => r.status === "warning").length,
    failed:  relevant.filter((r) => r.status === "failed").length,
    total:   relevant.length,
  };
}

export async function GET() {
  try {
    const supabase  = await createClient();
    const workspace = await resolveWorkspace(supabase);
    if (!workspace) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const [gAdsRes, ga4Res, qualityRes] = await Promise.all([
      supabase
        .from("sync_runs")
        .select("status, finished_at, rows_loaded, error_message")
        .eq("workspace_id", workspace.id)
        .eq("source_platform", "google_ads")
        .eq("is_mock", false)
        .not("finished_at", "is", null)
        .order("finished_at", { ascending: false })
        .limit(1),
      supabase
        .from("sync_runs")
        .select("status, finished_at, rows_loaded, error_message")
        .eq("workspace_id", workspace.id)
        .eq("source_platform", "ga4")
        .eq("is_mock", false)
        .not("finished_at", "is", null)
        .order("finished_at", { ascending: false })
        .limit(1),
      supabase
        .from("data_quality_report")
        .select("check_name, status, severity")
        .eq("workspace_id", workspace.id)
        .order("checked_at", { ascending: false })
        .limit(100),
    ]);

    const gAdsRun = (gAdsRes.data?.[0] ?? null) as SyncRun | null;
    const ga4Run  = (ga4Res.data?.[0]  ?? null) as SyncRun | null;

    // Deduplicate: keep most recent per check_name
    const seen = new Set<string>();
    const latestChecks: QualityRow[] = (qualityRes.data ?? []).filter((r) => {
      if (seen.has(r.check_name)) return false;
      seen.add(r.check_name);
      return true;
    });

    const trackingIssues = latestChecks
      .filter((r) => TRACKING_CHECKS.has(r.check_name) && r.status !== "passed")
      .map(({ check_name, status, severity }) => ({ check_name, status, severity }));

    return NextResponse.json({
      ok: true,
      data: {
        google_ads: {
          status:       mapSyncStatus(gAdsRun?.status),
          lastSync:     formatRelativeTime(gAdsRun?.finished_at ?? null),
          rowsLoaded:   gAdsRun?.rows_loaded ?? 0,
          errorMessage: gAdsRun?.error_message ?? null,
          quality:      qualitySummary(latestChecks, GOOGLE_ADS_CHECKS),
        },
        ga4: {
          status:       mapSyncStatus(ga4Run?.status),
          lastSync:     formatRelativeTime(ga4Run?.finished_at ?? null),
          rowsLoaded:   ga4Run?.rows_loaded ?? 0,
          errorMessage: ga4Run?.error_message ?? null,
          quality:      qualitySummary(latestChecks, GA4_CHECKS),
        },
        tracking_issues: trackingIssues,
      },
    });
  } catch (err) {
    console.error("[connectors/status]", err);
    return NextResponse.json({ ok: false, error: "Unexpected error" }, { status: 500 });
  }
}
