"use client";
import { Activity, ClipboardCheck, LayoutDashboard, ListChecks, Menu, Moon, PlusCircle, ShieldCheck, Sun, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/prospects", label: "Prospect Input", icon: PlusCircle },
  { href: "/pipeline", label: "Pipeline", icon: ListChecks },
  { href: "/readiness", label: "Build Readiness", icon: ClipboardCheck },
  { href: "/activity", label: "Activity & Logs", icon: Activity },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

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
    <nav className="flex flex-col gap-1" aria-label="Main">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href) || (href === "/pipeline" && pathname.startsWith("/companies"));
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors", active ? "bg-primary text-primary-fg" : "text-muted hover:bg-surface-2 hover:text-ink")}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="hidden border-r border-line bg-surface lg:block">
        <div className="sticky top-0 flex h-screen flex-col p-4">
          <Brand />
          <div className="mt-6 flex-1">{nav}</div>
          <SafetyNote />
          <button onClick={toggleTheme} className="mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-ink">
            <Sun className="hidden h-4 w-4 dark:block" /><Moon className="h-4 w-4 dark:hidden" /> <span className="hidden dark:inline">Light mode</span><span className="dark:hidden">Dark mode</span>
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
          <Brand />
          <div className="flex items-center gap-1">
            <button onClick={toggleTheme} aria-label="Toggle dark mode" className="rounded-lg p-2 text-muted hover:bg-surface-2">
              <Sun className="hidden h-5 w-5 dark:block" /><Moon className="h-5 w-5 dark:hidden" />
            </button>
            <button onClick={() => setOpen((v) => !v)} aria-label="Toggle menu" aria-expanded={open} className="rounded-lg p-2 text-muted hover:bg-surface-2">
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </header>
        {open && <div className="border-b border-line bg-surface p-3 lg:hidden">{nav}</div>}
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-fg">
        <ShieldCheck className="h-5 w-5" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-ink">Sprinto Outreach</span>
        <span className="block text-xs text-muted">Educational prototype</span>
      </span>
    </Link>
  );
}

function SafetyNote() {
  return (
    <div className="tone-info rounded-xl p-3 text-xs leading-relaxed">
      <strong>Test-only sending.</strong> Emails go only to the configured test inbox — never to prospects.
    </div>
  );
}
