import { neon } from "@neondatabase/serverless";
import { requireEnv } from "@/lib/env";
import type {
  CompanyRow,
  CompanyStatus,
  ContactRow,
  EventRow,
  EvidenceRow,
  OutreachRow,
  RunRow,
  Stage,
} from "@/lib/types";

type Sql = ReturnType<typeof neon>;
let _sql: Sql | null = null;

function sql(): Sql {
  if (!_sql) _sql = neon(requireEnv("DATABASE_URL"));
  return _sql;
}

async function q<T>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await sql().query(text, params)) as T[];
}
async function one<T>(text: string, params: unknown[] = []): Promise<T | null> {
  return (await q<T>(text, params))[0] ?? null;
}

/** Build "col = $n" fragments from a whitelisted patch. JSON columns are stringified. */
function patchSql(patch: Record<string, unknown>, allowed: readonly string[], jsonCols: readonly string[] = []) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.includes(k) || v === undefined) continue;
    vals.push(jsonCols.includes(k) && v !== null ? JSON.stringify(v) : v);
    sets.push(`${k} = $${vals.length}${jsonCols.includes(k) ? "::jsonb" : ""}`);
  }
  return { sets, vals };
}

/* ---------------- companies ---------------- */
const COMPANY_COLS = ["name", "profile", "icp_status", "icp_reasoning", "icp_verdict", "status", "review_reason"] as const;

export async function createCompany(domain: string): Promise<{ company: CompanyRow; created: boolean }> {
  const inserted = await one<CompanyRow>(
    "INSERT INTO companies(domain) VALUES ($1) ON CONFLICT (domain) DO NOTHING RETURNING *",
    [domain],
  );
  if (inserted) {
    await q("INSERT INTO runs(company_id) VALUES ($1) ON CONFLICT DO NOTHING", [inserted.id]);
    return { company: inserted, created: true };
  }
  return { company: (await one<CompanyRow>("SELECT * FROM companies WHERE domain=$1", [domain]))!, created: false };
}

export const getCompany = (id: number) => one<CompanyRow>("SELECT * FROM companies WHERE id=$1", [id]);

export async function updateCompany(id: number, patch: Partial<Record<(typeof COMPANY_COLS)[number], unknown>>) {
  const { sets, vals } = patchSql(patch, COMPANY_COLS, ["profile", "icp_verdict"]);
  if (!sets.length) return;
  vals.push(id);
  await q(`UPDATE companies SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length}`, vals);
}

export interface PipelineListItem extends CompanyRow {
  contact_name: string | null;
  contact_title: string | null;
  contact_status: string | null;
  current_stage: Stage | null;
  send_status: string | null;
}

export function listCompanies(opts: { q?: string; status?: string } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.q) {
    params.push(`%${opts.q.toLowerCase()}%`);
    where.push(`(lower(c.domain) LIKE $${params.length} OR lower(coalesce(c.name,'')) LIKE $${params.length})`);
  }
  if (opts.status) {
    params.push(opts.status);
    where.push(`c.status = $${params.length}`);
  }
  return q<PipelineListItem>(
    `SELECT c.id, c.domain, c.name, c.icp_status, c.icp_reasoning, c.status, c.review_reason, c.created_at, c.updated_at,
            ct.name AS contact_name, ct.title AS contact_title, ct.verification_status AS contact_status,
            r.current_stage, o.send_status
       FROM companies c
       LEFT JOIN LATERAL (SELECT * FROM contacts WHERE company_id = c.id ORDER BY id LIMIT 1) ct ON TRUE
       LEFT JOIN runs r ON r.company_id = c.id
       LEFT JOIN outreach o ON o.company_id = c.id AND o.campaign = 'default'
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY c.created_at DESC LIMIT 500`,
    params,
  );
}

/* ---------------- evidence ---------------- */
export async function saveEvidence(e: {
  company_id: number;
  source_url: string;
  kind: "homepage" | "page";
  fetch_ok: boolean;
  fetch_error?: string | null;
  content?: string | null;
  links?: string[] | null;
  extracted_facts?: unknown;
}) {
  await q(
    `INSERT INTO evidence(company_id, source_url, kind, fetch_ok, fetch_error, content, links, extracted_facts)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
     ON CONFLICT (company_id, source_url) DO UPDATE SET
       fetch_ok = EXCLUDED.fetch_ok, fetch_error = EXCLUDED.fetch_error, content = EXCLUDED.content,
       links = EXCLUDED.links, extracted_facts = coalesce(EXCLUDED.extracted_facts, evidence.extracted_facts),
       created_at = now()`,
    [
      e.company_id,
      e.source_url,
      e.kind,
      e.fetch_ok,
      e.fetch_error ?? null,
      e.content ?? null,
      e.links ? JSON.stringify(e.links) : null,
      e.extracted_facts ? JSON.stringify(e.extracted_facts) : null,
    ],
  );
}

