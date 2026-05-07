from datetime import datetime, timezone
from supabase import Client


def start_sync_run(
    supabase: Client,
    workspace_id: str,
    source_platform: str,
    data_source: str,
    is_mock: bool,
    date_range_start,
    date_range_end,
) -> str:
    result = supabase.table("sync_runs").insert({
        "workspace_id":     workspace_id,
        "source_platform":  source_platform,
        "data_source":      data_source,
        "status":           "running",
        "started_at":       datetime.now(timezone.utc).isoformat(),
        "is_mock":          is_mock,
        "date_range_start": str(date_range_start),
        "date_range_end":   str(date_range_end),
    }).execute()
    return result.data[0]["id"]


def finish_sync_run_success(supabase: Client, run_id: str, rows_loaded: int) -> None:
    supabase.table("sync_runs").update({
        "status":      "success",
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "rows_loaded": rows_loaded,
    }).eq("id", run_id).execute()


def finish_sync_run_error(supabase: Client, run_id: str, error_message: str) -> None:
    supabase.table("sync_runs").update({
        "status":        "error",
        "finished_at":   datetime.now(timezone.utc).isoformat(),
        "error_message": error_message,
    }).eq("id", run_id).execute()
