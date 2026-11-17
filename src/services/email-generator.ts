import { EmailDraftSchema, type CompanyProfile, type EmailDraft, type PainPoint } from "@/lib/types";
import { geminiJson } from "./gemini";

export interface EvidencePage {
  url: string;
  content: string;
}

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Risky claim patterns: each matched token must literally exist in the stored evidence. */
const RISKY: { re: RegExp; label: string }[] = [
  { re: /\$\s?\d[\d,.]*\s?(?:k|m|b|million|billion)?/gi, label: "dollar amount" },
  { re: /\b\d[\d,.]*\s?(?:million|billion)\b/gi, label: "large number" },
  { re: /\bseries\s+[a-f]\b/gi, label: "funding round" },
  { re: /\b(?:raised|funding round|funded by|backed by)\b/gi, label: "funding claim" },
  { re: /\b(?:you(?:'re| are)\s+hiring|open (?:roles|positions)|job openings|we saw (?:that )?you(?:'re| are) hiring)\b/gi, label: "hiring claim" },
  { re: /\b(?:you|your)\b[^.!?]{0,60}\b(?:soc\s?2|iso\s?27001|hipaa|pci)\b[^.!?]{0,30}\b(?:certified|certification|compliant|attestation|report)\b/gi, label: "certification claim" },
];

/** Reject claims in `body` that the stored evidence cannot support. Returns human-readable issues. */
export function checkClaims(body: string, evidenceText: string, opts?: { contactEmail?: string }): string[] {
  const issues: string[] = [];
  const ev = squash(evidenceText);
  for (const { re, label } of RISKY) {
    for (const m of body.matchAll(re)) {
      const token = squash(m[0]);
      if (label === "certification claim") {
        const fw = m[0].match(/soc\s?2|iso\s?27001|hipaa|pci/i)?.[0] ?? "";
        if (!ev.includes(squash(fw))) issues.push(`Unsupported ${label}: "${m[0].trim()}"`);
      } else if (label === "hiring claim") {
        if (!/\b(hiring|careers|open roles|open positions|job openings|join our team)\b/.test(ev)) issues.push(`Unsupported ${label}: "${m[0].trim()}"`);
      } else if (!ev.includes(token)) {
        issues.push(`Unsupported ${label}: "${m[0].trim()}"`);
      }
    }
  }
  if (/@|https?:\/\//i.test(body)) issues.push("Body must not contain email addresses or links");
  if (/\[[^\]]*\]|\{\{|\}\}/.test(body)) issues.push("Body contains an unfilled placeholder");
  if (opts?.contactEmail && body.toLowerCase().includes(opts.contactEmail.toLowerCase())) issues.push("Body exposes the contact's email address");
  return issues;
}

export function validateDraft(
  d: EmailDraft,
  ctx: { contactFirstName: string; pages: EvidencePage[]; contactEmail?: string },
): string[] {
  const issues: string[] = [];
  const greet = new RegExp(`^\\s*(hi|hello|hey|dear)\\s+${ctx.contactFirstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  if (!greet.test(d.body)) issues.push(`Greeting must address the contact by first name (${ctx.contactFirstName})`);

  const wc = wordCount(d.body);
  if (wc < 110 || wc > 175) issues.push(`Body is ${wc} words; target is about 120–160`);

  const page = ctx.pages.find((p) => p.url === d.hook.source_url);
  if (!page) issues.push("Hook source_url is not one of the stored evidence pages");
  else if (!squash(page.content).includes(squash(d.hook.evidence_quote)))
    issues.push("Hook evidence_quote does not appear verbatim in the stored page content");

  const hookWords = [...new Set(squash(d.hook.text).split(" ").filter((w) => w.length > 4))];
  const bodySq = squash(d.body);
  if (hookWords.length && hookWords.filter((w) => bodySq.includes(w)).length / hookWords.length < 0.4)
    issues.push("The email body does not actually use the stated hook");

  issues.push(...checkClaims(d.body, ctx.pages.map((p) => p.content).join("\n"), { contactEmail: ctx.contactEmail }));
  return issues;
}

const SYSTEM = `You write short, human, specific B2B cold emails for Sprinto (compliance automation for SaaS: SOC 2, ISO 27001, GDPR).
Hard rules: use ONLY facts from the provided evidence. Never invent funding, customers, certifications, job openings, metrics or contact details. No emojis, no hype words ("revolutionize", "game-changing", "cutting-edge"), no links, no email addresses, no placeholders.
Hedge hypotheses ("I'd guess", "teams like yours often"); state verified facts plainly.`;

function brief(profile: CompanyProfile, pages: EvidencePage[], pain: PainPoint[], contact: { firstName: string; title: string }) {
  const facts = [
    ...profile.security_compliance_evidence,
    ...profile.enterprise_signals,
    ...profile.customer_signals,
    ...profile.growth_signals,
    ...profile.funding_signals,
  ]
    .slice(0, 12)
    .map((f) => `- ${f.fact} [${f.source_url}]`)
    .join("\n");
  return `Recipient: ${contact.firstName}, ${contact.title} at ${profile.company_name ?? profile.domain}
Company: ${profile.product_description}
Verified facts:
${facts || "- (none)"}
Pain points (kind says whether verified or hypothesis):
${pain.map((p, i) => `${i + 1}. [${p.kind}] ${p.title} — ${p.rationale}. Sprinto capability: ${p.sprinto_capability}`).join("\n")}
Evidence pages (urls): ${pages.map((p) => p.url).join(", ")}

Write the email body (about 120–160 words) in this order: greeting "Hi ${contact.firstName},"; ONE specific hook from the verified facts; the two pain points; a concise Sprinto value proposition using only the capabilities above; a low-pressure CTA question; sign-off "Best,\\nThe Sprinto team".
Return JSON: {"subject": string, "body": string, "hook": {"text": string (the hook as used in the email), "source_url": string (one of the evidence page urls), "evidence_quote": string (an EXACT 8-30 word excerpt copied verbatim from that page's text supporting the hook)}}`;
}

function pageExcerpts(pages: EvidencePage[]): string {
  return pages.map((p) => `### ${p.url}\n${p.content.slice(0, 3500)}`).join("\n\n");
}

export async function generateEmail(opts: {
  profile: CompanyProfile;
  pages: EvidencePage[];
  painPoints: PainPoint[];
  contact: { firstName: string; title: string; email: string };
  feedback?: { previous: EmailDraft; note: string };
}): Promise<EmailDraft> {
  let extra = opts.feedback
    ? `\n\nRevise this earlier draft per the reviewer note, keeping all rules.\nPrevious subject: ${opts.feedback.previous.subject}\nPrevious body:\n${opts.feedback.previous.body}\nReviewer note: ${opts.feedback.note}`
    : "";
  let issues: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const draft = await geminiJson({
      system: SYSTEM,
      prompt: `${brief(opts.profile, opts.pages, opts.painPoints, opts.contact)}${extra}\n\n--- PAGE TEXT (for the exact quote) ---\n${pageExcerpts(opts.pages)}`,
      schema: EmailDraftSchema,
      maxOutputTokens: 2500,
    });
    issues = validateDraft(draft, { contactFirstName: opts.contact.firstName, pages: opts.pages, contactEmail: opts.contact.email });
    if (!issues.length) return draft;
    extra += `\n\nYour previous attempt failed validation: ${issues.join("; ")}. Fix every issue.`;
  }
  throw new DraftValidationError(issues);
}

export class DraftValidationError extends Error {
  constructor(public issues: string[]) {
    super(`Draft failed factual validation: ${issues.join("; ")}`);
    this.name = "DraftValidationError";
  }
}