export const setEvidenceFacts = (companyId: number, url: string, facts: unknown) =>
  q("UPDATE evidence SET extracted_facts=$3::jsonb WHERE company_id=$1 AND source_url=$2", [
    companyId,
    url,
    JSON.stringify(facts),
  ]);

export const listEvidence = (companyId: number) =>
  q<EvidenceRow>("SELECT * FROM evidence WHERE company_id=$1 ORDER BY (kind='homepage') DESC, id", [companyId]);

/* ---------------- contacts ---------------- */
export async function saveContact(c: Omit<ContactRow, "id">) {
  return one<ContactRow>(
    `INSERT INTO contacts(company_id, name, title, email, source, verification_status, confidence, rank_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (company_id, email) DO UPDATE SET name=EXCLUDED.name, title=EXCLUDED.title,
       verification_status=EXCLUDED.verification_status, confidence=EXCLUDED.confidence, rank_reason=EXCLUDED.rank_reason
     RETURNING *`,
    [c.company_id, c.name, c.title, c.email, c.source, c.verification_status, c.confidence, c.rank_reason],
  );
}
export const getContact = (companyId: number) =>
  one<ContactRow>("SELECT * FROM contacts WHERE company_id=$1 ORDER BY id LIMIT 1", [companyId]);

/* ---------------- outreach ---------------- */
export const getOutreach = (companyId: number, campaign = "default") =>
  one<OutreachRow>("SELECT * FROM outreach WHERE company_id=$1 AND campaign=$2", [companyId, campaign]);

const OUTREACH_COLS = ["contact_id", "pain_points", "subject", "draft", "hook", "draft_history", "revision_count"] as const;
export async function upsertOutreach(companyId: number, patch: Partial<Record<(typeof OUTREACH_COLS)[number], unknown>>) {
  await q("INSERT INTO outreach(company_id) VALUES ($1) ON CONFLICT (company_id, campaign) DO NOTHING", [companyId]);
  const { sets, vals } = patchSql(patch, OUTREACH_COLS, ["pain_points", "hook", "draft_history"]);
  if (!sets.length) return;
  vals.push(companyId);
  await q(
    `UPDATE outreach SET ${sets.join(", ")}, updated_at = now() WHERE company_id = $${vals.length} AND campaign = 'default'`,
    vals,
  );
}

/** Atomically claim the single send slot. Returns null if already SENDING/SENT (duplicate). */
export const claimSend = (companyId: number) =>
  one<OutreachRow>(
    `UPDATE outreach SET send_status='SENDING', send_error=NULL, updated_at=now()
      WHERE company_id=$1 AND campaign='default' AND send_status IN ('NOT_SENT','FAILED') AND draft IS NOT NULL
      RETURNING *`,
    [companyId],
  );

export const markSent = (companyId: number, messageId: string, to: string, gmailStatus: string) =>
  q(
    `UPDATE outreach SET send_status='SENT', gmail_message_id=$2, sent_to=$3, gmail_status=$4, sent_at=now(), updated_at=now()
      WHERE company_id=$1 AND campaign='default'`,
    [companyId, messageId, to, gmailStatus],
  );

export const markSendFailed = (companyId: number, error: string) =>
  q(
    `UPDATE outreach SET send_status='FAILED', send_error=$2, gmail_status='FAILED', updated_at=now()
      WHERE company_id=$1 AND campaign='default'`,
    [companyId, error.slice(0, 500)],
  );

/* ---------------- runs ---------------- */
export const getRun = (companyId: number) => one<RunRow>("SELECT * FROM runs WHERE company_id=$1", [companyId]);

/** Acquire a short processing lock so two requests never run the same company concurrently. */
export const lockRun = (companyId: number, seconds = 90) =>
  one<RunRow>(
    `UPDATE runs SET locked_until = now() + ($2 || ' seconds')::interval, updated_at=now()
      WHERE company_id=$1 AND (locked_until IS NULL OR locked_until < now()) RETURNING *`,
    [companyId, String(seconds)],
  );

