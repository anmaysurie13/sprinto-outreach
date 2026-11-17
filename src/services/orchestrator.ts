import { MissingEnvError } from "@/lib/env";
import {
  MAX_EXTRA_PAGES,
  type CompanyProfile,
  type CompanyRow,
  type CompanyStatus,
  type RunRow,
  type Stage,
  type Verdict,
} from "@/lib/types";
import * as db from "./database";
import { DraftValidationError, checkClaims, generateEmail, type EvidencePage } from "./email-generator";
import { computeMissing, extractFromPage, mergeProfile } from "./extractor";
import { GeminiError } from "./gemini";
import { HunterError, domainSearch, rankContacts } from "./hunter";
import { generatePainPoints } from "./pain-points";
import { missingEvidence, qualify } from "./qualifier";
import { chooseNextPage, decideNext } from "./research-agent";
import { fetchPage, type ScrapeErrorCode } from "./scraper";

export const TERMINAL: CompanyStatus[] = ["DISQUALIFIED", "MANUAL_REVIEW", "DRAFT_READY", "SENT", "FAILED"];

export interface StepResult {
  companyId: number;
  status: CompanyStatus;
  stage: Stage;
  done: boolean;
  busy?: boolean;
  message: string;
}

/** Scrape failures that retrying won't fix → hand to a human instead of FAILED. */
const REVIEW_CODES: ScrapeErrorCode[] = ["BLOCKED", "ROBOTS_DISALLOWED", "EMPTY_CONTENT", "NOT_HTML", "REDIRECT_OFFSITE", "PRIVATE_HOST", "BAD_URL"];

class StageFailure extends Error {
  constructor(message: string, public toReview = false) {
    super(message);
  }
}

/** Run exactly ONE unit of pipeline work, persist state, return. Safe to call repeatedly (resumable). */
export async function stepCompany(id: number): Promise<StepResult> {
  const company = await db.getCompany(id);
  if (!company) throw new Error("Company not found");
  const run0 = await db.getRun(id);
  if (!run0) throw new Error("Run record missing");
  const snapshot = (message: string, c = company, r: RunRow = run0, busy = false): StepResult => ({
    companyId: id, status: c.status, stage: r.current_stage, done: TERMINAL.includes(c.status), busy, message,
  });
  if (TERMINAL.includes(company.status)) return snapshot("Already finished");

  const run = await db.lockRun(id);
  if (!run) return snapshot("Another step is already running for this company", company, run0, true);

  const t0 = Date.now();
  try {
    if (company.status === "PENDING") await db.updateCompany(id, { status: "RESEARCHING" });
    await db.updateRun(id, { addAttempt: true });
    await runStage(company, run);
  } catch (e) {
    await failStage(company, run.current_stage, e);
  } finally {
    await db.updateRun(id, { addMs: Date.now() - t0, unlock: true });
  }
  const [c2, r2] = await Promise.all([db.getCompany(id), db.getRun(id)]);
  return snapshot("Step complete", c2!, r2!);
}

async function failStage(company: CompanyRow, stage: Stage, e: unknown) {
  const message = e instanceof Error ? e.message : "Unknown error";
  if (e instanceof StageFailure && e.toReview) {
    await finishReview(company.id, stage, message);
    return;
  }
  const isApi = e instanceof GeminiError || e instanceof HunterError || e instanceof MissingEnvError;
  await db.updateRun(company.id, { error: { stage, message } });
  await db.logEvent({ company_id: company.id, type: isApi ? "api_failure" : "error", stage, message });
  await db.updateCompany(company.id, { status: "FAILED", review_reason: message.slice(0, 500) });
}

async function finishReview(id: number, stage: string, reason: string, icp = false) {
  await db.updateCompany(id, { status: "MANUAL_REVIEW", review_reason: reason, ...(icp ? { icp_status: "MANUAL_REVIEW" } : {}) });
  await db.updateRun(id, { stage: "done", finished: true });
  await db.logEvent({ company_id: id, type: "review", stage, message: `Manual review: ${reason}` });
}

