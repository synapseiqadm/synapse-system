"""
Semantic Registry Loader — SynapseIQ v1.3.1

Read-only access to check metadata defined in backend/governance/semantic_registry.yml.
Safe to import anywhere in the pipeline: no imports from other connectors,
no Supabase client, no environment variables required.

Usage:
    from semantic_registry import load_semantic_registry, get_check_metadata

    registry = load_semantic_registry()
    meta = get_check_metadata("utm_campaign_empty_in_paid_urls", registry)
    if meta:
        print(meta["label"], meta["severity_default"])
"""

import os
from typing import Optional

_HERE = os.path.dirname(os.path.abspath(__file__))

_DEFAULT_REGISTRY_PATH = os.path.normpath(
    os.path.join(_HERE, "..", "governance", "semantic_registry.yml")
)

_cached_registry: Optional[dict] = None


def load_semantic_registry(path: Optional[str] = None) -> dict:
    """
    Load the checks mapping from semantic_registry.yml.

    Returns a dict keyed by check_name, each value being the check's metadata
    dict. Returns {} on any error so callers can always call .get() safely.

    The result is cached after the first successful load when using the default
    path. Passing an explicit path bypasses the cache (useful for tests).
    """
    global _cached_registry

    target = path if path is not None else _DEFAULT_REGISTRY_PATH

    if path is None and _cached_registry is not None:
        return _cached_registry

    try:
        import yaml
    except ImportError:
        print(
            "[semantic_registry] PyYAML not installed — returning empty registry "
            "(pip install PyYAML)",
            flush=True,
        )
        return {}

    if not os.path.exists(target):
        print(
            f"[semantic_registry] file not found: {target!r} — returning empty registry",
            flush=True,
        )
        return {}

    try:
        with open(target, encoding="utf-8") as fh:
            raw = yaml.safe_load(fh)
    except Exception as exc:
        print(
            f"[semantic_registry] read error: {exc} — returning empty registry",
            flush=True,
        )
        return {}

    if not isinstance(raw, dict):
        print(
            "[semantic_registry] registry root is not a YAML mapping — returning empty registry",
            flush=True,
        )
        return {}

    checks = raw.get("checks", {})
    if not isinstance(checks, dict):
        print(
            "[semantic_registry] registry.checks is not a mapping — returning empty registry",
            flush=True,
        )
        return {}

    if path is None:
        _cached_registry = checks

    return checks


def get_check_metadata(
    check_name: str,
    registry: Optional[dict] = None,
) -> Optional[dict]:
    """
    Return the metadata dict for a given check_name, or None if not registered.

    If registry is None, loads from the default path (cached after first call).
    Pass a pre-loaded registry dict to avoid repeated file I/O in tight loops.

    Example:
        meta = get_check_metadata("paid_sessions_without_funnel_progress")
        label = (meta or {}).get("label", check_name)
    """
    r = registry if registry is not None else load_semantic_registry()
    return r.get(check_name)
