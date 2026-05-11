import os
import sys
from datetime import datetime, timezone
from typing import Optional
from supabase import Client

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from config import WOKE_WORKSPACE_ID, APP_ENV


def record_operational_event(
    supabase: Client,
    event_type: str,
    category: str,
    title: str,
    description: Optional[str],
    impact_scope: dict,
    actor: str = "system",
    evidence_id: Optional[str] = None,
    dry_run: bool = False,
):
    """
    Records an operational event in the 'operational_events' table.
    """
    event_data = {
        "workspace_id": WOKE_WORKSPACE_ID,
        "event_type": event_type,
        "category": category,
        "title": title,
        "description": description,
        "impact_scope": impact_scope,
        "actor": actor,
        "evidence_id": evidence_id,
    }
    if not dry_run:
        try:
            supabase.table("operational_events").insert(event_data).execute()
            print(f"[operational_events] Recorded event: {title}", flush=True)
        except Exception as exc:
            print(f"[operational_events] WARNING: Could not record event '{title}': {exc}", flush=True)
    else:
        print(f"[operational_events] --dry-run: Would record event: {title}", flush=True)