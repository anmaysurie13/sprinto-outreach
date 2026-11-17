"use client";
import { Loader2, Play, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { StatusBadge, STAGE_LABELS } from "@/components/status-badge";
import { useToast } from "@/components/toast";
import { Button, ErrorNote } from "@/components/ui";
import { api, runMany, type StepResult } from "@/lib/client";
import { cn } from "@/lib/cn";
import { normalizeDomain } from "@/lib/domain";

/* ---------------- chip input ---------------- */
interface Chip {
  raw: string;
  domain: string | null;
  reason?: string;
}

export function DomainChips({ chips, setChips, disabled }: { chips: Chip[]; setChips: (c: Chip[]) => void; disabled?: boolean }) {
  const [text, setText] = useState("");

  function commit(raw: string) {
    const parts = raw.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...chips];
    for (const p of parts) {
      const r = normalizeDomain(p);
      const domain = r.ok ? r.domain : null;
      if (domain && next.some((c) => c.domain === domain)) continue; // dedupe
      next.push({ raw: p, domain, reason: r.ok ? undefined : r.reason });
    }
    setChips(next.slice(0, 25));
    setText("");
  }

  return (
    <div className={cn("flex min-h-24 flex-wrap content-start gap-2 rounded-xl border border-line bg-surface p-3 focus-within:border-primary", disabled && "opacity-60")}>
      {chips.map((c, i) => (
        <span
          key={c.raw + i}
          title={c.reason}
          className={cn("inline-flex items-center gap-1 rounded-full py-1 pl-3 pr-1.5 text-sm", c.domain ? "tone-info" : "tone-bad line-through decoration-1")}
        >
          {c.domain ?? c.raw}
          {!disabled && (
            <button aria-label={`Remove ${c.raw}`} onClick={() => setChips(chips.filter((_, j) => j !== i))} className="rounded-full p-0.5 hover:bg-black/10">
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      <input
        aria-label="Add a company domain"
        disabled={disabled}
        value={text}
        placeholder={chips.length ? "Add another…" : "Type a domain and press Enter — e.g. acme.io"}
        onChange={(e) => (/[\s,;]$/.test(e.target.value) ? commit(e.target.value) : setText(e.target.value))}
        onPaste={(e) => {
          e.preventDefault();
          commit(text + " " + e.clipboardData.getData("text"));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(text);
          } else if (e.key === "Backspace" && !text && chips.length) setChips(chips.slice(0, -1));
        }}
        onBlur={() => commit(text)}
        className="min-w-48 flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-muted"
      />
    </div>
  );
}

/* ---------------- research panel (used by dialog + page) ---------------- */
interface Row {
  id: number;
  domain: string;
  status: string;
  stage: string;
  error?: string;
}

export function ResearchPanel({ onFinished }: { onFinished?: () => void }) {
  const toast = useToast();
  const [chips, setChips] = useState<Chip[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = chips.filter((c) => c.domain);
  const invalid = chips.length - valid.length;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ accepted: { id: number; domain: string }[]; existing: { domain: string }[] }>("/api/companies", {
        method: "POST",
        json: { domains: valid.map((c) => c.domain).join("\n") },
      });
      if (res.existing.length) toast("error", `Already in the pipeline: ${res.existing.map((e) => e.domain).join(", ")}`);
      if (!res.accepted.length) {
        setError("Nothing new to research.");
        return;
      }
      setChips([]);
      setRows(res.accepted.map((a) => ({ id: a.id, domain: a.domain, status: "PENDING", stage: "scrape" })));
      await runMany(
        res.accepted.map((a) => a.id),
        (id, r) =>
          setRows((cur) =>
            cur.map((row) =>
              row.id !== id ? row : "error" in r ? { ...row, status: "FAILED", error: r.error } : { ...row, status: (r as StepResult).status, stage: (r as StepResult).stage },
            ),
          ),
      );
      toast("success", "Research finished.");
      onFinished?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <DomainChips chips={chips} setChips={setChips} disabled={busy} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          {valid.length} ready{invalid > 0 && <span className="text-[var(--bad-fg)]"> · {invalid} invalid (hover for reason)</span>} · max 25 per batch, 30 per day
        </span>
        <span>~20–60 s per company · 2 run in parallel</span>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}

      {rows.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line" aria-live="polite">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <Link href={`/companies/${r.id}`} className="font-medium text-primary hover:underline">{r.domain}</Link>
                <p className="truncate text-xs text-muted">{r.error ?? STAGE_LABELS[r.stage] ?? r.stage}</p>
              </div>
              <div className="flex items-center gap-2">
                {busy && !["DISQUALIFIED", "MANUAL_REVIEW", "DRAFT_READY", "SENT", "FAILED"].includes(r.status) && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
                <StatusBadge value={r.status} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-xs text-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal" />
        Nothing is emailed automatically. Drafts wait for your review, and test sends only ever reach your own test inbox.
      </div>

      <div className="flex justify-end">
        <Button onClick={start} disabled={busy || valid.length === 0}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {busy ? "Researching…" : `Research ${valid.length || ""} ${valid.length === 1 ? "company" : "companies"}`}
        </Button>
      </div>
    </div>
  );
}

/* ---------------- dialog + global shortcut ---------------- */
const ResearchCtx = createContext<() => void>(() => {});
export const useResearch = () => useContext(ResearchCtx);

export function ResearchProvider({ children, onFinished }: { children: React.ReactNode; onFinished?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const show = useCallback(() => setOpen(true), []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && !/input|textarea|select/i.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ResearchCtx.Provider value={show}>
      {children}
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        aria-labelledby="research-title"
        className="m-auto w-[min(640px,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-sm"
      >
        {open && (
          <div className="p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="research-title" className="text-lg font-semibold">Add companies</h2>
                <p className="mt-1 text-sm text-muted">The agent reads each site, checks it against Sprinto&apos;s ICP, finds a verified decision-maker and drafts an evidence-backed email.</p>
              </div>
              <button aria-label="Close" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2">
                <X className="h-5 w-5" />
              </button>
            </div>
            <ResearchPanel onFinished={onFinished} />
          </div>
        )}
      </dialog>
    </ResearchCtx.Provider>
  );
}
