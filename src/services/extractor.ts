import { z } from "zod";
import type { CompanyProfile, Extraction, Fact } from "@/lib/types";
import { geminiJson } from "./gemini";

/** What Gemini returns: fact strings only. We attach the source URL ourselves (can't be hallucinated). */
const RawSchema = z.object({
  company_name: z.string().nullable(),
  product_description: z.string().nullable(),
  business_model: z.enum(["B2B", "B2C", "BOTH"]).nullable(),
  is_saas: z.boolean().nullable(),
  industry: z.string().nullable(),
  funding_stage: z.string().nullable(),
  funding_signals: z.array(z.string()),
  growth_signals: z.array(z.string()),
  customer_signals: z.array(z.string()),
  enterprise_signals: z.array(z.string()),
  security_compliance_evidence: z.array(z.string()),
});

const SYSTEM = `You extract structured facts about a company from ONE web page of its public website.
Rules: use ONLY information explicitly stated in the page text. If a value is not stated, use null (scalars) or [] (lists). Never guess, infer funding, or invent customers/certifications.
Facts must be short, self-contained sentences (max ~200 chars) paraphrasing what the page says.
Return JSON only.`;

const SHAPE = `{
 "company_name": string|null,
 "product_description": string|null  (1-2 sentences, what the company sells),
 "business_model": "B2B"|"B2C"|"BOTH"|null  (who the customers are),
 "is_saas": boolean|null  (true only if it sells a software product delivered online/subscription),
 "industry": string|null,
 "funding_stage": string|null  (only if explicitly stated, e.g. "Series B"),
 "funding_signals": string[]  (explicit funding/investor statements),
 "growth_signals": string[]  (hiring, expansion, user/revenue milestones explicitly stated),
 "customer_signals": string[]  (named customers, customer counts, case studies),
 "enterprise_signals": string[]  (enterprise customers/plans, SSO, security questionnaires, procurement, regulated customers),
 "security_compliance_evidence": string[]  (SOC 2, ISO 27001, GDPR, HIPAA, audits, trust center, pen-tests, compliance needs/mentions)
}`;

const toFacts = (items: string[], url: string): Fact[] =>
  items
    .map((s) => s.trim())
    .filter((s) => s.length >= 3)
    .slice(0, 8)
    .map((fact) => ({ fact: fact.slice(0, 400), source_url: url }));

export async function extractFromPage(page: { url: string; text: string }): Promise<Extraction> {
  const raw = await geminiJson({
    system: SYSTEM,
    prompt: `Page URL: ${page.url}\n\nReturn JSON with this shape:\n${SHAPE}\n\n--- PAGE TEXT ---\n${page.text}`,
    schema: RawSchema,
    maxOutputTokens: 3000,
  });
  return {
    company_name: raw.company_name?.trim() || null,
    product_description: raw.product_description?.trim() || null,
    business_model: raw.business_model,
    is_saas: raw.is_saas,
    industry: raw.industry?.trim() || null,
    funding_stage: raw.funding_stage?.trim() || null,
    funding_signals: toFacts(raw.funding_signals, page.url),
    growth_signals: toFacts(raw.growth_signals, page.url),
    customer_signals: toFacts(raw.customer_signals, page.url),
    enterprise_signals: toFacts(raw.enterprise_signals, page.url),
    security_compliance_evidence: toFacts(raw.security_compliance_evidence, page.url),
  };
}

const FACT_KEYS = [
  "funding_signals",
  "growth_signals",
  "customer_signals",
  "enterprise_signals",
  "security_compliance_evidence",
] as const;

export function computeMissing(p: Omit<CompanyProfile, "missing_fields">): string[] {
  const m: string[] = [];
  if (!p.company_name) m.push("company_name");
  if (!p.product_description) m.push("product_description");
  if (!p.business_model) m.push("business_model");
  if (p.is_saas === null) m.push("is_saas");
  if (!p.industry) m.push("industry");
  if (!p.funding_stage && !p.funding_signals.length && !p.growth_signals.length) m.push("funding_or_growth_signals");
  if (!p.customer_signals.length) m.push("customer_signals");
  if (!p.security_compliance_evidence.length && !p.enterprise_signals.length) m.push("security_compliance_evidence");
  return m;
}

/** Deterministically merge a new page's extraction into the stored profile (first non-null scalar wins). */
export function mergeProfile(domain: string, existing: CompanyProfile | null, add: Extraction, sourceUrl: string): CompanyProfile {
  const base: Omit<CompanyProfile, "missing_fields"> = {
    domain,
    company_name: existing?.company_name ?? add.company_name,
    product_description: existing?.product_description ?? add.product_description,
    business_model: existing?.business_model ?? add.business_model,
    is_saas: existing?.is_saas ?? add.is_saas,
    industry: existing?.industry ?? add.industry,
    funding_stage: existing?.funding_stage ?? add.funding_stage,
    funding_signals: [],
    growth_signals: [],
    customer_signals: [],
    enterprise_signals: [],
    security_compliance_evidence: [],
    source_urls: [...new Set([...(existing?.source_urls ?? []), sourceUrl])],
  };
  for (const k of FACT_KEYS) {
    const seen = new Set<string>();
    base[k] = [...(existing?.[k] ?? []), ...add[k]].filter((f) => {
      const key = f.fact.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return { ...base, missing_fields: computeMissing(base) };
}
