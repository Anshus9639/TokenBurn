"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "framer-motion";
import {
  Bell,
  ChartNoAxesCombined,
  ChevronDown,
  CircleHelp,
  Gauge,
  Layers,
  LogOut,
  Menu,
  Route,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  X,
} from "lucide-react";
import { NAV_ITEMS, PAGE_META, ROLE_LABEL } from "@/lib/constants";
import { cn, initials } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ProviderLogo } from "@/components/brand/provider-logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutAction, switchOrgAction } from "@/lib/actions/auth";

const ICONS: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  gauge: Gauge,
  chart: ChartNoAxesCombined,
  layers: Layers,
  terminal: TerminalSquare,
  sliders: SlidersHorizontal,
  sparkles: Sparkles,
  route: Route,
  shield: ShieldCheck,
  bell: Bell,
  settings: Settings2,
};

export type ShellUser = {
  name: string;
  email: string;
  role: string;
};

export type OrgRef = {
  id: string;
  name: string;
  slug: string;
  plan: string;
};

export type ShellOrg = OrgRef & {
  dataMode: "synthetic" | "live" | "hybrid";
};

const DATA_MODE: Record<ShellOrg["dataMode"], { label: string; hint: string; footer: string; chip: "warn" | "info" | "good" }> = {
  synthetic: {
    label: "Synthetic",
    hint: "Seed traffic is explicitly labeled. Connect a provider to mix live usage.",
    footer: "Seed usage is labeled synthetic on every event.",
    chip: "warn",
  },
  hybrid: {
    label: "Hybrid",
    hint: "Live provider traffic is mixed with labeled seed data.",
    footer: "Live and seed usage are labeled per event.",
    chip: "info",
  },
  live: {
    label: "Live",
    hint: "Usage is reported by your connected provider integrations.",
    footer: "Usage in this organization comes from provider integrations.",
    chip: "good",
  },
};

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="tb-metal" x1="6" y1="4" x2="26" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset="0.45" stopColor="#E4E4E7" />
          <stop offset="1" stopColor="#737373" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="14.25" stroke="#3A3A3A" strokeWidth="1" />
      <circle cx="16" cy="16" r="10.5" stroke="url(#tb-metal)" strokeWidth="1.1" opacity="0.9" />
      <path d="M16 6.2 25.8 16 16 25.8 6.2 16 16 6.2Z" stroke="url(#tb-metal)" strokeWidth="1" opacity="0.55" />
      <path d="M16 11.4 20.6 16 16 20.6 11.4 16 16 11.4Z" fill="url(#tb-metal)" />
    </svg>
  );
}