export async function updateRun(
  companyId: number,
  p: { stage?: Stage; addAttempt?: boolean; addPages?: number; addMs?: number; error?: { stage: string; message: string }; unlock?: boolean; finished?: boolean; clearFinished?: boolean },
) {
  const sets: string[] = ["updated_at = now()"];
  const vals: unknown[] = [companyId];
  if (p.stage) {
    vals.push(p.stage);
    sets.push(`current_stage = $${vals.length}`);
  }
  if (p.addAttempt) sets.push("attempts = attempts + 1");
  if (p.addPages) {
    vals.push(p.addPages);
    sets.push(`pages_fetched = pages_fetched + $${vals.length}`);
  }
  if (p.addMs) {
    vals.push(Math.round(p.addMs));
    sets.push(`duration_ms = duration_ms + $${vals.length}`);
  }
  if (p.error) {
    vals.push(JSON.stringify({ at: new Date().toISOString(), ...p.error }));
    sets.push(`errors = errors || jsonb_build_array($${vals.length}::jsonb)`);
  }
  if (p.unlock) sets.push("locked_until = NULL");
  if (p.finished) sets.push("finished_at = now()");
  if (p.clearFinished) sets.push("finished_at = NULL");
  await q(`UPDATE runs SET ${sets.join(", ")} WHERE company_id = $1`, vals);
}

/* ---------------- events / logs ---------------- */
export async function logEvent(e: { company_id?: number | null; type: string; stage?: string; message: string; data?: unknown }) {
  try {
    await q("INSERT INTO events(company_id, type, stage, message, data) VALUES ($1,$2,$3,$4,$5::jsonb)", [
      e.company_id ?? null,
      e.type,
      e.stage ?? null,
      e.message.slice(0, 1000),
      e.data === undefined ? null : JSON.stringify(e.data),
    ]);
  } catch (err) {
    console.error("logEvent failed:", err instanceof Error ? err.message : err);
  }
}

export const listEvents = (opts: { companyId?: number; type?: string; limit?: number } = {}) => {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.companyId) {
    params.push(opts.companyId);
    where.push(`e.company_id = $${params.length}`);
  }
  if (opts.type) {
    params.push(opts.type);
    where.push(`e.type = $${params.length}`);
  }
  params.push(Math.min(opts.limit ?? 200, 500));
  return q<EventRow>(
    `SELECT e.*, c.domain FROM events e LEFT JOIN companies c ON c.id = e.company_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY e.created_at DESC, e.id DESC LIMIT $${params.length}`,
    params,
  );
};

/* ---------------- stats ---------------- */
export async function getStats() {
  const row = await one<Record<string, string | null>>(
    `SELECT
       (SELECT count(*) FROM companies) AS total,
       (SELECT count(*) FROM companies WHERE icp_status='QUALIFIED') AS qualified,
       (SELECT count(*) FROM contacts WHERE verification_status='valid') AS contacts_verified,
       (SELECT count(*) FROM companies WHERE status IN ('DRAFT_READY','SENT')) AS drafts_ready,
       (SELECT count(*) FROM outreach WHERE send_status='SENT') AS sent,
       (SELECT avg(duration_ms) FROM runs WHERE finished_at IS NOT NULL) AS avg_ms,
       (SELECT count(*) FROM runs WHERE finished_at IS NOT NULL) AS finished_runs`,
  );
  const byStatus = await q<{ status: CompanyStatus; n: string }>("SELECT status, count(*) AS n FROM companies GROUP BY status");
  return {
    total: Number(row?.total ?? 0),
    qualified: Number(row?.qualified ?? 0),
    contactsVerified: Number(row?.contacts_verified ?? 0),
    draftsReady: Number(row?.drafts_ready ?? 0),
    sent: Number(row?.sent ?? 0),
    avgProcessingMs: row?.avg_ms != null ? Number(row.avg_ms) : null,
    finishedRuns: Number(row?.finished_runs ?? 0),
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])),
  };
}

/** Companies added in the last 24h — used for the public-URL cost cap. */
export async function countRecentCompanies(): Promise<number> {
  const r = await one<{ n: string }>("SELECT count(*) AS n FROM companies WHERE created_at > now() - interval '24 hours'");
  return Number(r?.n ?? 0);
}

export async function ping(): Promise<boolean> {
  await q("SELECT 1");
  return true;
}
