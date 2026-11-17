"use client";
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, MailCheck, RotateCcw, Save, Send, Sparkles, Play } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { StatusBadge, STAGE_LABELS } from "@/components/status-badge";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorNote, Input, Skeleton, Textarea } from "@/components/ui";
import { api, fmtDuration, fmtTime, runCompany, useApi } from "@/lib/client";
import { MAX_EXTRA_PAGES, type CompanyRow, type ContactRow, type EventRow, type OutreachRow, type RunRow } from "@/lib/types";

interface Detail {
  company: CompanyRow;
  evidence: { id: number; source_url: string; kind: string; fetch_ok: boolean; fetch_error: string | null; content_chars: number; link_count: number; extracted_facts: Record<string, unknown> | null }[];
  contact: ContactRow | null;
  testInbox: string | null;
  outreach: OutreachRow | null;
  run: RunRow | null;
  events: EventRow[];
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const { data, loading, error, reload } = useApi<Detail>(`/api/companies/${id}`, running ? 3000 : undefined);

  async function proceed() {
    setRunning(true);
    await runCompany(Number(id), () => {});
    setRunning(false);
    void reload();
  }
  async function retry() {
    try {
      await api(`/api/companies/${id}/retry`, { method: "POST" });
      void proceed();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Retry failed");
    }
  }

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return null;

  const { company: c, run } = data;
  const terminal = ["DISQUALIFIED", "MANUAL_REVIEW", "DRAFT_READY", "SENT", "FAILED"].includes(c.status);
  const profile = c.profile;
  const verdict = c.icp_verdict;
  const history = [...data.events].reverse().filter((e) => ["research", "qualification", "review", "api_failure"].includes(e.type));

