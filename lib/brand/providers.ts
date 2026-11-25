export type BrandProviderId = "openai" | "anthropic" | "gemini" | "groq" | "mistral" | "custom";

export type ProviderBrand = {
  id: BrandProviderId;
  label: string;
  short: string;
  /** Official brand color used for logos, chart series and legends. Never themed. */
  color: string;
  /** Low-alpha tint derived from the brand color for surfaces. */
  tint: string;
  /** Provider-agnostic fallback for unknown providers. */
  chartOrder: number;
};

export const PROVIDER_BRAND: Record<BrandProviderId, ProviderBrand> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    short: "OpenAI",
    color: "#F2F5F7",
    tint: "rgba(242,245,247,0.10)",
    chartOrder: 0,
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    short: "Anthropic",
    color: "#D97757",
    tint: "rgba(217,119,87,0.12)",
    chartOrder: 1,
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    short: "Gemini",
    color: "#5C8DFF",
    tint: "rgba(92,141,255,0.12)",
    chartOrder: 2,
  },
  groq: {
    id: "groq",
    label: "Groq",
    short: "Groq",
    color: "#F43E01",
    tint: "rgba(244,62,1,0.12)",
    chartOrder: 3,
  },
  mistral: {
    id: "mistral",
    label: "Mistral AI",
    short: "Mistral",
    color: "#FF8205",
    tint: "rgba(255,130,5,0.12)",
    chartOrder: 4,
  },
  custom: {
    id: "custom",
    label: "Custom provider",
    short: "Custom",
    color: "#94A3B8",
    tint: "rgba(148,163,184,0.12)",
    chartOrder: 9,
  },
};

const ALIASES: Record<string, BrandProviderId> = {
  openai: "openai",
  anthropic: "anthropic",
  claude: "anthropic",
  gemini: "gemini",
  google: "gemini",
  "google-gemini": "gemini",
  groq: "groq",
  mistral: "mistral",
  "mistral-ai": "mistral",
  mistralai: "mistral",
};

export function normalizeProviderId(value: string | null | undefined): BrandProviderId {
  if (!value) return "custom";
  return ALIASES[value.toLowerCase().trim()] ?? "custom";
}

export function providerBrand(value: string | null | undefined): ProviderBrand {
  return PROVIDER_BRAND[normalizeProviderId(value)];
}

/** Resolves the provider for a catalog model key like `openai/gpt-4.1` or a bare model id. */
export function providerForModel(
  model: string | null | undefined,
  explicitProvider?: string | null,
): ProviderBrand {
  if (explicitProvider) {
    const direct = normalizeProviderId(explicitProvider);
    if (direct !== "custom") return PROVIDER_BRAND[direct];
  }
  if (!model) return PROVIDER_BRAND.custom;
  const prefix = model.includes("/") ? model.slice(0, model.indexOf("/")) : "";
  if (prefix) {
    const fromPrefix = normalizeProviderId(prefix);
    if (fromPrefix !== "custom") return PROVIDER_BRAND[fromPrefix];
  }
  const bare = model.toLowerCase();
  if (bare.startsWith("gpt") || bare.startsWith("o1") || bare.startsWith("o3") || bare.startsWith("o4")) {
    return PROVIDER_BRAND.openai;
  }
  if (bare.startsWith("claude")) return PROVIDER_BRAND.anthropic;
  if (bare.startsWith("gemini")) return PROVIDER_BRAND.gemini;
  if (bare.startsWith("mistral") || bare.startsWith("mixtral") || bare.startsWith("codestral")) {
    return PROVIDER_BRAND.mistral;
  }
  if (bare.startsWith("llama") || bare.startsWith("qwen") || bare.startsWith("whisper-large")) {
    // Llama-family models are only routed through Groq in this catalog.
    return PROVIDER_BRAND.groq;
  }
  return PROVIDER_BRAND.custom;
}
