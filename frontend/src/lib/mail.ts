import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM          = process.env.ALERT_EMAIL_FROM ?? "alerts@synapseiq.com";
const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://synapse-iq.vercel.app";

export type GuardianAlertPayload = {
  to:           string;
  agent_id:     string;
  title:        string;
  body:         string;
  impact_value: string | null;
  decision_id:  string;
};

export async function sendGuardianAlert(
  payload: GuardianAlertPayload,
): Promise<{ ok: boolean; id?: string }> {
  if (!resend) {
    console.warn("[mail] RESEND_API_KEY absent — mock alert for decision", payload.decision_id);
    console.log("[mail] Would send to:", payload.to, "| title:", payload.title);
    return { ok: true, id: "mock" };
  }

  const { data, error } = await resend.emails.send({
    from:    FROM,
    to:      payload.to,
    subject: `⚠ SynapseIQ P1 — ${payload.title}`,
    html:    buildHtml(payload),
  });

  if (error) {
    console.error("[mail] Resend error:", error);
    return { ok: false };
  }

  return { ok: true, id: data?.id };
}

function buildHtml(p: GuardianAlertPayload): string {
  const agentLabel: Record<string, string> = {
    "anomaly-scout":  "Anomaly Scout",
    "growth-master":  "Growth Master",
    "creative-critic": "Creative Critic",
  };

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:32px 16px;background:#09090b;font-family:'Courier New',monospace;">
  <div style="max-width:560px;margin:0 auto;border:1px solid #dc2626;border-radius:10px;overflow:hidden;">

    <!-- Header -->
    <div style="background:#1a0a0a;padding:16px 24px;border-bottom:1px solid #dc2626;">
      <p style="margin:0;color:#dc2626;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:.12em;">
        ⚠ SynapseIQ · Alerta Crítico P1
      </p>
    </div>

    <!-- Body -->
    <div style="padding:24px;background:#0d0d0d;">
      <h2 style="margin:0 0 10px;color:#f1f5f9;font-size:16px;line-height:1.3;">${p.title}</h2>
      <p style="margin:0 0 22px;color:#94a3b8;font-size:13px;line-height:1.6;">${p.body}</p>

      <!-- Meta card -->
      <div style="background:#111;border:1px solid #27272a;border-radius:6px;padding:14px 16px;margin-bottom:22px;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <tr>
            <td style="color:#52525b;text-transform:uppercase;font-size:10px;padding-bottom:8px;">Agente</td>
            <td style="color:#e2e8f0;text-align:right;padding-bottom:8px;">
              ${agentLabel[p.agent_id] ?? p.agent_id}
            </td>
          </tr>
          ${p.impact_value ? `
          <tr>
            <td style="color:#52525b;text-transform:uppercase;font-size:10px;">Impacto estimado</td>
            <td style="color:#fca5a5;font-weight:bold;text-align:right;">${p.impact_value}</td>
          </tr>` : ""}
        </table>
      </div>

      <!-- CTA -->
      <a href="${DASHBOARD_URL}/agents"
         style="display:inline-block;background:#dc2626;color:#fff;padding:11px 22px;border-radius:6px;text-decoration:none;font-size:12px;font-weight:bold;letter-spacing:.03em;">
        Revisar Decisão no Dashboard →
      </a>
    </div>

    <!-- Footer -->
    <div style="background:#0a0a0a;padding:12px 24px;border-top:1px solid #1a1a1a;">
      <p style="margin:0;color:#3f3f46;font-size:10px;">
        SynapseIQ Guardian · Este alerta não requer resposta directa ao e-mail.<br>
        decision_id: ${p.decision_id} · ${new Date().toISOString()}
      </p>
    </div>

  </div>
</body>
</html>`;
}