async function runStage(company: CompanyRow, run: RunRow) {
  switch (run.current_stage) {
    case "scrape": return stageScrape(company);
    case "extract": return stageExtract(company);
    case "qualify": return stageQualify(company, run);
    case "research": return stageResearch(company, run);
    case "contact": return stageContact(company);
    case "painpoints": return stagePainPoints(company);
    case "draft": return stageDraft(company);
    default: return;
  }
}

/* ---------------- Stage 1 ---------------- */
async function stageScrape(c: CompanyRow) {
  let url = `https://${c.domain}`;
  let r = await fetchPage(url);
  if (!r.ok && (r.code === "NETWORK" || r.code === "TIMEOUT")) {
    url = `https://www.${c.domain}`;
    r = await fetchPage(url);
  }
  if (!r.ok) {
    await db.saveEvidence({ company_id: c.id, source_url: url, kind: "homepage", fetch_ok: false, fetch_error: `${r.code}: ${r.error}` });
    await db.logEvent({ company_id: c.id, type: "api_failure", stage: "scrape", message: `Homepage fetch failed: ${r.code} — ${r.error}` });
    throw new StageFailure(`Website scrape failed (${r.code}): ${r.error}`, REVIEW_CODES.includes(r.code!));
  }
  await db.saveEvidence({ company_id: c.id, source_url: r.finalUrl!, kind: "homepage", fetch_ok: true, content: r.text, links: r.links });
  await db.logEvent({ company_id: c.id, type: "research", stage: "scrape", message: `Fetched homepage (${r.text!.length} chars, ${r.links!.length} links)`, data: { url: r.finalUrl } });
  await db.updateRun(c.id, { stage: "extract" });
}

/* ---------------- Stage 2 ---------------- */
async function stageExtract(c: CompanyRow) {
  const home = (await db.listEvidence(c.id)).find((e) => e.kind === "homepage" && e.fetch_ok && e.content);
  if (!home) throw new StageFailure("No homepage content stored; re-run the scrape stage.");
  const facts = await extractFromPage({ url: home.source_url, text: home.content! });
  const profile = mergeProfile(c.domain, null, facts, home.source_url);
  await db.setEvidenceFacts(c.id, home.source_url, facts);
  await db.updateCompany(c.id, { profile, name: profile.company_name });
  await db.logEvent({ company_id: c.id, type: "research", stage: "extract", message: `Extracted profile; missing: ${profile.missing_fields.join(", ") || "none"}` });
  await db.updateRun(c.id, { stage: "qualify" });
}

/* ---------------- Stage 3 + research loop ---------------- */
async function applyVerdict(c: CompanyRow, verdict: Verdict, pagesFetched: number, stage: Stage) {
  const evidence = await db.listEvidence(c.id);
  const links = [...new Set(evidence.flatMap((e) => e.links ?? []))];
  const tried = evidence.map((e) => e.source_url);
  const missing = missingEvidence(verdict.criteria);

  await db.updateCompany(c.id, { icp_verdict: verdict, icp_status: verdict.decision, icp_reasoning: verdict.reasoning });
  await db.logEvent({ company_id: c.id, type: "qualification", stage, message: `${verdict.decision}: ${verdict.reasoning}`, data: { criteria: verdict.criteria, evidence: verdict.evidence, pagesFetched } });

  const next = decideNext({ verdict, pagesFetched, domain: c.domain, links, tried, missing });
  switch (next.action) {
    case "stop_disqualified":
      await db.updateCompany(c.id, { status: "DISQUALIFIED" });
      await db.updateRun(c.id, { stage: "done", finished: true });
      break;
    case "proceed_qualified":
      await db.updateCompany(c.id, { status: "QUALIFIED" });
      await db.updateRun(c.id, { stage: "contact" });
      break;
    case "fetch":
      await db.logEvent({ company_id: c.id, type: "research", stage, message: `Agent loop: ${next.reason} (fetch ${pagesFetched + 1}/${MAX_EXTRA_PAGES})`, data: { next: next.next.url } });
      await db.updateRun(c.id, { stage: "research" });
      break;
    case "manual_review":
      await finishReview(c.id, stage, next.reason, true);
      break;
  }
}

async function stageQualify(c: CompanyRow, run: RunRow) {
  if (!c.profile) throw new StageFailure("No profile stored; re-run extraction.");
  const verdict = await qualify(c.profile);
  await applyVerdict(c, verdict, run.pages_fetched, "qualify");
}

