import os
import sys
from datetime import date, timedelta
from dotenv import load_dotenv

# Snapshot the process environment BEFORE load_dotenv() runs.
# python-dotenv may treat empty-string vars as falsy and silently replace them
# with .env values. The snapshot lets required_env() see what the shell actually set.
#
# Windows note: Win32 SetEnvironmentVariable("VAR", "") removes the variable rather
# than storing an empty string, so $env:VAR = "" in PowerShell makes the var absent
# from this snapshot. On Linux/macOS (CI) empty strings are preserved as expected.
_PROCESS_ENV = {k: v for k, v in os.environ.items()}

load_dotenv(override=False)


def required_env(name: str) -> str:
    """Return the value of a required env var, or sys.exit(1) if missing or empty.

    Process environment has unconditional priority. If the shell set the variable
    to an empty string, that is treated as an error — no silent fallback to .env.
    """
    if name in _PROCESS_ENV:
        val = _PROCESS_ENV[name].strip()
        if not val:
            print(
                f"ERROR: {name} is set but empty in the process environment. "
                "Unset it or provide a non-empty value.",
                flush=True,
            )
            sys.exit(1)
        return val

    val = (os.environ.get(name) or "").strip()
    if not val:
        print(
            f"ERROR: Required env var {name!r} is not set. "
            "Add it to .env or the process environment.",
            flush=True,
        )
        sys.exit(1)
    return val


APP_ENV          = os.getenv("APP_ENV", "production")
ALLOW_MOCK_DATA  = os.getenv("ALLOW_MOCK_DATA", "false").lower() == "true"

WOKE_WORKSPACE_ID      = os.getenv("WOKE_WORKSPACE_ID",      "a082fe86-a65f-4c9b-9442-fe775f47e3fc")
GCP_PROJECT_ID         = os.getenv("GCP_PROJECT_ID",         "synapsesystem")
BQ_LOCATION            = os.getenv("BQ_LOCATION",            "southamerica-east1")
GOOGLE_ADS_DATASET     = os.getenv("GOOGLE_ADS_DATASET",     "raw_google_ads_woke")
GOOGLE_ADS_CUSTOMER_ID = os.getenv("GOOGLE_ADS_CUSTOMER_ID", "6627867790")
GA4_DATASET            = os.getenv("GA4_DATASET", "")

SUPABASE_URL         = required_env("SUPABASE_URL")
SUPABASE_SERVICE_KEY = required_env("SUPABASE_SERVICE_KEY")

# Local dev only — CI injects credentials via secret before this runs
os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", r"D:\dev\synapse\credentials.json")

DATE_RANGE_DAYS  = int(os.getenv("DATE_RANGE_DAYS", "30"))
DATE_RANGE_END   = date.today()
DATE_RANGE_START = DATE_RANGE_END - timedelta(days=DATE_RANGE_DAYS - 1)
