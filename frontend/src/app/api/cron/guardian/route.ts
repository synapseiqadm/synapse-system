import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendGuardianAlert } from "@/lib/mail";

// ─── Config ───────────────────────────────────────────────────────────────────

const CRON_SECRET  = process.env.CRON_SECRET         ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY ?? "";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ALERT_TO     = process.env.ALERT_EMAIL_TO ?? "ervin.moriyama@gmail.com";

// ─── Types ────────────────────────────────────────────────────────────────────

type DecisionRow = {
  id:           string;
  workspace_id: string;
  agent_id:     string;
  title:        string;
  body:         string;
  impact_value: string | null;
  metadata:     { is_critical?: boolean; total_waste?: number } | null;
};

type AlertResult = { id: string; sent: boolean; reason: string };

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // 1. Verify CRON_SECRET — Vercel sends: Authorization: Bearer <CRON_SECRET>
  const auth = request.headers.get("authorization");
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!SERVICE_KEY) {
    console.error("[guardian] SUPABASE_SERVICE_KEY not configured");
    return NextResponse.json({ error: "Service key not configured" }, { status: 503 });
  }

  // Admin client: bypasses RLS for server-only operations
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 2. Fetch pending critical alert decisions from the last 24h
  //    NOTE: agent_decisions has no priority_score column;
  //    P1 is derived from type='alert' + metadata.is_critical=true (set by Anomaly Scout
  //    when total_waste >= R$500, which maps to priority_score=5 in narrative terms)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: rawDecisions, error: fetchError } = await supabase
    .from("agent_decisions")
    .select("id, workspace_id, agent_id, title, body, impact_value, metadata")
    .eq("type", "alert")
    .eq("status", "pending")
    .gt("created_at", since);

  if (fetchError) {
    console.error("[guardian] fetch error:", fetchError.message);
    return NextResponse.json({ error: "DB query failed" }, { status: 502 });
  }

  // Filter critical decisions client-side (metadata.is_critical = true)
  const decisions: DecisionRow[] = (rawDecisions ?? []).filter(
    (d) => d.metadata?.is_critical === true,
  );

  if (decisions.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, sent: 0, results: [] });
  }

  const results: AlertResult[] = [];

  for (const d of decisions) {
    // 3. Idempotency: check if this decision was already alerted in the last 24h
    const { data: existing } = await supabase
      .from("operational_events")
      .select("id")
      .eq("workspace_id", d.workspace_id)
      .eq("event_type", "guardian_alert")
      .contains("impact_scope", { decision_id: d.id })
      .gt("occurred_at", since)
      .limit(1);

    if ((existing ?? []).length > 0) {
      results.push({ id: d.id, sent: false, reason: "already_alerted" });
      continue;
    }

    // 4. Send alert email
    const { ok } = await sendGuardianAlert({
      to:           ALERT_TO,
      agent_id:     d.agent_id,
      title:        d.title,
      body:         d.body,
      impact_value: d.impact_value ?? null,
      decision_id:  d.id,
    });

    if (!ok) {
      results.push({ id: d.id, sent: false, reason: "send_failed" });
      continue;
    }

    // 5. Record alert in operational_events (prevents re-send in next cron cycle)
    const { error: logError } = await supabase.from("operational_events").insert({
      workspace_id: d.workspace_id,
      event_type:   "guardian_alert",
      category:     "guardian_alert",
      impact_scope: {
        decision_id:  d.id,
        recipient:    ALERT_TO,
        total_waste:  d.metadata?.total_waste ?? null,
      },
      actor:       "system:guardian",
      occurred_at: new Date().toISOString(),
    });

    if (logError) {
      console.warn("[guardian] failed to log alert event:", logError.message);
    }

    results.push({ id: d.id, sent: true, reason: "ok" });
  }

  const sent = results.filter((r) => r.sent).length;
  console.log(`[guardian] processed=${results.length} sent=${sent}`);

  return NextResponse.json({
    ok:        true,
    processed: results.length,
    sent,
    results,
  });
}
