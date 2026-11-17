"use client";
import { Loader2, Play } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { StatusBadge, STAGE_LABELS } from "@/components/status-badge";
import { useToast } from "@/components/toast";
import { Button, Card, CardBody, CardHeader, ErrorNote, PageHeader, Textarea } from "@/components/ui";
import { parseDomainList } from "@/lib/domain";
import { api, runMany, type StepResult } from "@/lib/client";

interface Row {
  id: number;
  domain: string;
  status: string;
  stage: string;
  message: string;
  error?: string;
}

export default function Prospects() {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseDomainList(text), [text]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{
        accepted: { id: number; domain: string }[];
        existing: { id: number; domain: string; status: string }[];
        rejected: { input: string; reason: string }[];
      }>("/api/companies", { method: "POST", json: { domains: text } });

      if (res.existing.length) toast("error", `${res.existing.length} already in the pipeline (skipped): ${res.existing.map((e) => e.domain).join(", ")}`);
      if (!res.accepted.length) {
        setError(res.rejected.length ? "No valid new domains to process." : "Nothing new to process.");
        return;
      }
      const initial: Row[] = res.accepted.map((a) => ({ id: a.id, domain: a.domain, status: "PENDING", stage: "scrape", message: "Queued" }));
      setRows(initial);
      setText("");
      await runMany(
        res.accepted.map((a) => a.id),
        (id, r) =>
          setRows((cur) =>
            cur.map((row) =>
              row.id !== id
                ? row
                : "error" in r
                  ? { ...row, status: "FAILED", error: r.error }
                  : { ...row, status: (r as StepResult).status, stage: (r as StepResult).stage, message: (r as StepResult).message, error: undefined },
            ),
          ),
      );
      toast("success", "Processing finished. Open the Pipeline to review results.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Prospect Input"
        description="Paste one or many company domains (one per line, or comma-separated). Domains are validated, normalised and de-duplicated. Max 25 per batch."
      />

      <Card>
        <CardHeader title="Company domains" />
        <CardBody className="space-y-4">
          <label htmlFor="domains" className="sr-only">
            Company domains
          </label>
          <Textarea id="domains" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"fintech.com\nsaas.io\nhttps://www.example.com/pricing"} disabled={busy} />

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="text-muted">
              <strong className="text-ink">{parsed.domains.length}</strong> valid unique domain{parsed.domains.length === 1 ? "" : "s"}
            </span>
            {parsed.rejected.length > 0 && (
              <span className="text-[var(--bad-fg)]">
                {parsed.rejected.length} invalid: {parsed.rejected.slice(0, 4).map((r) => `${r.input} (${r.reason})`).join("; ")}
                {parsed.rejected.length > 4 && "…"}
              </span>
            )}
          </div>

          {error && <ErrorNote>{error}</ErrorNote>}

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={start} disabled={busy || parsed.domains.length === 0}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {busy ? "Processing…" : "Add & start processing"}
            </Button>
            <p className="text-xs text-muted">Progress is saved after every step. If you close this tab, resume from the Pipeline page.</p>
          </div>
        </CardBody>
      </Card>

      {rows.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Progress" subtitle="Each row advances one persisted step at a time." />
          <ul className="divide-y divide-line" aria-live="polite">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div className="min-w-0">
                  <Link href={`/companies/${r.id}`} className="font-medium text-primary hover:underline">
                    {r.domain}
                  </Link>
                  <p className="text-xs text-muted">{r.error ? <span className="text-[var(--bad-fg)]">{r.error}</span> : `${STAGE_LABELS[r.stage] ?? r.stage} — ${r.message}`}</p>
                </div>
                <StatusBadge value={r.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
