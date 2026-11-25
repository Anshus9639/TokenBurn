import type { UsageFilters } from "@/lib/analytics";
import { addDays, dayKey, startOfDayUTC } from "@/lib/utils";

export type SearchParams = Record<string, string | string[] | undefined>;

export const RANGES = ["7d", "30d", "90d", "custom"] as const;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export function parseUsageParams(sp: SearchParams): {
  range: (typeof RANGES)[number];
  fromDate: string;
  toDate: string;
  filters: UsageFilters;
} {
  const requested = first(sp.range);
  const range = (RANGES as readonly string[]).includes(requested ?? "") ? (requested as (typeof RANGES)[number]) : "30d";
  const now = new Date();
  let from: Date;
  let to: Date;

  if (range === "custom") {
    const fromRaw = first(sp.from);
    const toRaw = first(sp.to);
    const parsedFrom = fromRaw ? new Date(`${fromRaw}T00:00:00Z`) : null;
    const parsedTo = toRaw ? new Date(`${toRaw}T00:00:00Z`) : null;
    from =
      parsedFrom && !Number.isNaN(parsedFrom.getTime())
        ? parsedFrom
        : addDays(startOfDayUTC(now), -29);
    const end = parsedTo && !Number.isNaN(parsedTo.getTime()) ? addDays(parsedTo, 1) : addDays(startOfDayUTC(now), 1);
    to = end > from ? end : addDays(from, 1);
  } else {
    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    from = addDays(startOfDayUTC(now), -(days - 1));
    to = addDays(startOfDayUTC(now), 1);
  }

  return {
    range,
    fromDate: dayKey(from),
    toDate: dayKey(addDays(to, -1)),
    filters: {
      from,
      to,
      projectId: first(sp.project) || undefined,
      environment: first(sp.environment) || undefined,
      feature: first(sp.feature) || undefined,
      provider: first(sp.provider) || undefined,
      model: first(sp.model) || undefined,
      onlyErrors: first(sp.errors) === "1",
      query: first(sp.q)?.trim() || undefined,
      page: Math.max(Number(first(sp.page) ?? 1) || 1, 1),
      pageSize: Math.min(Math.max(Number(first(sp.pageSize) ?? 25) || 25, 5), 100),
    },
  };
}

export function buildUsageQuery(
  sp: SearchParams,
  overrides: Record<string, string | number | null | undefined> = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    const single = first(value);
    if (single) params.set(key, single);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === null || value === "") params.delete(key);
    else params.set(key, String(value));
  }
  return params.toString();
}

export function objectFromSearchParams(params: URLSearchParams): SearchParams {
  const out: SearchParams = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    out[key] = values.length > 1 ? values : values[0];
  }
  return out;
}
