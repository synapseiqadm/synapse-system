"""
agent_decisions.py — SynapseIQ v2.2
Generates and persists multi-agent decisions from campaign data.

Agents:
  Growth Master   — ROAS > 3.0x → suggest 20% budget increase
  Creative Critic — CTR drop > 15% D-1 vs D-8 → suggest creative review
  Anomaly Scout   — spend > 0 + conversions = 0 → P1 waste alert

Uses insert-only pattern to preserve approved/rejected status across re-syncs.
The preserve_agent_decision_status DB trigger prevents upserts from resetting
decisions the user has already actioned.
"""

from typing import Any

_ROAS_THRESHOLD   = 3.0    # min ROAS to suggest budget scale
_COST_MIN         = 50.0   # min spend to consider for Growth Master (noise filter)
_CTR_DROP_LIMIT   = -15.0  # % delta threshold for Creative Critic
_WASTE_CRITICAL   = 500.0  # R$ threshold for P1 CRÍTICO classification


def generate_agent_decisions(
    supabase,
    workspace_id: str,
    campaign_rows: list[dict],
    snapshot_rows: list[dict],
    dry_run: bool = False,
) -> int:
    """
    Generate and persist agent decisions. Returns number of new rows inserted.

    campaign_rows : deduplicated rows from campaign_summary (most recent per campaign)
    snapshot_rows : output of fn_campaign_snapshot_delta (may be empty if D-8 unavailable)
    """
    decisions: list[dict[str, Any]] = []

    # ── Growth Master: high ROAS → suggest 20% budget increase ───────────────
    for row in campaign_rows:
        roas = float(row.get("roas") or 0)
        cost = float(row.get("cost") or 0)
        if roas < _ROAS_THRESHOLD or cost < _COST_MIN:
            continue
        name = row["campaign_name"]
        incr = cost * 0.20
        decisions.append({
            "agent_id":     "growth-master",
            "type":         "suggestion",
            "title":        f"Escalar budget — {name} (ROAS {roas:.2f}x)",
            "body":         (
                f"Campanha com ROAS {roas:.2f}x (threshold: {_ROAS_THRESHOLD:.1f}x) no período. "
                f"Sugestão: aumentar budget em 20%. Sujeito à aprovação do gestor."
            ),
            "rationale":    (
                f"Critério: ROAS ≥ {_ROAS_THRESHOLD:.1f}x com spend ≥ R${_COST_MIN:.0f}. "
                f"ROAS actual = {roas:.2f}x. Aumento de 20% projecta ganho proporcional."
            ),
            "impact_value": f"+R${incr:.2f}/período (estimativa conservadora)",
            "metadata":     {
                "campaign_name":       name,
                "roas":                roas,
                "current_cost":        cost,
                "budget_increase_pct": 20,
                "projected_gain_brl":  round(incr, 2),
            },
            "dedupe_key":   f"growth-master-scale-{name}",
        })

    # ── Creative Critic: CTR drop > 15% D-1 vs D-8 ────────────────────────
    for row in snapshot_rows:
        if row.get("metric_name") != "ctr":
            continue
        delta = float(row.get("delta_percentage") or 0)
        if delta > _CTR_DROP_LIMIT:
            continue
        name     = row["campaign_name"]
        ctr_now  = float(row.get("value_now")  or 0)
        ctr_then = float(row.get("value_then") or 0)
        decisions.append({
            "agent_id":     "creative-critic",
            "type":         "suggestion",
            "title":        f"Fadiga de criativo — {name} (CTR {delta:.1f}%)",
            "body":         (
                f"CTR caiu de {ctr_then:.2f}% para {ctr_now:.2f}% ({delta:.1f}%) em D-1 vs D-8. "
                f"Possível fadiga criativa. Sugestão: pausar criativos de baixo desempenho "
                f"e testar novos ângulos criativos."
            ),
            "rationale":    (
                f"Critério: queda de CTR > {abs(_CTR_DROP_LIMIT):.0f}% (D-1 vs D-8). "
                f"CTR actual = {ctr_now:.2f}%, anterior = {ctr_then:.2f}%, delta = {delta:.1f}%."
            ),
            "impact_value": f"CTR: {ctr_now:.2f}% ← {ctr_then:.2f}% (−{abs(delta):.1f}%)",
            "metadata":     {
                "campaign_name": name,
                "ctr_now":       ctr_now,
                "ctr_then":      ctr_then,
                "delta_pct":     delta,
            },
            "dedupe_key":   f"creative-critic-ctr-{name}",
        })

    # ── Anomaly Scout: spend > 0 + conversions = 0 ────────────────────────
    zero_conv   = [
        r for r in campaign_rows
        if float(r.get("cost") or 0) > 0 and float(r.get("conversions") or 0) == 0
    ]
    total_waste = sum(float(r.get("cost") or 0) for r in zero_conv)

    if zero_conv:
        names_list  = [r["campaign_name"] for r in zero_conv]
        names_head  = "; ".join(names_list[:5])
        overflow    = f" +{len(names_list) - 5} mais" if len(names_list) > 5 else ""
        is_critical = total_waste >= _WASTE_CRITICAL

        decisions.append({
            "agent_id":     "anomaly-scout",
            "type":         "alert",
            "title":        f"R$ {total_waste:.2f} em gasto sem conversão — {len(zero_conv)} campanha(s)",
            "body":         f"Campanhas com spend > R$0 e conversões = 0: {names_head}{overflow}.",
            "rationale":    (
                "Critério: spend > 0 AND conversions = 0. P1 — DRENO DE VERBA."
                + (" Total > R$500 → CRÍTICO (priority_score = 5)." if is_critical else "")
            ),
            "impact_value": f"Waste total: R$ {total_waste:.2f}",
            "metadata":     {
                "campaigns":   [
                    {"name": r["campaign_name"], "cost": float(r.get("cost") or 0)}
                    for r in zero_conv
                ],
                "total_waste":  round(total_waste, 2),
                "is_critical":  is_critical,
            },
            "dedupe_key":   "anomaly-scout-zero-conv",
        })

        decisions.append({
            "agent_id":     "anomaly-scout",
            "type":         "suggestion",
            "title":        f"Pausar {len(zero_conv)} campanha(s) com zero conversão",
            "body":         (
                f"Recomendação: pausar as {len(zero_conv)} campanhas identificadas "
                f"até revisão de estratégia e realinhamento de público. "
                f"Sujeito à aprovação do gestor."
            ),
            "rationale":    (
                "PROIBIDO — Execução: advisory only. "
                "Requer aprovação explícita do gestor antes de qualquer pausa ou modificação."
            ),
            "impact_value": f"Economia estimada: R$ {total_waste:.2f}/período",
            "metadata":     {"campaigns": names_list, "total_waste": round(total_waste, 2)},
            "dedupe_key":   "anomaly-scout-zero-conv-suggestion",
        })

    if not decisions:
        print("[agent_decisions] no decisions to generate", flush=True)
        return 0

    if dry_run:
        print(
            f"[agent_decisions] --dry-run: would insert up to {len(decisions)} decisions",
            flush=True,
        )
        for d in decisions:
            print(
                f"  [{d['agent_id']:15}] {d['type']:10}  {d['title'][:60]}",
                flush=True,
            )
        return 0

    # Insert-only: fetch existing dedupe_keys so we don't reset approved/rejected status
    try:
        existing_res  = supabase.table("agent_decisions").select("dedupe_key").eq("workspace_id", workspace_id).execute()
        existing_keys = {r["dedupe_key"] for r in (existing_res.data or [])}
    except Exception as exc:
        print(f"[agent_decisions] WARNING: could not fetch existing keys: {exc}", flush=True)
        existing_keys = set()

    new_rows = [
        {**d, "workspace_id": workspace_id}
        for d in decisions
        if d["dedupe_key"] not in existing_keys
    ]

    skipped = len(decisions) - len(new_rows)
    if new_rows:
        try:
            supabase.table("agent_decisions").insert(new_rows).execute()
            print(
                f"[agent_decisions] inserted {len(new_rows)} new decisions"
                + (f" ({skipped} already persisted)" if skipped else ""),
                flush=True,
            )
        except Exception as exc:
            print(f"[agent_decisions] WARNING: insert failed: {exc}", flush=True)
            return 0
    else:
        print(
            f"[agent_decisions] all {len(decisions)} decisions already persisted — no new inserts",
            flush=True,
        )

    return len(new_rows)
