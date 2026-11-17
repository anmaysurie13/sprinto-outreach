"use client";
import { ScrollText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge, Card, EmptyState, ErrorNote, PageHeader, Skeleton } from "@/components/ui";
import { fmtTime, useApi } from "@/lib/client";
import { cn } from "@/lib/cn";
import type { EventRow } from "@/lib/types";

const TYPES: { key: string; label: string; tone: "ok" | "warn" | "bad" | "info" | "neutral" }[] = [
  { key: "", label: "All", tone: "neutral" },
  { key: "research", label: "Research attempts", tone: "info" },
  { key: "qualification", label: "Qualification decisions", tone: "ok" },
  { key: "api_failure", label: "API failures", tone: "bad" },
  { key: "draft", label: "Draft history", tone: "info" },
  { key: "send", label: "Test sends", tone: "ok" },
  { key: "review", label: "Manual review", tone: "warn" },
  { key: "error", label: "Errors", tone: "bad" },
];

export default function Activity() {
  const [type, setType] = useState("");
  const { data, loading, error } = useApi<{ items: EventRow[] }>(`/api/events${type ? `?type=${type}` : ""}`, 10000);
  const items = data?.items ?? [];

  return (
    <>
      <PageHeader title="Activity & Logs" description="Research attempts, API failures, qualification decisions, draft history and test-send results. Credentials and tokens are never logged." />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by event type">
        {TYPES.map((t) => (
          <button
            key={t.key}
            onClick={() => setType(t.key)}
            aria-pressed={type === t.key}
            className={cn("rounded-full border px-3 py-1 text-sm transition-colors", type === t.key ? "border-primary bg-primary text-primary-fg" : "border-line bg-surface text-muted hover:text-ink")}
          >
            {t.label}
          </button>
        ))}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Card>
        {loading && !data ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<ScrollText className="h-8 w-8" />} title="No activity yet">
            Events appear here as soon as a company is processed.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((e) => {
              const t = TYPES.find((x) => x.key === e.type);
              return (
                <li key={e.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:gap-4">
                  <span className="w-32 shrink-0 text-xs text-muted">{fmtTime(e.created_at)}</span>
                  <Badge tone={t?.tone ?? "neutral"} className="self-start">
                    {e.type.replace(/_/g, " ")}
                  </Badge>
                  <div className="min-w-0 flex-1 text-sm">
                    {e.company_id && e.domain && (
                      <Link href={`/companies/${e.company_id}`} className="mr-2 font-medium text-primary hover:underline">
                        {e.domain}
                      </Link>
                    )}
                    <span className="break-words text-ink">{e.message}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
