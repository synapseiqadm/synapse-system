/**
 * Static mirror of backend/governance/tenants/woke_measurement_config.yml
 * — conversion_registry section only.
 *
 * Provides event_name → funnel_stage mappings for use in classifyFunnelStep().
 * Events not listed here fall through to the regex-based heuristic fallback.
 *
 * Sync note: if woke_measurement_config.yml is updated, this file must be
 * updated manually until a codegen step is introduced in v1.5+.
 *
 * FunnelStep "activation" (used in YAML for intermediate events) is mapped
 * to "engagement" — the closest equivalent in the frontend step taxonomy.
 */

export type FunnelStep =
  | "acquisition"
  | "landing"
  | "engagement"
  | "intent"
  | "conversion";

/**
 * Map from event_name (lowercased) → FunnelStep.
 * Derived from conversion_registry in woke_measurement_config.yml.
 *
 * Sections covered:
 *   canonical_events   → funnel_stage: "conversion"
 *   intermediate_events → funnel_stage: "activation" → mapped to "engagement"
 *   intent_events      → funnel_stage: "intent"
 */
export const EVENT_FUNNEL_MAP: Record<string, FunnelStep> = {
  // canonical_events — funnel_stage: conversion
  "mentor_signup_success":              "conversion", // Mentor_signup_success
  "user_signup_mentor_with_auto_signin": "conversion", // USER_SIGNUP_MENTOR_WITH_AUTO_SIGNIN

  // intermediate_events — funnel_stage: activation → engagement
  "app - criar conta": "engagement", // App - Criar Conta

  // intent_events — funnel_stage: intent
  "form_start": "intent",
};

/**
 * Returns the configured funnel step for a given event name, or undefined
 * if the event is not present in the measurement config.
 * Lookup is case-insensitive.
 */
export function getConfiguredFunnelStep(eventName: string): FunnelStep | undefined {
  return EVENT_FUNNEL_MAP[eventName.toLowerCase()];
}
