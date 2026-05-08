import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import type { ApiQueryFilters } from "@/types/growth";

export type WorkspaceRouteContext = {
  params: Promise<{ workspace_id: string }>;
};

type SupabaseLikeError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

type SupabaseLikeResult = {
  data: unknown;
  error: SupabaseLikeError | null;
};

export type ReadResult<T> = {
  rows: T[];
  warnings: string[];
};

export class ApiDataError extends Error {
  status: number;
  table?: string;
  code?: string;

  constructor(message: string, options: { status?: number; table?: string; code?: string } = {}) {
    super(message);
    this.name = "ApiDataError";
    this.status = options.status ?? 502;
    this.table = options.table;
    this.code = options.code;
  }
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const SIMPLE_VALUE_RE = /^[a-zA-Z0-9_.:-]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseApiFilters(searchParams: URLSearchParams): ApiQueryFilters {
  const rawLimit = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  return {
    date_start: clean(searchParams.get("date_start")),
    date_end: clean(searchParams.get("date_end")),
    environment: clean(searchParams.get("environment")),
    source: clean(searchParams.get("source")),
    medium: clean(searchParams.get("medium")),
    campaign: clean(searchParams.get("campaign")),
    status: clean(searchParams.get("status")),
    severity: clean(searchParams.get("severity")),
    check_name: clean(searchParams.get("check_name")),
    limit,
  };
}

export function validateWorkspaceId(workspaceId: string): string {
  const value = workspaceId.trim();
  if (!value) {
    throw new ApiDataError("workspace_id is required", { status: 400 });
  }
  if (!UUID_RE.test(value)) {
    throw new ApiDataError("workspace_id must be a valid UUID", { status: 400, code: "invalid_workspace_id" });
  }
  return value;
}

export async function readRows<T>(
  request: PromiseLike<SupabaseLikeResult>,
  table: string,
): Promise<ReadResult<T>> {
  const result = await request;
  if (result.error) {
    if (isMissingTableError(result.error)) {
      return {
        rows: [],
        warnings: [`Table ${table} is not available yet.`],
      };
    }

    throw new ApiDataError(result.error.message ?? `Could not read ${table}`, {
      table,
      code: result.error.code,
    });
  }

  return {
    rows: Array.isArray(result.data) ? (result.data as T[]) : [],
    warnings: [],
  };
}

export function makeEnvelope<TData>(input: {
  workspaceId: string;
  filters: ApiQueryFilters;
  sourceTables: string[];
  warnings?: string[];
  data: TData;
}) {
  return {
    ok: true as const,
    workspace_id: input.workspaceId,
    filters: input.filters,
    source_tables: input.sourceTables,
    generated_at: new Date().toISOString(),
    warnings: [...new Set(input.warnings ?? [])],
    data: input.data,
  };
}

export async function handleApiRoute<T>(
  workspaceId: string,
  searchParams: URLSearchParams,
  handler: (workspaceId: string, filters: ApiQueryFilters) => Promise<T>,
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      throw new ApiDataError("Unauthorized", { status: 401, code: "unauthorized" });
    }

    const validWorkspaceId = validateWorkspaceId(workspaceId);
    const filters = parseApiFilters(searchParams);
    return NextResponse.json(await handler(validWorkspaceId, filters));
  } catch (error) {
    const apiError = error instanceof ApiDataError
      ? error
      : new ApiDataError(error instanceof Error ? error.message : "Unexpected API error");

    return NextResponse.json(
      {
        ok: false,
        error: {
          message: apiError.message,
          code: apiError.code ?? null,
          table: apiError.table ?? null,
        },
      },
      { status: apiError.status },
    );
  }
}

export function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return toNumber(value);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function looseJsonMatch(row: Record<string, unknown>, filters: ApiQueryFilters): boolean {
  const searchable = JSON.stringify(row).toLowerCase();
  if (filters.environment && !searchable.includes(filters.environment.toLowerCase())) return false;
  if (filters.medium && !searchable.includes(filters.medium.toLowerCase())) return false;
  if (filters.campaign && !searchable.includes(filters.campaign.toLowerCase())) return false;
  return true;
}

export function isSimpleFilterValue(value: string | undefined): value is string {
  return Boolean(value && SIMPLE_VALUE_RE.test(value));
}

function clean(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isMissingTableError(error: SupabaseLikeError): boolean {
  const code = error.code ?? "";
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "PGRST204" ||
    (text.includes("relation") && text.includes("does not exist")) ||
    text.includes("could not find the table")
  );
}
