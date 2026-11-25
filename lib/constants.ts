export const APP_NAME = "TokenBurn";
export const APP_TAGLINE = "AI cost intelligence";

export type NavItem = {
  href: string;
  label: string;
  short: string;
  icon: string;
  group: "Overview" | "Manage" | "Optimize" | "Control";
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Command Center", short: "Command", icon: "gauge", group: "Overview" },
  { href: "/analytics", label: "Usage Analytics", short: "Analytics", icon: "chart", group: "Overview" },
  { href: "/projects", label: "Projects & Features", short: "Projects", icon: "layers", group: "Manage" },
  { href: "/explorer", label: "API Explorer", short: "API", icon: "terminal", group: "Manage" },
  { href: "/studio", label: "Optimization Studio", short: "Studio", icon: "sliders", group: "Optimize" },
  { href: "/coach", label: "AI Usage Coach", short: "Coach", icon: "sparkles", group: "Optimize" },
  { href: "/router", label: "Model Router", short: "Router", icon: "route", group: "Optimize" },
  { href: "/governance", label: "Governance Center", short: "Governance", icon: "shield", group: "Control" },
  { href: "/alerts", label: "Alerts & Reports", short: "Alerts", icon: "bell", group: "Control" },
  { href: "/settings", label: "Settings & Integrations", short: "Settings", icon: "settings", group: "Control" },
];

export const PROVIDERS = ["openai", "anthropic", "gemini", "groq", "mistral"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  groq: "Groq",
  mistral: "Mistral AI",
  custom: "Custom",
};

export const ENVIRONMENTS = ["production", "staging", "development"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const ROLES = ["owner", "admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

export const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

export const CURRENCY = "USD";

export const PAGE_META: Record<string, { title: string; description: string }> = {
  "/dashboard": {
    title: "Command Center",
    description: "Spend, budgets, anomalies and ingestion health at a glance.",
  },
  "/analytics": {
    title: "Usage Analytics",
    description: "Every request normalized, attributed and priced.",
  },
  "/projects": {
    title: "Projects & Features",
    description: "Environments, keys and feature-level cost attribution.",
  },
  "/explorer": {
    title: "API Explorer",
    description: "Ingest events, query usage and inspect the public surface.",
  },
  "/studio": {
    title: "Optimization Studio",
    description: "Simulate caching, routing and model changes before you ship them.",
  },
  "/coach": {
    title: "AI Usage Coach",
    description: "Evidence-backed recommendations from your own usage records.",
  },
  "/router": {
    title: "Model Router",
    description: "Policies, fallbacks and approval-gated production changes.",
  },
  "/governance": {
    title: "Governance Center",
    description: "Budgets, model restrictions, hard limits and audit trail.",
  },
  "/alerts": {
    title: "Alerts & Reports",
    description: "Thresholds, the alert inbox and saved cost report snapshots.",
  },
  "/settings": {
    title: "Settings & Integrations",
    description: "Organization, members, providers and pricing catalog.",
  },
};
