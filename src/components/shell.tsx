"use client";
import { Activity, ClipboardCheck, Inbox, LayoutDashboard, ListChecks, Menu, Moon, Plus, ShieldCheck, Sun, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ResearchProvider, useResearch } from "@/components/research";
import { useApi } from "@/lib/client";
import { cn } from "@/lib/cn";

type Item = { href: string; label: string; icon: typeof Inbox; badge?: "review" };
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Pipeline",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/review", label: "Review queue", icon: Inbox, badge: "review" },
      { href: "/pipeline", label: "All companies", icon: ListChecks },
    ],
  },
  {
    title: "Governance",
    items: [
      { href: "/readiness", label: "Build readiness", icon: ClipboardCheck },
      { href: "/activity", label: "Activity log", icon: Activity },
    ],
  },
];

const TITLES: [RegExp, string][] = [
  [/^\/$/, "Overview"],
  [/^\/review/, "Review queue"],
  [/^\/pipeline/, "All companies"],
  [/^\/companies\//, "Company"],
  [/^\/prospects/, "Add companies"],
  [/^\/readiness/, "Build readiness"],
  [/^\/activity/, "Activity log"],
];

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <ResearchProvider onFinished={() => window.dispatchEvent(new Event("pipeline:changed"))}>
      <Frame>{children}</Frame>
    </ResearchProvider>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const openResearch = useResearch();
  const { data } = useApi<{ byStatus: Record<string, number> }>("/api/stats", 20000);
  const reviewCount = (data?.byStatus.DRAFT_READY ?? 0) + (data?.byStatus.MANUAL_REVIEW ?? 0);
  const title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? "";

  function toggleTheme() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* storage unavailable */
    }
  }

  const nav = (
    <nav className="space-y-6" aria-label="Main">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted/80">{g.title}</p>
          <div className="space-y-0.5">
            {g.items.map(({ href, label, icon: Icon, badge }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href) || (href === "/pipeline" && pathname.startsWith("/companies"));
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active ? "bg-primary/10 text-primary" : "text-muted hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="flex-1">{label}</span>
                  {badge === "review" && reviewCount > 0 && (
                    <span className="rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold leading-none text-primary-fg">{reviewCount}</span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const footer = (
    <div className="space-y-2">
      <div className="rounded-xl border border-line bg-surface-2 p-3 text-xs">
        <p className="flex items-center gap-1.5 font-medium text-ink">
          <span className="h-2 w-2 rounded-full bg-teal" aria-hidden /> Test-inbox mode
        </p>
        <p className="mt-1 leading-relaxed text-muted">Drafts go to your own inbox only — prospects are never contacted.</p>
      </div>
      <button onClick={toggleTheme} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-ink">
        <Sun className="hidden h-4 w-4 dark:block" />
        <Moon className="h-4 w-4 dark:hidden" />
        <span className="hidden dark:inline">Light mode</span>
        <span className="dark:hidden">Dark mode</span>
      </button>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="hidden border-r border-line bg-surface lg:block">
        <div className="sticky top-0 flex h-screen flex-col gap-6 p-4">
          <Brand />
          <div className="flex-1 overflow-y-auto">{nav}</div>
          {footer}
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col gap-6 bg-surface p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <Brand />
              <button aria-label="Close menu" onClick={() => setOpen(false)} className="rounded-lg p-2 text-muted hover:bg-surface-2">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1">{nav}</div>
            {footer}
          </div>
        </div>
      )}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur sm:px-6">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="-ml-1 rounded-lg p-2 text-muted hover:bg-surface-2 lg:hidden">
            <Menu className="h-5 w-5" />
          </button>
          <p className="flex-1 truncate text-sm font-semibold text-ink">{title}</p>
          <button
            onClick={openResearch}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-fg shadow-sm hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Add companies
            <kbd className="hidden rounded border border-white/30 px-1.5 text-[10px] font-medium sm:inline">N</kbd>
          </button>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-1">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-teal text-white shadow-sm">
        <ShieldCheck className="h-5 w-5" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-ink">Sprinto</span>
        <span className="block text-xs text-muted">Outreach copilot</span>
      </span>
    </Link>
  );
}
