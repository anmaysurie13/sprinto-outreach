import { describe, expect, it } from "vitest";
import { normalizeDomain, parseDomainList } from "@/lib/domain";
import type { CompanyProfile, Verdict } from "@/lib/types";
import { rankContacts, type HunterEmail } from "@/services/hunter";
import { buildVerdict, computeCriteria } from "@/services/qualifier";
import { chooseNextPage, decideNext } from "@/services/research-agent";
import { cleanHtml, isPrivateIp } from "@/services/scraper";
import { validateDraft, checkClaims } from "@/services/email-generator";

const URL1 = "https://acme.io";
const f = (fact: string, source_url = URL1) => ({ fact, source_url });

function profile(over: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    domain: "acme.io",
    company_name: "Acme",
    product_description: "Acme sells workflow software to engineering teams.",
    business_model: "B2B",
    is_saas: true,
    industry: "Developer tools",
    funding_stage: null,
    funding_signals: [],
    growth_signals: [],
    customer_signals: [],
    enterprise_signals: [],
    security_compliance_evidence: [],
    source_urls: [URL1],
    missing_fields: [],
    ...over,
  };
}

describe("1. invalid domain", () => {
  it.each(["", "not a domain", "localhost", "127.0.0.1", "foo", "a@b.com", "-bad-.com", "x.c"])("rejects %j", (input) => {
    expect(normalizeDomain(input).ok).toBe(false);
  });
  it("normalises and dedupes", () => {
    expect(normalizeDomain("https://WWW.Fintech.com/pricing?x=1")).toEqual({ ok: true, domain: "fintech.com" });
    const r = parseDomainList("fintech.com, www.fintech.com\nsaas.io\nbad_domain");
    expect(r.domains).toEqual(["fintech.com", "saas.io"]);
    expect(r.rejected).toHaveLength(1);
  });
});

describe("2. non-SaaS company", () => {
  it("is DISQUALIFIED with source evidence and no model call needed", () => {
    const p = profile({ is_saas: false, business_model: "B2C", product_description: "We sell running shoes online." });
    const v = buildVerdict(p, null);
    expect(v.decision).toBe("DISQUALIFIED");
    expect(v.evidence.length).toBeGreaterThan(0);
    expect(v.evidence.every((e) => p.source_urls.includes(e.source_url))).toBe(true);
  });
});

describe("3. qualified SaaS company", () => {
  const p = profile({
    funding_stage: "Series B",
    security_compliance_evidence: [f("Preparing for SOC 2 Type II audit")],
  });
  it("needs all three criteria plus a confirming review", () => {
    expect(computeCriteria(p)).toEqual({ b2b_saas: "met", growth_stage: "met", compliance_need: "met" });
    const v = buildVerdict(p, { agree_qualified: true, growth_stage_in_icp: "yes", reasoning: "B2B SaaS, Series B, SOC 2 audit prep." });
    expect(v.decision).toBe("QUALIFIED");
    expect(v.evidence.length).toBeGreaterThan(0);
  });
  it("a model veto downgrades to NEEDS_MORE_INFO", () => {
    const v = buildVerdict(p, { agree_qualified: false, growth_stage_in_icp: "unclear", reasoning: "Not convincing enough." });
    expect(v.decision).toBe("NEEDS_MORE_INFO");
  });
  it("funding stage alone never qualifies", () => {
    const fundingOnly = profile({ funding_stage: "Series B" });
    expect(buildVerdict(fundingOnly, { agree_qualified: true, growth_stage_in_icp: "yes", reasoning: "Series B funding." }).decision).toBe("NEEDS_MORE_INFO");
  });
});

describe("4. insufficient evidence → research loop", () => {
  const p = profile({ funding_stage: "Series A" }); // compliance evidence missing
  const v = buildVerdict(p, null);
  it("is NEEDS_MORE_INFO and picks the discovered /security page first", () => {
    expect(v.decision).toBe("NEEDS_MORE_INFO");
    const d = decideNext({
      verdict: v, pagesFetched: 0, domain: "acme.io",
      links: ["https://acme.io/blog", "https://acme.io/security", "https://acme.io/careers"],
      tried: [URL1], missing: ["compliance_need"],
    });
    expect(d.action).toBe("fetch");
    if (d.action === "fetch") expect(d.next.url).toBe("https://acme.io/security");
  });
  it("keeps researching growth pages when the review finds growth stage unclear (regression)", () => {
    const strong = profile({ growth_signals: [f("Team of 60 people")], security_compliance_evidence: [f("SOC 2 Type 2 certified")] });
    const vetoed = buildVerdict(strong, { agree_qualified: false, growth_stage_in_icp: "unclear", reasoning: "No funding stage information." });
    expect(vetoed.decision).toBe("NEEDS_MORE_INFO");
    expect(vetoed.criteria.growth_stage).toBe("unknown");
    const d = decideNext({ verdict: vetoed, pagesFetched: 1, domain: "acme.io", links: ["https://acme.io/about"], tried: [URL1], missing: ["growth_stage"] });
    expect(d.action).toBe("fetch");
    if (d.action === "fetch") expect(d.next.url).toBe("https://acme.io/about");
  });
  it("never re-fetches a tried page", () => {
    const next = chooseNextPage({ domain: "acme.io", links: ["https://acme.io/security"], tried: ["https://acme.io/security/"], missing: ["compliance_need"] });
    expect(next?.url).not.toBe("https://acme.io/security");
  });
  it("stops immediately when disqualified", () => {
    const dq: Verdict = { ...v, decision: "DISQUALIFIED" };
    expect(decideNext({ verdict: dq, pagesFetched: 1, domain: "acme.io", links: [], tried: [], missing: [] }).action).toBe("stop_disqualified");
  });
});

