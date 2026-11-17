import { z } from "zod";
import { PainPointSchema, type CompanyProfile, type PainPoint } from "@/lib/types";
import { geminiJson } from "./gemini";

/**
 * Approved Sprinto capability statements. Pain points may only map to these, so the
 * email can't make unsupported product claims. Growth Lead should review/extend this list.
 */
export const SPRINTO_CAPABILITIES = [
  "Automated evidence collection through integrations with the company's existing cloud and SaaS tools",
  "Continuous control monitoring that flags compliance gaps as they appear",
  "Guided audit-readiness workflows and auditor collaboration for SOC 2 and ISO 27001",
  "Support for SOC 2, ISO 27001 and GDPR in one platform",
] as const;

export function buildPainPointSchema(knownUrls: string[]) {
  const urls = new Set(knownUrls);
  return z
    .object({ pain_points: z.array(PainPointSchema).length(2) })
    .superRefine((v, ctx) => {
      if (new Set(v.pain_points.map((p) => p.theme)).size !== 2)
        ctx.addIssue({ code: "custom", message: "The two pain points must use two different themes" });
      v.pain_points.forEach((p, i) => {
        if (p.kind === "verified" && (!p.evidence_url || !urls.has(p.evidence_url)))
          ctx.addIssue({ code: "custom", path: ["pain_points", i, "evidence_url"], message: "verified pain points need an evidence_url from the provided sources" });
        if (p.evidence_url && !urls.has(p.evidence_url))
          ctx.addIssue({ code: "custom", path: ["pain_points", i, "evidence_url"], message: "evidence_url must be one of the provided sources" });
        if (!(SPRINTO_CAPABILITIES as readonly string[]).includes(p.sprinto_capability))
          ctx.addIssue({ code: "custom", path: ["pain_points", i, "sprinto_capability"], message: "sprinto_capability must be copied exactly from the approved list" });
      });
    });
}

export async function generatePainPoints(profile: CompanyProfile, contactTitle: string): Promise<PainPoint[]> {
  const facts = [
    ...profile.security_compliance_evidence,
    ...profile.enterprise_signals,
    ...profile.customer_signals,
    ...profile.growth_signals,
    ...profile.funding_signals,
  ];
  const schema = buildPainPointSchema(profile.source_urls);
  const out = await geminiJson({
    system:
      "You are a B2B sales researcher for Sprinto (compliance automation). Produce exactly TWO distinct, specific pain points for the prospect's company and role. Distinguish what the evidence verifies from what is only a likely hypothesis. Never invent facts.",
    prompt: `Company: ${profile.company_name ?? profile.domain} (${profile.domain})
Product: ${profile.product_description}
Contact role: ${contactTitle}
Evidence facts (each with its URL):
${facts.map((f) => `- ${f.fact} [${f.source_url}]`).join("\n") || "- (none)"}
Source URLs: ${profile.source_urls.join(", ")}

Themes (pick two different): audit_preparation, enterprise_security_requirements, manual_evidence_collection, continuous_monitoring.
Approved Sprinto capabilities (copy ONE per pain point EXACTLY):
${SPRINTO_CAPABILITIES.map((c) => `- ${c}`).join("\n")}

Return JSON: {"pain_points":[{"title":string,"theme":string,"kind":"verified"|"hypothesis","rationale":string(1-2 sentences),"evidence_url":string|null,"sprinto_capability":string}, {...}]}
Use kind "verified" only when a listed fact directly shows the pressure (set evidence_url to that fact's URL); otherwise "hypothesis" with evidence_url null.`,
    schema,
    maxOutputTokens: 2000,
  });
  return out.pain_points;
}
