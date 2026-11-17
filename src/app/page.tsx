"use client";
import { ArrowRight, Inbox, Plus, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { useResearch } from "@/components/research";
import { Card, CardBody, CardHeader, EmptyState, ErrorNote, Skeleton } from "@/components/ui";
import { fmtDuration, useApi } from "@/lib/client";
import { cn } from "@/lib/cn";
import { greeting, timeAgo } from "@/lib/time";
import type { EventRow } from "@/lib/types";
import type { PipelineListItem } from "@/services/database";

interface Stats {
  total: number;
  qualified: number;
  contactsVerified: number;
  draftsReady: number;
  sent: number;
  avgProcessingMs: number | null;
  finishedRuns: number;
  byStatus: Record<string, number>;
}

const MIX = [
  { key: "QUALIFIED_ALL", label: "Drafted / sent", color: "bg-teal" },
  { key: "MANUAL_REVIEW", label: "Needs a human", color: "bg-amber-500" },
  { key: "DISQUALIFIED", label: "Not a fit", color: "bg-slate-400" },
  { key: "FAILED", label: "Failed", color: "bg-red-500" },
  { key: "IN_PROGRESS", label: "In progress", color: "bg-primary" },
];

export default function Overview() {
  const openResearch = useResearch();
  const stats = useApi<Stats>("/api/stats", 15000);
  const events = useApi<{ items: EventRow[] }>("/api/events?limit=12", 15000);
  const review = useApi<{ items: PipelineListItem[] }>("/api/companies?status=DRAFT_READY", 15000);

  const s = stats.data;
  const bs = s?.byStatus ?? {};
  const waiting = bs.DRAFT_READY ?? 0;
  const human = bs.MANUAL_REVIEW ?? 0;

  const mix = {
    QUALIFIED_ALL: (bs.DRAFT_READY ?? 0) + (bs.SENT ?? 0),
    MANUAL_REVIEW: human,
    DISQUALIFIED: bs.DISQUALIFIED ?? 0,
    FAILED: bs.FAILED ?? 0,
    IN_PROGRESS: (bs.PENDING ?? 0) + (bs.RESEARCHING ?? 0) + (bs.QUALIFIED ?? 0),
  } as Record<string, number>;

  const funnel = s
    ? [
        { label: "Researched", value: s.total },
        { label: "Qualified", value: s.qualified },
        { label: "Contact verified", value: s.contactsVerified },
        { label: "Drafted", value: s.draftsReady },
        { label: "Test-sent", value: s.sent },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-teal">Growth desk</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl" suppressHydrationWarning>
            {greeting()}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {!s ? (
              "Loading your pipeline…"
            ) : s.total === 0 ? (
              "Your pipeline is empty — add a few company domains to get started."
            ) : (
              <>
                <strong className="text-ink">{waiting}</strong> draft{waiting === 1 ? "" : "s"} waiting for your review and{" "}
                <strong className="text-ink">{human}</strong> compan{human === 1 ? "y needs" : "ies need"} a human decision.
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/review" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-2">
            <Inbox className="h-4 w-4" /> Review queue
          </Link>
          <button onClick={openResearch} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg hover:opacity-90">
            <Plus className="h-4 w-4" /> Add companies
          </button>
        </div>
      </section>

      {stats.error && <ErrorNote>Could not load stats: {stats.error}</ErrorNote>}

      {/* KPI strip */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-6 lg:divide-x [&>*]:border-line max-lg:[&>*]:border-b">
          {!s
            ? Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="space-y-2 p-4">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-7 w-12" />
                </div>
              ))
            : [
                { label: "Processed", value: s.total, sub: "companies researched" },
                { label: "Qualified", value: s.qualified, sub: s.total ? `${Math.round((s.qualified / s.total) * 100)}% of processed` : "—" },
                { label: "Contacts", value: s.contactsVerified, sub: "verified via Hunter.io" },
                { label: "Drafts", value: s.draftsReady, sub: "evidence-checked" },
                { label: "Test sends", value: s.sent, sub: "to your inbox only" },
                { label: "Avg time", value: fmtDuration(s.avgProcessingMs), sub: "target: under 2 min", good: s.avgProcessingMs != null && s.avgProcessingMs < 120000 },
              ].map((k) => (
                <div key={k.label} className="p-4">
                  <p className="text-xs font-medium text-muted">{k.label}</p>
                  <p className={cn("mt-1 text-2xl font-semibold tabular-nums", "good" in k && k.good && "text-teal")}>{k.value}</p>
                  <p className="mt-0.5 text-xs text-muted">{k.sub}</p>
                </div>
              ))}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          {/* Funnel */}
          <Card>
            <CardHeader title="Conversion funnel" subtitle="Each stage only counts companies that passed every check before it." />
            <CardBody className="space-y-3">
              {!s ? (
                <Skeleton className="h-32" />
              ) : (
                funnel.map((f, i) => {
                  const pct = s.total ? (f.value / s.total) * 100 : 0;
                  return (
                    <div key={f.label} className="grid grid-cols-[120px_1fr_40px] items-center gap-3 text-sm">
                      <span className="text-muted">{f.label}</span>
                      <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-gradient-to-r from-primary to-teal transition-all" style={{ width: `${Math.max(pct, f.value ? 3 : 0)}%`, opacity: 1 - i * 0.12 }} />
                      </div>
                      <span className="text-right font-semibold tabular-nums">{f.value}</span>
                    </div>
                  );
                })
              )}
            </CardBody>
          </Card>

          {/* ICP mix */}
          <Card>
            <CardHeader
              title="Where companies landed"
              subtitle="Current outcome of every researched company."
              action={<Link href="/pipeline" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">All companies <ArrowRight className="h-3.5 w-3.5" /></Link>}
            />
            <CardBody>
              {!s ? (
                <Skeleton className="h-10" />
              ) : s.total === 0 ? (
                <p className="text-sm text-muted">No companies yet.</p>
              ) : (
                <>
                  <div className="flex h-3 overflow-hidden rounded-full bg-surface-2" role="img" aria-label="ICP fit breakdown">
                    {MIX.map((m) => (mix[m.key] ? <div key={m.key} className={m.color} style={{ width: `${(mix[m.key] / s.total) * 100}%` }} title={`${m.label}: ${mix[m.key]}`} /> : null))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                    {MIX.map((m) => (
                      <span key={m.key} className="inline-flex items-center gap-2 text-muted">
                        <span className={cn("h-2.5 w-2.5 rounded-full", m.color)} /> {m.label} <strong className="text-ink">{mix[m.key]}</strong>
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-muted">
                    Qualified = B2B SaaS + growth evidence + compliance pressure, each backed by a source page. Funding alone never qualifies.
                  </p>
                </>
              )}
            </CardBody>
          </Card>

          {/* Activity */}
          <Card>
            <CardHeader
              title="Recent activity"
              action={<Link href="/activity" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Full log <ArrowRight className="h-3.5 w-3.5" /></Link>}
            />
            {events.loading && !events.data ? (
              <CardBody><Skeleton className="h-40" /></CardBody>
            ) : !events.data?.items.length ? (
              <EmptyState title="Nothing yet">Activity appears as soon as the agent starts researching.</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {events.data.items.map((e) => (
                  <li key={e.id}>
                    <Link href={e.company_id ? `/companies/${e.company_id}` : "/activity"} className="flex items-start gap-3 px-5 py-3 text-sm hover:bg-surface-2">
                      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", DOT[e.type] ?? "bg-slate-400")} aria-hidden />
                      <span className="min-w-0 flex-1">
                        {e.domain && <span className="font-medium text-ink">{e.domain} </span>}
                        <span className="text-muted">{e.message.length > 140 ? e.message.slice(0, 140) + "…" : e.message}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted" suppressHydrationWarning>{timeAgo(e.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Right rail */}
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Needs you"
              subtitle="Drafts ready for review and a test send."
              action={<Link href="/review" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Queue <ArrowRight className="h-3.5 w-3.5" /></Link>}
            />
            {review.loading && !review.data ? (
              <CardBody><Skeleton className="h-20" /></CardBody>
            ) : !review.data?.items.length ? (
              <EmptyState icon={<Sparkles className="h-6 w-6" />} title="All caught up">New drafts land here after research.</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {review.data.items.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    <Link href={`/companies/${c.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">{c.name ?? c.domain}</span>
                        <span className="block truncate text-xs text-muted">{c.contact_name ? `${c.contact_name} · ${c.contact_title}` : c.domain}</span>
                      </span>
                      <StatusBadge value={c.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Safety rails" />
            <CardBody>
              <ul className="space-y-3 text-sm">
                {[
                  "Emails reach your test inbox only — never a prospect.",
                  "Every send needs your explicit confirmation, once.",
                  "Contacts must be Hunter-verified; none are guessed.",
                  "Email hooks must quote the company's own website.",
                  "The research agent stops after 4 extra pages.",
                ].map((t) => (
                  <li key={t} className="flex gap-2.5">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal" />
                    <span className="text-muted">{t}</span>
                  </li>
                ))}
              </ul>
              <Link href="/readiness" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Why we built it this way <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

const DOT: Record<string, string> = {
  research: "bg-primary",
  qualification: "bg-teal",
  draft: "bg-violet-500",
  send: "bg-emerald-500",
  review: "bg-amber-500",
  api_failure: "bg-red-500",
  error: "bg-red-500",
};
