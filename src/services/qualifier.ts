import { z } from "zod";
import type { CompanyProfile, Fact, Verdict } from "@/lib/types";
import { geminiJson } from "./gemini";

export type Criterion = "met" | "unmet" | "unknown";
export type MissingEvidence = "saas_classification" | "compliance_need" | "growth_stage";

/** Deterministic, named-field criteria. Facts decide; Gemini never sets these alone. */
export function computeCriteria(p: CompanyProfile): Verdict["criteria"] {
  const b2b_saas: Criterion =
    p.is_saas === true && (p.business_model === "B2B" || p.business_model === "BOTH")
      ? "met"
      : p.is_saas === false || p.business_model === "B2C"
        ? "unmet"
        : "unknown";
  const growth_stage: Criterion =
    p.funding_stage || p.funding_signals.length || p.growth_signals.length ? "met" : "unknown";
  const compliance_need: Criterion =
    p.security_compliance_evidence.length || p.enterprise_signals.length ? "met" : "unknown";
  return { b2b_saas, growth_stage, compliance_need };
}

/** Deterministic completeness check: which ICP evidence is still missing? */
export function missingEvidence(c: Verdict["criteria"]): MissingEvidence[] {
  const m: MissingEvidence[] = [];
  if (c.b2b_saas === "unknown") m.push("saas_classification");
  if (c.compliance_need === "unknown") m.push("compliance_need");
  if (c.growth_stage === "unknown") m.push("growth_stage");
  return m;
}

function supportingFacts(p: CompanyProfile, c: Verdict["criteria"]): Fact[] {
  const out: Fact[] = [];
  const desc = p.product_description;
  if (desc && p.source_urls[0]) out.push({ fact: `Product: ${desc}`.slice(0, 400), source_url: p.source_urls[0] });
  if (c.compliance_need === "met") out.push(...[...p.security_compliance_evidence, ...p.enterprise_signals].slice(0, 2));
  if (c.growth_stage === "met") {
    if (p.funding_stage && p.source_urls[0]) out.push({ fact: `Funding stage: ${p.funding_stage}`, source_url: p.source_urls[0] });
    out.push(...[...p.funding_signals, ...p.growth_signals].slice(0, 2));
  }
  return out;
}

const GateSchema = z.object({
  agree_qualified: z.boolean(),
  growth_stage_in_icp: z.enum(["yes", "no", "unclear"]),
  reasoning: z.string().min(10).max(900),
});

/**
 * Pure verdict logic given the Gemini "second opinion" (null when Gemini wasn't needed).
 * Funding stage alone never qualifies: QUALIFIED needs B2B SaaS + compliance/enterprise pressure + growth evidence.
 */
export function buildVerdict(
  p: CompanyProfile,
  gate: z.infer<typeof GateSchema> | null,
): Verdict {
  const criteria = computeCriteria(p);
  const known = new Set(p.source_urls);
  const facts = supportingFacts(p, criteria).filter((f) => known.has(f.source_url));

  if (criteria.b2b_saas === "unmet") {
    return {
      decision: "DISQUALIFIED",
      reasoning: `Not a B2B SaaS company (business model: ${p.business_model ?? "unknown"}, SaaS: ${String(p.is_saas)}). ${p.product_description ?? ""}`.trim(),
      criteria,
      evidence: facts.slice(0, 3),
    };
  }

  const missing = missingEvidence(criteria);
  if (missing.length) {
    return {
      decision: "NEEDS_MORE_INFO",
      reasoning: `Insufficient evidence for: ${missing.join(", ")}.`,
      criteria,
      evidence: facts.slice(0, 3),
    };
  }

  // All three criteria have source-backed evidence → Gemini gives a second opinion and can veto.
  const growthOk = gate ? gate.growth_stage_in_icp !== "no" : true;
  if (criteria.b2b_saas === "met" && gate?.agree_qualified && growthOk && facts.length > 0) {
    return { decision: "QUALIFIED", reasoning: gate.reasoning, criteria, evidence: facts.slice(0, 5) };
  }
  return {
    decision: "NEEDS_MORE_INFO",
    reasoning: gate
      ? `Criteria have evidence but the review did not confirm a fit: ${gate.reasoning}`
      : "Criteria have evidence but no confirming review was obtained.",
    criteria: gate?.growth_stage_in_icp === "no" ? { ...criteria, growth_stage: "unmet" } : criteria,
    evidence: facts.slice(0, 3),
  };
}

export async function qualify(p: CompanyProfile): Promise<Verdict> {
  const criteria = computeCriteria(p);
  // Only call the model when deterministic checks say every criterion has evidence (cost control).
  if (criteria.b2b_saas !== "met" || missingEvidence(criteria).length) return buildVerdict(p, null);

  const brief = {
    company: p.company_name ?? p.domain,
    product: p.product_description,
    industry: p.industry,
    funding_stage: p.funding_stage,
    growth_signals: [...p.funding_signals, ...p.growth_signals].map((f) => f.fact),
    compliance_or_enterprise_signals: [...p.security_compliance_evidence, ...p.enterprise_signals].map((f) => f.fact),
  };
  const gate = await geminiJson({
    system:
      "You are a strict sales-qualification reviewer for Sprinto (compliance automation: SOC 2, ISO 27001, GDPR). Judge ONLY from the facts given; never add facts.",
    prompt: `ICP: B2B SaaS, typically Series A–C or with credible growth indicators, with evidence of compliance requirements, audit preparation or enterprise security pressure. Funding stage alone is NOT enough.
Facts:\n${JSON.stringify(brief, null, 1)}
Return JSON: {"agree_qualified": boolean, "growth_stage_in_icp": "yes"|"no"|"unclear", "reasoning": "2-3 sentences citing the facts"}`,
    schema: GateSchema,
    maxOutputTokens: 1500,
  });
  return buildVerdict(p, gate);
}