  return (
    <>
      <Link href="/pipeline" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Pipeline
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{c.name ?? c.domain}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            {c.domain} <StatusBadge value={c.status} />
            {run && <span>· {STAGE_LABELS[run.current_stage]}</span>}
            {run && <span>· {fmtDuration(run.duration_ms)} processing</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {c.status === "FAILED" && (
            <Button variant="outline" onClick={retry} disabled={running}>
              <RotateCcw className="h-4 w-4" /> Retry
            </Button>
          )}
          {!terminal && (
            <Button onClick={proceed} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {running ? "Processing…" : "Continue processing"}
            </Button>
          )}
        </div>
      </div>

      {c.review_reason && ["FAILED", "MANUAL_REVIEW"].includes(c.status) && (
        <div className={`mb-6 rounded-xl px-4 py-3 text-sm ${c.status === "FAILED" ? "tone-bad" : "tone-warn"}`} role="status">
          <strong>{c.status === "FAILED" ? "Failed:" : "Needs human review:"}</strong> {c.review_reason}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Company profile" subtitle="Unknown fields stay empty — never guessed." />
          <CardBody>
            {profile ? (
              <dl className="space-y-2 text-sm">
                <Row k="Product" v={profile.product_description} />
                <Row k="Business model" v={profile.business_model} />
                <Row k="SaaS" v={profile.is_saas === null ? null : profile.is_saas ? "Yes" : "No"} />
                <Row k="Industry" v={profile.industry} />
                <Row k="Funding stage" v={profile.funding_stage} />
                {profile.missing_fields.length > 0 && (
                  <div className="pt-2">
                    <dt className="mb-1 text-muted">Missing</dt>
                    <dd className="flex flex-wrap gap-1.5">
                      {profile.missing_fields.map((m) => (
                        <Badge key={m} tone="warn">{m.replace(/_/g, " ")}</Badge>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted">Not extracted yet.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="ICP verdict" action={<StatusBadge value={c.icp_status} />} />
          <CardBody className="space-y-3 text-sm">
            {verdict ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(verdict.criteria).map(([k, v]) => (
                    <span key={k} className="inline-flex items-center gap-1.5 text-muted">
                      {k.replace(/_/g, " ")} <StatusBadge value={v} />
                    </span>
                  ))}
                </div>
                <p className="text-ink">{c.icp_reasoning}</p>
                {verdict.evidence.length > 0 && (
                  <ul className="space-y-1.5 border-t border-line pt-3">
                    {verdict.evidence.map((e, i) => (
                      <li key={i} className="text-muted">
                        “{e.fact}”{" "}
                        <a href={e.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                          source <ExternalLink className="h-3 w-3" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-muted">Not qualified yet.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Agent research history" subtitle={`Additional pages fetched: ${run?.pages_fetched ?? 0} of ${MAX_EXTRA_PAGES} allowed`} />
          {history.length === 0 ? (
            <EmptyState title="No research yet" />
          ) : (
            <ol className="max-h-96 divide-y divide-line overflow-y-auto">
              {history.map((e) => (
                <li key={e.id} className="px-5 py-2.5 text-sm">
                  <span className="mr-2 text-xs text-muted">{fmtTime(e.created_at)}</span>
                  <Badge tone={e.type === "api_failure" ? "bad" : e.type === "review" ? "warn" : e.type === "qualification" ? "ok" : "info"} className="mr-2">
                    {e.type.replace(/_/g, " ")}
                  </Badge>
                  {e.message}
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card>
          <CardHeader title="Evidence & sources" subtitle="Every claim traces back to one of these pages." />
          {data.evidence.length === 0 ? (
            <EmptyState title="No pages fetched yet" />
          ) : (
            <ul className="divide-y divide-line">
              {data.evidence.map((e) => (
                <li key={e.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={e.source_url} target="_blank" rel="noreferrer" className="break-all font-medium text-primary hover:underline">
                      {e.source_url}
                    </a>
                    <Badge tone={e.fetch_ok ? "ok" : "bad"}>{e.fetch_ok ? e.kind : "fetch failed"}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{e.fetch_ok ? `${e.content_chars.toLocaleString()} chars stored` : e.fetch_error}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Hunter.io contact" />
          <CardBody className="text-sm">
            {data.contact ? (
              <dl className="space-y-2">
                <Row k="Name" v={data.contact.name} />
                <Row k="Title" v={data.contact.title} />
                <Row k="Email (masked)" v={data.contact.email} />
                <div className="flex gap-2">
                  <dt className="w-32 shrink-0 text-muted">Verification</dt>
                  <dd><Badge tone={data.contact.verification_status === "valid" ? "ok" : "warn"}>{data.contact.verification_status}</Badge></dd>
                </div>
                <Row k="Selected because" v={data.contact.rank_reason} />
              </dl>
            ) : (
              <p className="text-muted">No contact selected. Contacts are never invented or guessed — if Hunter.io has no verified, relevant person, the company goes to manual review.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Two pain points" />
          {data.outreach?.pain_points ? (
            <ul className="divide-y divide-line">
              {data.outreach.pain_points.map((p, i) => (
                <li key={i} className="space-y-1 px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-ink">{p.title}</p>
                    <Badge tone={p.kind === "verified" ? "ok" : "neutral"}>{p.kind === "verified" ? "Verified fact" : "Likely hypothesis"}</Badge>
                  </div>
                  <p className="text-muted">{p.rationale}</p>
                  <p className="text-xs text-muted">Sprinto capability: {p.sprinto_capability}</p>
                  {p.evidence_url && (
                    <a href={p.evidence_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline">
                      evidence <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Not generated yet" />
          )}
        </Card>
      </div>

      <DraftCard key={`${data.outreach?.subject}|${data.outreach?.draft}`} detail={data} onChange={reload} />
    </>
  );
}

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0 break-words text-ink">{v || <span className="text-muted">unknown</span>}</dd>
    </div>
  );
}

function DraftCard({ detail, onChange }: { detail: Detail; onChange: () => void }) {
  const toast = useToast();
  const o = detail.outreach;
  const [subject, setSubject] = useState(o?.subject ?? "");
  const [body, setBody] = useState(o?.draft ?? "");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "revise" | "send">("");
  const [issues, setIssues] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [agree, setAgree] = useState(false);

  if (!o?.draft) {
    return (
      <Card className="mt-6">
        <CardHeader title="Email draft" />
        <EmptyState title="No draft yet">A draft is generated after the company is qualified, a verified contact is found and two pain points are identified.</EmptyState>
      </Card>
    );
  }

  const dirty = subject !== (o.subject ?? "") || body !== o.draft;
  const locked = o.send_status === "SENT" || o.send_status === "SENDING";
  const wc = words(body);
  const first = detail.contact?.name.split(" ")[0] ?? "";

  async function save() {
    setBusy("save");
    setIssues([]);
    try {
      await api(`/api/companies/${detail.company.id}/draft`, { method: "PATCH", json: { subject, body } });
      toast("success", "Draft saved.");
      onChange();
    } catch (e) {
      setIssues((e as { issues?: string[] }).issues ?? []);
      toast("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy("");
    }
  }
  async function revise() {
    setBusy("revise");
    try {
      await api(`/api/companies/${detail.company.id}/draft`, { method: "POST", json: { feedback } });
      setFeedback("");
      toast("success", "AI revision applied.");
      onChange();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Revision failed");
    } finally {
      setBusy("");
    }
  }
  async function send() {
    setBusy("send");
    try {
      await api(`/api/companies/${detail.company.id}/send`, { method: "POST", json: { confirmed: true } });
      toast("success", "The email API accepted the test email.");
      setConfirming(false);
      setAgree(false);
      onChange();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Send failed");
      onChange();
    } finally {
      setBusy("");
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader
        title="Email draft"
        subtitle={`Addressed to ${detail.contact?.name ?? "the contact"} — but any test send goes only to your test inbox.`}
        action={<Badge tone={wc >= 110 && wc <= 175 ? "ok" : "warn"}>{wc} words · target 120–160</Badge>}
      />
      <CardBody className="space-y-4">
        <div>
          <label htmlFor="subj" className="mb-1 block text-sm font-medium">Subject</label>
          <Input id="subj" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={locked} />
        </div>
        <div>
          <label htmlFor="body" className="mb-1 block text-sm font-medium">Body</label>
          <Textarea id="body" rows={13} value={body} onChange={(e) => setBody(e.target.value)} disabled={locked} className="leading-relaxed" />
          {first && !new RegExp(`\\b${first}\\b`, "i").test(body.slice(0, 40)) && <p className="mt-1 text-xs text-[var(--warn-fg)]">The greeting should address {first} by name.</p>}
        </div>
        {o.hook && (
          <p className="text-xs text-muted">
            Hook source: <a href={o.hook.source_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{o.hook.source_url}</a> — “{o.hook.evidence_quote}”
          </p>
        )}
        {issues.length > 0 && (
          <ErrorNote>
            <p className="font-medium">Unsupported claims were rejected:</p>
            <ul className="mt-1 list-disc pl-5">{issues.map((i) => <li key={i}>{i}</li>)}</ul>
          </ErrorNote>
        )}

        {!locked && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={save} disabled={!dirty || !!busy}>
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save edits
            </Button>
            <span className="text-xs text-muted">{o.draft_history.length} version(s) in history</span>
          </div>
        )}

        {!locked && o.revision_count < 1 && (
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <label htmlFor="fb" className="mb-1 block text-sm font-medium">One AI revision <span className="font-normal text-muted">(before human review)</span></label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input id="fb" placeholder="e.g. shorter, softer CTA, lead with the security page" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
              <Button variant="outline" onClick={revise} disabled={!feedback.trim() || !!busy || dirty}>
                {busy === "revise" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Revise
              </Button>
            </div>
            {dirty && <p className="mt-1 text-xs text-muted">Save your edits first.</p>}
          </div>
        )}

        <div className="border-t border-line pt-4">
          {o.send_status === "SENT" ? (
            <div className="tone-ok flex items-start gap-3 rounded-xl p-4 text-sm" role="status">
              <MailCheck className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-medium">Email API accepted the test email{o.sent_at ? ` · ${fmtTime(o.sent_at)}` : ""}</p>
                <p className="mt-0.5">Message ID: <code>{o.gmail_message_id}</code>. This confirms the email API accepted the request, not that it reached the inbox — check your test inbox.</p>
              </div>
            </div>
          ) : o.send_status === "SENDING" ? (
            <ErrorNote>A send is marked in progress (or was interrupted). Check your test inbox before doing anything; duplicate sends are blocked.</ErrorNote>
          ) : detail.company.status !== "DRAFT_READY" ? (
            <p className="text-sm text-muted">Test sending is available once the company status is DRAFT READY.</p>
          ) : !confirming ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => setConfirming(true)} disabled={dirty || !!busy}>
                <Send className="h-4 w-4" /> Test-send…
              </Button>
              {dirty && <span className="text-xs text-muted">Save your edits first.</span>}
              {o.send_status === "FAILED" && <span className="text-sm text-[var(--bad-fg)]">Last attempt failed: {o.send_error}</span>}
            </div>
          ) : (
            <div className="rounded-xl border border-line bg-surface-2 p-4 text-sm">
              <p className="font-medium text-ink">Confirm test send</p>
              <p className="mt-1 text-muted">
                One email will be sent to your test inbox{detail.testInbox ? ` (${detail.testInbox})` : ""} only. {detail.contact?.name} will <strong>not</strong> be contacted. You cannot send this draft twice.
              </p>
              <label className="mt-3 flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>I understand and confirm this single test send.</span>
              </label>
              <div className="mt-3 flex gap-2">
                <Button onClick={send} disabled={!agree || busy === "send"}>
                  {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Send test email
                </Button>
                <Button variant="ghost" onClick={() => { setConfirming(false); setAgree(false); }} disabled={busy === "send"}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-48" />)}
      </div>
    </div>
  );
}