function SidebarContent({
  org,
  user,
  memberships,
  alertCount,
  onNavigate,
}: {
  org: ShellOrg;
  user: ShellUser;
  memberships: OrgRef[];
  alertCount: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const groups = ["Overview", "Manage", "Optimize", "Control"] as const;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 border-b border-hairline-faint px-5">
        <BrandMark className="size-6 drop-shadow-[0_0_10px_rgba(255,255,255,0.18)]" />
        <div className="leading-none">
          <div className="text-[13px] font-semibold tracking-[0.16em] text-ink">TOKENBURN</div>
          <div className="mt-1 font-mono text-[8px] uppercase tracking-[0.2em] text-ink-faint">Cost intelligence</div>
        </div>
      </div>

      <div className="border-b border-hairline-faint px-3 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-hairline hover:bg-white/[0.03]">
              <div className="flex size-7 items-center justify-center rounded-[6px] border border-hairline-strong bg-gradient-to-b from-[#262626] to-[#161616] font-mono text-[10px] text-[#D4D4D8]">
                {initials(org.name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-ink">{org.name}</div>
                <div className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-ink-faint">
                  {org.plan} plan · {user.role}
                </div>
              </div>
              <ChevronDown className="size-3.5 text-ink-faint" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[218px]">
            <DropdownMenuLabel>Organizations</DropdownMenuLabel>
            {memberships.map((m) => (
              <DropdownMenuItem key={m.slug} asChild>
                <form action={switchOrgAction}>
                  <input type="hidden" name="orgId" value={m.id} />
                  <input type="hidden" name="returnTo" value="/dashboard" />
                  <button type="submit" className="flex w-full items-center gap-2 text-left">
                    <span className="flex size-5 items-center justify-center rounded-[4px] border border-hairline bg-[#1B1B1B] font-mono text-[8px]">
                      {initials(m.name)}
                    </span>
                    <span className="flex-1 truncate">{m.name}</span>
                    {m.id === org.id ? <span className="size-1.5 rounded-full bg-chrome" /> : null}
                  </button>
                </form>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings" onClick={onNavigate}>
                Organization settings
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 scrollbar-none">
        {groups.map((group) => (
          <div key={group} className="mb-5">
            <div className="kicker mb-2 px-2.5">{group}</div>
            <div className="space-y-0.5">
              {NAV_ITEMS.filter((i) => i.group === group).map((item) => {
                const Icon = ICONS[item.icon] ?? Gauge;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-[7px] border px-2.5 py-[7px] text-[12.5px] transition-all duration-150",
                      active
                        ? "border-hairline-strong bg-[#222222] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                        : "border-transparent text-ink-faint hover:bg-white/[0.03] hover:text-ink-muted",
                    )}
                  >
                    {active ? (
                      <span className="absolute left-0 top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-full bg-[#F5F5F5]" />
                    ) : null}
                    <Icon
                      className={cn("size-[15px]", active ? "text-white" : "text-ink-faint group-hover:text-ink-muted")}
                      strokeWidth={1.6}
                    />
                    <span className="flex-1">{item.label}</span>
                    {item.href === "/alerts" && alertCount > 0 ? (
                      <span className="rounded-full border border-accent-amber/35 bg-accent-amber/10 px-1.5 py-px font-mono text-[9px] text-accent-amber">
                        {alertCount}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-hairline-faint p-3">
        <div className="rounded-md border border-hairline bg-[#0D0D0D] px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">Data mode</span>
            <Badge variant={DATA_MODE[org.dataMode].chip} className="px-1.5 py-0 text-[9px]">
              {DATA_MODE[org.dataMode].label}
            </Badge>
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">{DATA_MODE[org.dataMode].hint}</p>
        </div>
      </div>
    </div>
  );
}

export function AppShell({
  children,
  user,
  org,
  memberships,
  alertCount,
  approvalCount,
}: {
  children: React.ReactNode;
  user: ShellUser;
  org: ShellOrg;
  memberships: OrgRef[];
  alertCount: number;
  approvalCount: number;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const meta =
    PAGE_META[pathname] ??
    Object.entries(PAGE_META)
      .filter(([href]) => pathname.startsWith(`${href}/`))
      .sort(([a], [b]) => b.length - a.length)[0]?.[1] ??
    { title: "TokenBurn", description: "" };
  const roleLabel = ROLE_LABEL[user.role as keyof typeof ROLE_LABEL] ?? user.role;
  const reduceMotion = useReducedMotion();

  return (
    <div className="min-h-screen bg-obsidian">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:border focus:border-hairline-strong focus:bg-[#0A0A0A] focus:px-3 focus:py-2 focus:text-[12px] focus:text-ink"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-hairline-faint bg-surface-sidebar lg:block">
        <SidebarContent org={org} user={user} memberships={memberships} alertCount={alertCount} />
      </aside>

      <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/70 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 lg:hidden" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 w-[256px] border-r border-hairline-strong bg-surface-sidebar duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left lg:hidden"
          >
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="absolute right-3 top-4 z-10 text-ink-faint transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-chrome/60"
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
            <SidebarContent
              org={org}
              user={user}
              memberships={memberships}
              alertCount={alertCount}
              onNavigate={() => setMobileOpen(false)}
            />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>

        <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-hairline-faint bg-obsidian/90 px-4 backdrop-blur-md sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <DialogPrimitive.Trigger asChild>
              <button
                className="flex size-8 items-center justify-center rounded-md border border-hairline text-ink-muted lg:hidden"
                aria-label="Open navigation"
              >
                <Menu className="size-4" />
              </button>
            </DialogPrimitive.Trigger>
            <div className="flex min-w-0 items-center gap-2 text-[11px]">
              <span className="hidden font-mono uppercase tracking-[0.12em] text-ink-faint sm:inline">{org.name}</span>
              <span className="hidden text-ink-faint/50 sm:inline">/</span>
              <span className="truncate text-ink-muted">{meta.title}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {approvalCount > 0 ? (
              <Link
                href="/governance?tab=approvals"
                className="hidden items-center gap-1.5 rounded-full border border-hairline-strong bg-white/[0.04] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted sm:flex"
              >
                {approvalCount} approval{approvalCount > 1 ? "s" : ""} pending
              </Link>
            ) : null}
            <Link href="/alerts?tab=inbox" aria-label="Alerts">
              <Button variant="ghost" size="icon-sm" className="relative">
                <Bell className="size-4" strokeWidth={1.6} />
                {alertCount > 0 ? (
                  <span className="absolute right-1 top-1 size-1.5 rounded-full border border-obsidian bg-accent-amber shadow-[0_0_6px_rgba(245,158,11,0.8)]" />
                ) : null}
              </Button>
            </Link>
            <Link href="/explorer" aria-label="API documentation">
              <Button variant="ghost" size="icon-sm">
                <CircleHelp className="size-4" strokeWidth={1.6} />
              </Button>
            </Link>
            <div className="mx-1 h-4 w-px bg-hairline" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full border border-hairline bg-graphite/80 py-0.5 pl-0.5 pr-2.5 transition-colors hover:border-hairline-strong">
                  <span className="flex size-6 items-center justify-center rounded-full border border-hairline-strong bg-gradient-to-b from-[#2A2A2A] to-[#181818] font-mono text-[9px] text-[#D4D4D8]">
                    {initials(user.name)}
                  </span>
                  <span className="hidden text-[11px] text-ink-muted sm:inline">{user.name}</span>
                  <ChevronDown className="size-3 text-ink-faint" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[230px]">
                <div className="px-2 py-2">
                  <div className="text-[12px] text-ink">{user.name}</div>
                  <div className="truncate text-[11px] text-ink-faint">{user.email}</div>
                  <div className="mt-1.5">
                    <Badge variant="outline">{roleLabel}</Badge>
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings">Organization settings</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings?tab=members">Members & roles</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <form action={logoutAction} className="w-full">
                    <button type="submit" className="flex w-full items-center gap-2 text-left">
                      <LogOut className="size-3.5" />
                      Sign out
                    </button>
                  </form>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1440px] px-4 py-7 sm:px-6 lg:px-8 outline-none">
          <motion.div
            key={pathname}
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.div>
        </main>

        <footer className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-3 border-t border-hairline-faint px-4 py-5 text-[10px] text-ink-faint sm:px-6 lg:px-8">
          <span className="font-mono uppercase tracking-[0.12em]">TokenBurn · {org.slug}</span>
          <span className="flex flex-wrap items-center gap-3">
            <span>{DATA_MODE[org.dataMode].footer}</span>
            <span className="hidden h-3 w-px bg-hairline sm:block" aria-hidden />
            <span className="flex items-center gap-2.5">
              <span className="sr-only">Supported provider adapters:</span>
              {(["openai", "anthropic", "gemini", "groq", "mistral"] as const).map((id) => (
                <ProviderLogo key={id} provider={id} size={13} />
              ))}
            </span>
          </span>
        </footer>
        </div>
      </DialogPrimitive.Root>
    </div>
  );
}
