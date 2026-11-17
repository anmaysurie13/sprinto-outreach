"use client";
import { Inbox, Loader2, RotateCcw, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { StatusBadge, STAGE_LABELS } from "@/components/status-badge";
import { useToast } from "@/components/toast";
import { Button, Card, EmptyState, ErrorNote, Input, PageHeader, Skeleton } from "@/components/ui";
import { api, fmtTime, runMany, useApi } from "@/lib/client";
import { COMPANY_STATUSES } from "@/lib/types";
import type { PipelineListItem } from "@/services/database";

export default function Pipeline() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [working, setWorking] = useState(false);
  const url = useMemo(() => `/api/companies?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}) })}`, [q, status]);
  const { data, loading, error, reload } = useApi<{ items: PipelineListItem[] }>(url, working ? 4000 : undefined);

  const items = data?.items ?? [];
  const unfinished = items.filter((i) => ["PENDING", "RESEARCHING", "QUALIFIED"].includes(i.status));

  async function resume() {
    setWorking(true);
    await runMany(unfinished.map((i) => i.id), () => {});
    setWorking(false);
    toast("success", "Resume finished.");
    void reload();
  }
  async function retry(id: number) {
    try {
      await api(`/api/companies/${id}/retry`, { method: "POST" });
      toast("success", "Retrying — advancing the workflow…");
      await runMany([id], () => {});
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Retry failed");
    }
    void reload();
  }

  return (
    <>
      <PageHeader
        title="Prospect Pipeline"
        description="Every company with its ICP verdict, contact and current stage."
        action={
          unfinished.length > 0 && (
            <Button variant="outline" onClick={resume} disabled={working}>
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Resume {unfinished.length} unfinished
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" />
          <Input aria-label="Search companies" placeholder="Search domain or name…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink">
          <option value="">All statuses</option>
          {COMPANY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <Card className="overflow-hidden">
        {loading && !data ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<Inbox className="h-8 w-8" />} title={q || status ? "No matches" : "Pipeline is empty"}>
            {q || status ? "Try clearing the filters." : <Link href="/prospects" className="font-medium text-primary underline">Add your first domains</Link>}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase tracking-wide text-muted">
                <tr>
                  {["Company", "ICP status", "Contact", "Stage", "Status", "Updated", ""].map((h) => (
                    <th key={h} scope="col" className="px-4 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((c) => (
                  <tr key={c.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <Link href={`/companies/${c.id}`} className="font-medium text-primary hover:underline">
                        {c.name ?? c.domain}
                      </Link>
                      {c.name && <p className="text-xs text-muted">{c.domain}</p>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge value={c.icp_status} /></td>
                    <td className="px-4 py-3">
                      {c.contact_name ? (
                        <>
                          <p className="text-ink">{c.contact_name}</p>
                          <p className="text-xs text-muted">{c.contact_title}</p>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">{c.current_stage ? STAGE_LABELS[c.current_stage] : "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge value={c.status} />
                      {c.review_reason && ["FAILED", "MANUAL_REVIEW"].includes(c.status) && (
                        <p className="mt-1 max-w-56 truncate text-xs text-muted" title={c.review_reason}>
                          {c.review_reason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">{fmtTime(c.updated_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {c.status === "FAILED" && (
                        <Button size="sm" variant="outline" onClick={() => retry(c.id)}>
                          <RotateCcw className="h-3.5 w-3.5" /> Retry
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