describe("5. research limit reached", () => {
  it("unresolved cases become MANUAL_REVIEW at 4 additional pages", () => {
    const v = buildVerdict(profile(), null);
    const d = decideNext({ verdict: v, pagesFetched: 4, domain: "acme.io", links: ["https://acme.io/security"], tried: [URL1], missing: ["compliance_need", "growth_stage"] });
    expect(d.action).toBe("manual_review");
    expect(d.reason).toMatch(/limit/i);
  });
  it("still allows the 4th fetch", () => {
    const v = buildVerdict(profile(), null);
    expect(decideNext({ verdict: v, pagesFetched: 3, domain: "acme.io", links: [], tried: [URL1], missing: ["compliance_need"] }).action).toBe("fetch");
  });
});

describe("6. Hunter.io returns no verified contact", () => {
  const mk = (over: Partial<HunterEmail>): HunterEmail => ({
    value: "jane.doe@acme.io", type: "personal", confidence: 95, first_name: "Jane", last_name: "Doe",
    position: "Head of Security", verification: { status: "valid" }, ...over,
  });
  it("returns null when nothing is verified", () => {
    const r = rankContacts([mk({ verification: { status: "accept_all" } }), mk({ value: "x@other.com" }), mk({ first_name: "Info", last_name: "Team" })], "acme.io");
    expect(r.chosen).toBeNull();
    expect(r.reason).toMatch(/none qualified/);
  });
  it("returns null for an empty result", () => {
    expect(rankContacts([], "acme.io").chosen).toBeNull();
  });
  it("ranks CISO above CTO above CEO and requires valid status", () => {
    const r = rankContacts(
      [mk({ first_name: "Cee", last_name: "Eo", position: "CEO", value: "cee@acme.io" }), mk({ first_name: "Tee", last_name: "Cto", position: "CTO", value: "tee@acme.io" }), mk({ first_name: "Cis", last_name: "Oh", position: "CISO", value: "cis@acme.io" })],
      "acme.io",
    );
    expect(r.chosen?.name).toBe("Cis Oh");
  });
});

describe("7. unsupported email hook / claims", () => {
  const page = { url: "https://acme.io/security", content: "Acme is preparing for its first SOC 2 audit and runs a public trust center for enterprise buyers." };
  const body = (extra: string) =>
    `Hi Jane,\n\nI noticed Acme is preparing for its first SOC 2 audit. ${extra} Teams at that stage often spend weeks collecting screenshots and exports by hand, and enterprise buyers keep asking for proof of controls in security questionnaires before they sign. Sprinto automates evidence collection through integrations and monitors controls continuously, so audit preparation takes far less manual effort for your engineers. We help SaaS companies reach SOC 2, ISO 27001 and GDPR without slowing the roadmap. Would it be useful if I shared a short walkthrough of how that works for a team of your size? No pressure at all if the timing is wrong right now.\n\nBest,\nThe Sprinto team`;
  const draft = (b: string, quote = "preparing for its first SOC 2 audit") => ({
    subject: "SOC 2 prep at Acme",
    body: b,
    hook: { text: "Acme is preparing for its first SOC 2 audit", source_url: page.url, evidence_quote: quote },
  });
  const ctx = { contactFirstName: "Jane", pages: [page] };

  it("accepts a draft whose hook quote exists verbatim in stored evidence", () => {
    expect(validateDraft(draft(body("")), ctx)).toEqual([]);
  });
  it("rejects a hook quote that is not on the stored page", () => {
    const issues = validateDraft(draft(body(""), "recently closed a Series B round led by Sequoia"), ctx);
    expect(issues.join(" ")).toMatch(/verbatim/);
  });
  it("rejects invented funding / hiring claims", () => {
    expect(checkClaims("Congrats on raising $20M in your Series B!", page.content).length).toBeGreaterThanOrEqual(2);
    expect(checkClaims("I saw you're hiring a security engineer.", page.content).length).toBe(1);
  });
  it("rejects a hook from a page that was never stored", () => {
    const d = draft(body(""));
    d.hook.source_url = "https://acme.io/made-up";
    expect(validateDraft(d, ctx).join(" ")).toMatch(/not one of the stored/);
  });
  it("requires the contact's real first name in the greeting", () => {
    expect(validateDraft(draft(body("").replace("Hi Jane", "Hi there")), ctx).join(" ")).toMatch(/first name/);
  });
});

describe("scraper helpers", () => {
  it("blocks private addresses (SSRF)", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "172.20.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) expect(isPrivateIp(ip)).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });
  it("strips nav/footer/scripts, dedupes lines, keeps links", () => {
    const html = `<html><head><title>Acme</title></head><body><nav><a href="/security">Security</a></nav>
      <h1>Acme workflow</h1><p>We build software for teams.</p><p>We build software for teams.</p>
      <script>var x=1</script><footer>© Acme</footer></body></html>`;
    const r = cleanHtml(html, "https://acme.io");
    expect(r.text).toContain("We build software for teams.");
    expect(r.text.match(/We build software/g)).toHaveLength(1);
    expect(r.text).not.toMatch(/var x|©/);
    expect(r.links).toContain("https://acme.io/security");
  });
  it("detects bot challenges instead of treating them as content", () => {
    expect(cleanHtml("<html><body><h1>Just a moment...</h1><p>Verify you are human</p></body></html>", "https://x.com").blocked).toBe(true);
  });
});
