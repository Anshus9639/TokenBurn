import { providerBrand, providerForModel } from "@/lib/brand/providers";

/** Ordered palette for categorical series that are not provider-specific. */
export const CHART_PALETTE = [
  "#3B82F6",
  "#8B5CF6",
  "#06B6D4",
  "#10B981",
  "#F59E0B",
  "#F43F5E",
  "#A855F7",
  "#14B8A6",
  "#F97316",
  "#EC4899",
  "#38BDF8",
  "#6366F1",
  "#84CC16",
] as const;

export const SEMANTIC = {
  cost: "#3B82F6",
  input: "#3B82F6",
  output: "#8B5CF6",
  cached: "#06B6D4",
  reasoning: "#F59E0B",
  requests: "#06B6D4",
  latency: "#14B8A6",
  p95: "#F59E0B",
  errors: "#F43F5E",
  savings: "#10B981",
  projected: "#8B5CF6",
  budget: "#F59E0B",
  grid: "#2A2A2A",
  axis: "#737373",
} as const;

export function paletteColor(index: number): string {
  return CHART_PALETTE[index % CHART_PALETTE.length]!;
}

/** Names like "openai", "OpenAI", "Google Gemini", "gpt-4.1" all resolve to a brand color. */
export function seriesColorForProvider(name: string | null | undefined): string {
  return providerBrand(name).color;
}

export function seriesColorForModel(model: string, provider?: string | null): string {
  return providerForModel(model, provider).color;
}

export function buildSeriesColors(keys: string[]): Record<string, string> {
  const colors: Record<string, string> = {};
  keys.forEach((key, index) => {
    colors[key] = paletteColor(index);
  });
  return colors;
}

/** Stable accent for projects/features that have no brand color of their own. */
export function accentForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return paletteColor(Math.abs(hash));
}

/** Sequential blend used for single-hue charts (e.g. feature ranking). */
export function rankTint(base: string, index: number): string {
  const opacities = [1, 0.82, 0.68, 0.56, 0.46, 0.38, 0.32, 0.27];
  const alpha = opacities[Math.min(index, opacities.length - 1)] ?? 0.27;
  return `color-mix(in srgb, ${base} ${Math.round(alpha * 100)}%, #222222)`;
}
