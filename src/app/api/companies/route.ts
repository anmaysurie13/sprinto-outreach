import { handle, json, readJson } from "@/lib/api";
import { parseDomainList } from "@/lib/domain";
import * as db from "@/services/database";

export const dynamic = "force-dynamic";

/** The dashboard is public (no login), so cap paid API usage: new companies per rolling 24h. */
const DAILY_COMPANY_LIMIT = 30;

export function GET(req: Request) {
  return handle(async () => {
    const sp = new URL(req.url).searchParams;
    const items = await db.listCompanies({ q: sp.get("q")?.slice(0, 100) || undefined, status: sp.get("status") || undefined });
    return json({ items });
  });
}

export function POST(req: Request) {
  return handle(async () => {
    const body = await readJson<{ domains?: string }>(req);
    if (typeof body.domains !== "string" || !body.domains.trim()) return json({ error: "Provide `domains` text" }, 400);
    const { domains, rejected } = parseDomainList(body.domains.slice(0, 20_000));
    if (domains.length > 25) return json({ error: "Max 25 domains per batch (cost control)" }, 400);
    const used = await db.countRecentCompanies();
    if (used + domains.length > DAILY_COMPANY_LIMIT)
      return json({ error: `Daily limit reached: ${used}/${DAILY_COMPANY_LIMIT} companies added in the last 24 hours (cost control). Try again later or with fewer domains.` }, 429);
    const accepted: { id: number; domain: string }[] = [];
    const existing: { id: number; domain: string; status: string }[] = [];
    for (const d of domains) {
      const { company, created } = await db.createCompany(d);
      if (created) {
        accepted.push({ id: company.id, domain: d });
        await db.logEvent({ company_id: company.id, type: "research", message: "Added to pipeline" });
      } else existing.push({ id: company.id, domain: d, status: company.status });
    }
    return json({ accepted, existing, rejected }, 201);
  });
}