async function stageResearch(c: CompanyRow, run: RunRow) {
  if (!c.profile || !c.icp_verdict) throw new StageFailure("Research started without a profile/verdict.");
  if (run.pages_fetched >= MAX_EXTRA_PAGES) {
    await finishReview(c.id, "research", `Research limit reached (${MAX_EXTRA_PAGES} additional pages).`, true);
    return;
  }
  const evidence = await db.listEvidence(c.id);
  const links = [...new Set(evidence.flatMap((e) => e.links ?? []))];
  const next = chooseNextPage({ domain: c.domain, links, tried: evidence.map((e) => e.source_url), missing: missingEvidence(c.icp_verdict.criteria) });
  if (!next) {
    await finishReview(c.id, "research", "No further relevant pages to fetch; evidence remains insufficient.", true);
    return;
  }

  await db.updateRun(c.id, { addPages: 1 }); // every fetch attempt counts toward the limit, success or not
  const pagesFetched = run.pages_fetched + 1;
  const r = await fetchPage(next.url);
  if (!r.ok) {
    await db.saveEvidence({ company_id: c.id, source_url: next.url, kind: "page", fetch_ok: false, fetch_error: `${r.code}: ${r.error}` });
    await db.logEvent({ company_id: c.id, type: "api_failure", stage: "research", message: `Fetch ${pagesFetched}/${MAX_EXTRA_PAGES} failed for ${next.path}: ${r.code} — ${r.error}` });
    await applyVerdict(c, c.icp_verdict, pagesFetched, "research");
    return;
  }
  const finalUrl = r.finalUrl!;
  await db.saveEvidence({ company_id: c.id, source_url: finalUrl, kind: "page", fetch_ok: true, content: r.text, links: r.links });
  const facts = await extractFromPage({ url: finalUrl, text: r.text! });
  await db.setEvidenceFacts(c.id, finalUrl, facts);
  const profile: CompanyProfile = mergeProfile(c.domain, c.profile, facts, finalUrl);
  await db.updateCompany(c.id, { profile, name: profile.company_name });
  await db.logEvent({ company_id: c.id, type: "research", stage: "research", message: `Fetched ${next.path} (${pagesFetched}/${MAX_EXTRA_PAGES}); still missing: ${computeMissing(profile).join(", ") || "none"}`, data: { url: finalUrl } });

  const verdict = await qualify(profile);
  await applyVerdict({ ...c, profile }, verdict, pagesFetched, "research");
}

/* ---------------- Stage 4 ---------------- */
async function stageContact(c: CompanyRow) {
  const existing = await db.getContact(c.id);
  if (existing?.verification_status === "valid") {
    await db.updateRun(c.id, { stage: "painpoints" });
    return;
  }
  const emails = await domainSearch(c.domain);
  const { chosen, reason } = rankContacts(emails, c.domain);
  if (!chosen) {
    await db.logEvent({ company_id: c.id, type: "review", stage: "contact", message: reason, data: { candidates: emails.length } });
    throw new StageFailure(`No suitable verified contact. ${reason}`, true);
  }
  await db.saveContact({ company_id: c.id, name: chosen.name, title: chosen.title, email: chosen.email, source: "hunter.io", verification_status: chosen.verification_status, confidence: chosen.confidence, rank_reason: chosen.rank_reason });
  await db.logEvent({ company_id: c.id, type: "research", stage: "contact", message: `Selected contact: ${chosen.name}, ${chosen.title} (${chosen.rank_reason}, verification: ${chosen.verification_status})` });
  await db.updateRun(c.id, { stage: "painpoints" });
}

/* ---------------- Stage 5 ---------------- */
async function stagePainPoints(c: CompanyRow) {
  const contact = await db.getContact(c.id);
  if (!c.profile || !contact) throw new StageFailure("Missing profile or contact for pain points.");
  const pain = await generatePainPoints(c.profile, contact.title);
  await db.upsertOutreach(c.id, { contact_id: contact.id, pain_points: pain });
  await db.logEvent({ company_id: c.id, type: "draft", stage: "painpoints", message: `Pain points: ${pain.map((p) => `${p.title} [${p.kind}]`).join(" | ")}` });
  await db.updateRun(c.id, { stage: "draft" });
}

