"use client";
import { ArrowRight, CircleAlert, MailCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { Card, CardHeader, EmptyState, ErrorNote, PageHeader, Skeleton } from "@/components/ui";
import { useApi } from "@/lib/client";
import { timeAgo } from "@/lib/time";
import type { PipelineListItem } from "@/services/database";

function Section({
  title,
  subtitle,
  status,
  icon,
  empty,
  showReason,
}: {
  title: string;
  subtitle: string;
  status: string;
  icon: React.ReactNode;
  empty: string;
  showReason?: boolean;
}) {
  const { data, loading, error } = useApi<{ items: PipelineListItem[] }>(`/api/companies?status=${status}`, 15000);
  const items = data?.items ?? [];
  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2">{icon} {title} {data && <span className="text-muted">({items.length})</span>}</span>} subtitle={subtitle} />
      {error && <div className="p-5"><ErrorNote>{error}</ErrorNote></div>}
      {loading && !data ? (
        <div className="space-y-3 p-5">{Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Sparkles className="h-6 w-6" />} title={empty} />
      ) : (
        <ul className="divide-y divide-line">
          {items.map((c) => (
            <li key={c.id}>
              <Link href={`/companies/${c.id}`} className="group flex items-center gap-4 px-5 py-4 hover:bg-surface-2">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-sm font-semibold uppercase text-primary">
                  {(c.name ?? c.domain).slice(0, 2)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{c.name ?? c.domain}</span>
                  <span className="block truncate text-sm text-muted">
                    {showReason ? c.review_reason ?? "Needs review" : c.contact_name ? `To ${c.contact_name}, ${c.contact_title}` : c.domain}
                  </span>
                </span>
                <span className="hidden shrink-0 text-xs text-muted sm:block" suppressHydrationWarning>{timeAgo(c.updated_at)}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function Review() {
  return (
    <>
      <PageHeader
        title="Review queue"
        description="You're the reviewer, not the researcher. Check each draft against its evidence, edit if needed, then send a single test to your own inbox."
      />
      <div className="space-y-6">
        <Section title="Drafts ready" subtitle="Qualified, contact verified, draft passed fact checks." status="DRAFT_READY" icon={<MailCheck className="h-4 w-4 text-teal" />} empty="No drafts waiting" />
        <Section
          title="Needs a human decision"
          subtitle="The agent stopped instead of guessing — evidence, contact or draft wasn't good enough."
          status="MANUAL_REVIEW"
          icon={<CircleAlert className="h-4 w-4 text-amber-500" />}
          empty="Nothing needs a decision"
          showReason
        />
        <Section title="Failed" subtitle="Technical failures (site unreachable, API error). Retry from the company page." status="FAILED" icon={<CircleAlert className="h-4 w-4 text-red-500" />} empty="No failures" showReason />
      </div>
    </>
  );
}
