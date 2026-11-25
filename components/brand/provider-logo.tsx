import * as React from "react";
import { cn } from "@/lib/utils";
import { providerBrand, providerForModel, type BrandProviderId } from "@/lib/brand/providers";

const OPENAI_PATH =
  "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z";

const ANTHROPIC_PATH =
  "M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z";

const GEMINI_PATH =
  "M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81";

const MISTRAL_PATH =
  "M17.143 3.429v3.428h-3.429v3.429h-3.428V6.857H6.857V3.43H3.43v13.714H0v3.428h10.286v-3.428H6.857v-3.429h3.429v3.429h3.429v-3.429h3.428v3.429h-3.428v3.428H24v-3.428h-3.43V3.429z";

const GROQ_TILE = "M.54.39h32v32h-32z";
const GROQ_BOLT = "m18.445 4.406-9.468 13.74 7.341.665-1.69 9.578 9.469-13.74-7.342-.664 1.69-9.579Z";

const GEMINI_GRADIENT_ID = "tb-gemini-brand-gradient";

function svgProps(size: number, label: string, decorative?: boolean) {
  return {
    width: size,
    height: size,
    role: decorative ? undefined : "img",
    "aria-label": decorative ? undefined : label,
    "aria-hidden": decorative || undefined,
    focusable: false as const,
  };
}

export function ProviderLogo({
  provider,
  size = 18,
  className,
  decorative = false,
}: {
  provider: string | null | undefined;
  size?: number;
  className?: string;
  decorative?: boolean;
}) {
  const brand = providerBrand(provider);
  const props = svgProps(size, brand.label, decorative);

  switch (brand.id) {
    case "openai":
      return (
        <svg {...props} viewBox="0 0 24 24" className={cn("shrink-0", className)}>
          <path d={OPENAI_PATH} fill={brand.color} />
        </svg>
      );
    case "anthropic":
      return (
        <svg {...props} viewBox="0 0 24 24" className={cn("shrink-0", className)}>
          <path d={ANTHROPIC_PATH} fill={brand.color} />
        </svg>
      );
    case "gemini":
      return (
        <svg {...props} viewBox="0 0 24 24" className={cn("shrink-0", className)}>
          <defs>
            <linearGradient id={GEMINI_GRADIENT_ID} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
              <stop stopColor="#4285F4" />
              <stop offset="0.52" stopColor="#9B72CB" />
              <stop offset="1" stopColor="#D96570" />
            </linearGradient>
          </defs>
          <path d={GEMINI_PATH} fill={`url(#${GEMINI_GRADIENT_ID})`} />
        </svg>
      );
    case "groq":
      return (
        <svg {...props} viewBox="0 0 33 33" className={cn("shrink-0", className)}>
          <path d={GROQ_TILE} fill={brand.color} />
          <path d={GROQ_BOLT} fill="#FFFFFF" />
        </svg>
      );
    case "mistral":
      return (
        <svg {...props} viewBox="0 0 24 24" className={cn("shrink-0", className)}>
          <path d={MISTRAL_PATH} fill={brand.color} />
        </svg>
      );
    default:
      return (
        <svg {...props} viewBox="0 0 24 24" className={cn("shrink-0", className)}>
          <circle cx="12" cy="12" r="9.5" fill="none" stroke={brand.color} strokeWidth="1.4" />
          <circle cx="12" cy="12" r="3.2" fill={brand.color} />
        </svg>
      );
  }
}

export type ProviderConnectionState = "connected" | "not_configured" | "verification_failed" | "connection_error";

const CONNECTION: Record<ProviderConnectionState, { label: string; dot: string }> = {
  connected: { label: "Connected — verified", dot: "bg-accent-emerald shadow-[0_0_8px_rgba(16,185,129,0.7)]" },
  not_configured: { label: "Not configured", dot: "bg-neutral-500" },
  verification_failed: { label: "Verification failed", dot: "bg-accent-rose" },
  connection_error: { label: "Connection error", dot: "bg-accent-amber" },
};

export function ProviderBadge({
  provider,
  label,
  status,
  className,
  size = 14,
}: {
  provider: string | null | undefined;
  label?: string;
  status?: ProviderConnectionState;
  className?: string;
  size?: number;
}) {
  const brand = providerBrand(provider);
  const connection = status ? CONNECTION[status] : null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-hairline bg-white/[0.03] py-0.5 pl-1.5 pr-2 text-[11px] text-ink-muted",
        className,
      )}
      title={connection ? `${brand.label} · ${connection.label}` : brand.label}
    >
      <ProviderLogo provider={brand.id} size={size} decorative />
      <span className="truncate">{label ?? brand.short}</span>
      {connection ? (
        <span className={cn("size-1.5 rounded-full", connection.dot)} aria-hidden />
      ) : null}
    </span>
  );
}

export function ModelBadge({
  model,
  provider,
  className,
  mono = true,
}: {
  model: string;
  provider?: string | null;
  className?: string;
  mono?: boolean;
}) {
  const brand = providerForModel(model, provider);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)} title={`${brand.label} · ${model}`}>
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: brand.color }} aria-hidden />
      <span className={cn("truncate text-ink-muted", mono && "font-mono text-[11px]")}>{model}</span>
    </span>
  );
}

export function ProviderMarkRow({
  providers,
  size = 14,
  className,
}: {
  providers: BrandProviderId[];
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {providers.map((id) => (
        <ProviderLogo key={id} provider={id} size={size} />
      ))}
    </span>
  );
}