/* ---------------- Stage 6 ---------------- */
export async function evidencePages(companyId: number): Promise<EvidencePage[]> {
  return (await db.listEvidence(companyId)).filter((e) => e.fetch_ok && e.content).map((e) => ({ url: e.source_url, content: e.content! }));
}

async function stageDraft(c: CompanyRow) {
  const [contact, outreach] = await Promise.all([db.getContact(c.id), db.getOutreach(c.id)]);
  if (!c.profile || !contact || !outreach?.pain_points) throw new StageFailure("Missing inputs for drafting.");
  try {
    const draft = await generateEmail({
      profile: c.profile,
      pages: await evidencePages(c.id),
      painPoints: outreach.pain_points,
      contact: { firstName: contact.name.split(" ")[0], title: contact.title, email: contact.email },
    });
    await db.upsertOutreach(c.id, {
      subject: draft.subject,
      draft: draft.body,
      hook: draft.hook,
      draft_history: [{ at: new Date().toISOString(), by: "ai", subject: draft.subject, draft: draft.body }],
    });
    await db.updateCompany(c.id, { status: "DRAFT_READY" });
    await db.updateRun(c.id, { stage: "done", finished: true });
    await db.logEvent({ company_id: c.id, type: "draft", stage: "draft", message: `Draft ready for ${contact.name}: "${draft.subject}"` });
  } catch (e) {
    if (e instanceof DraftValidationError) throw new StageFailure(e.message, true);
    throw e;
  }
}

/* ---------------- retry / edit / revise ---------------- */
export async function retryCompany(id: number) {
  const c = await db.getCompany(id);
  if (!c) throw new Error("Company not found");
  if (c.status !== "FAILED") throw new Error("Only FAILED items can be retried");
  await db.updateCompany(id, { status: "RESEARCHING", review_reason: null });
  await db.updateRun(id, { unlock: true, clearFinished: true });
  await db.logEvent({ company_id: id, type: "research", message: "Retry requested by user" });
}

export class EditRejectedError extends Error {
  constructor(public issues: string[]) {
    super(issues.join("; "));
  }
}

async function assertEditable(id: number) {
  const o = await db.getOutreach(id);
  if (!o?.draft) throw new Error("No draft exists yet");
  if (o.send_status === "SENT" || o.send_status === "SENDING") throw new Error("Draft is locked: a test email was already sent");
  return o;
}

export async function saveHumanEdit(id: number, subject: string, body: string) {
  const o = await assertEditable(id);
  const [contact, pages] = await Promise.all([db.getContact(id), evidencePages(id)]);
  const issues = checkClaims(body, pages.map((p) => p.content).join("\n"), { contactEmail: contact?.email });
  if (issues.length) throw new EditRejectedError(issues);
  const history = [...o.draft_history, { at: new Date().toISOString(), by: "human" as const, subject, draft: body }];
  await db.upsertOutreach(id, { subject, draft: body, draft_history: history });
  await db.logEvent({ company_id: id, type: "draft", message: "Draft edited by human" });
}

export async function reviseWithAi(id: number, note: string) {
  const o = await assertEditable(id);
  if (o.revision_count >= 1) throw new Error("The one allowed AI revision has already been used");
  const [c, contact] = await Promise.all([db.getCompany(id), db.getContact(id)]);
  if (!c?.profile || !contact || !o.pain_points || !o.hook) throw new Error("Draft inputs missing");
  const draft = await generateEmail({
    profile: c.profile,
    pages: await evidencePages(id),
    painPoints: o.pain_points,
    contact: { firstName: contact.name.split(" ")[0], title: contact.title, email: contact.email },
    feedback: { previous: { subject: o.subject ?? "", body: o.draft!, hook: o.hook }, note },
  });
  const history = [...o.draft_history, { at: new Date().toISOString(), by: "ai-revision" as const, subject: draft.subject, draft: draft.body }];
  await db.upsertOutreach(id, { subject: draft.subject, draft: draft.body, hook: draft.hook, draft_history: history, revision_count: o.revision_count + 1 });
  await db.logEvent({ company_id: id, type: "draft", message: "AI revision applied", data: { note } });
}
