import { requireEnv } from "@/lib/env";

export interface HunterEmail {
  value: string;
  type?: string | null;
  confidence?: number | null;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  verification?: { status?: string | null } | null;
}

export class HunterError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "HunterError";
  }
}

/** One Domain Search call per company (cost control). API key is sent as a header, never in the URL. */
export async function domainSearch(domain: string): Promise<HunterEmail[]> {
  const url = new URL("https://api.hunter.io/v2/domain-search");
  url.searchParams.set("domain", domain);
  url.searchParams.set("limit", "10");
  url.searchParams.set("type", "personal");
  url.searchParams.set("department", "executive,it,management,legal,operations");
  const key = requireEnv("HUNTER_API_KEY");

  let lastStatus: number | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "X-API-KEY": key }, signal: AbortSignal.timeout(15_000) });
      lastStatus = res.status;
      if (res.status >= 500) continue;
      if (res.status === 401) throw new HunterError("Hunter.io rejected the API key (401)", 401);
      if (res.status === 429) throw new HunterError("Hunter.io rate limit or quota exhausted (429)", 429);
      if (!res.ok) throw new HunterError(`Hunter.io error (HTTP ${res.status})`, res.status);
      const json = (await res.json()) as { data?: { emails?: HunterEmail[] } };
      return json.data?.emails ?? [];
    } catch (e) {
      if (e instanceof HunterError) throw e;
      if (attempt === 1) throw new HunterError(`Hunter.io unreachable (${e instanceof Error ? e.name : "error"})`);
    }
  }
  throw new HunterError(`Hunter.io server error (HTTP ${lastStatus})`, lastStatus);
}

/* ---------- ranking + verification (pure; tested) ---------- */
const TIERS: { tier: number; label: string; re: RegExp }[] = [
  {
    tier: 1,
    label: "CISO / Head of Security",
    re: /\b(ciso|chief information security|chief security|head of (information |cyber ?)?security|vp,? (of )?(information |cyber ?)?security|vice president,? (of )?(information |cyber ?)?security|director,? (of )?(information |cyber ?)?security|security (lead|director|officer))\b/i,
  },
  {
    tier: 2,
    label: "Compliance / GRC leader",
    re: /\b(head|director|vp|vice president|chief|lead|manager|officer)\b.*\b(compliance|grc|governance|risk|privacy|trust)\b|\b(compliance|grc|governance|risk|privacy)\b.*\b(head|director|vp|vice president|chief|lead|manager|officer)\b/i,
  },
  {
    tier: 3,
    label: "CTO / VP Engineering",
    re: /\b(cto|chief technology officer|vp,? (of )?engineering|vice president,? (of )?engineering|head of engineering|director,? (of )?engineering)\b/i,
  },
  { tier: 4, label: "Founder / CEO", re: /\b(founder|co-?founder|ceo|chief executive)\b/i },
];

const GENERIC_NAMES = new Set(["info", "support", "admin", "team", "sales", "hello", "contact", "security", "noreply", "no-reply", "help", "office", "press", "hr", "jobs", "careers", "legal", "privacy"]);
const NAME_RE = /^[\p{L}][\p{L}'’.-]*$/u;

export interface RankedContact {
  name: string;
  title: string;
  email: string;
  verification_status: string;
  confidence: number | null;
  rank_reason: string;
  tier: number;
}

export function domainMatches(email: string, domain: string): boolean {
  const host = email.split("@")[1]?.toLowerCase();
  return !!host && (host === domain || host.endsWith("." + domain));
}

export function isRealName(first?: string | null, last?: string | null): boolean {
  if (!first || !last) return false;
  const f = first.trim(), l = last.trim();
  return f.length >= 2 && l.length >= 2 && NAME_RE.test(f) && NAME_RE.test(l) && !GENERIC_NAMES.has(f.toLowerCase()) && !GENERIC_NAMES.has(l.toLowerCase());
}

export function rankContacts(emails: HunterEmail[], domain: string): { chosen: RankedContact | null; reason: string } {
  const valid: RankedContact[] = [];
  const rejections: string[] = [];
  for (const e of emails) {
    if (!isRealName(e.first_name, e.last_name)) { rejections.push("no real name"); continue; }
    if (!e.position?.trim()) { rejections.push("no job title"); continue; }
    if (!e.value || !domainMatches(e.value, domain)) { rejections.push("email not on company domain"); continue; }
    const tier = TIERS.find((t) => t.re.test(e.position!));
    if (!tier) { rejections.push("title not relevant"); continue; }
    const status = e.verification?.status ?? "unknown";
    if (status !== "valid") { rejections.push(`email not verified (${status})`); continue; }
    valid.push({
      name: `${e.first_name!.trim()} ${e.last_name!.trim()}`,
      title: e.position.trim(),
      email: e.value.toLowerCase(),
      verification_status: status,
      confidence: e.confidence ?? null,
      rank_reason: `Tier ${tier.tier}: ${tier.label}`,
      tier: tier.tier,
    });
  }
  valid.sort((a, b) => a.tier - b.tier || (b.confidence ?? 0) - (a.confidence ?? 0));
  if (valid[0]) return { chosen: valid[0], reason: valid[0].rank_reason };
  const summary = [...new Set(rejections)].join(", ");
  return {
    chosen: null,
    reason: emails.length
      ? `Hunter.io returned ${emails.length} contact(s) but none qualified (${summary}).`
      : "Hunter.io returned no contacts for this domain.",
  };
}
