import { z } from "zod";

export const COMPANY_STATUSES = [
  "PENDING",
  "RESEARCHING",
  "QUALIFIED",
  "DISQUALIFIED",
  "MANUAL_REVIEW",
  "DRAFT_READY",
  "SENT",
  "FAILED",
] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const STAGES = ["scrape", "extract", "qualify", "research", "contact", "painpoints", "draft", "done"] as const;
export type Stage = (typeof STAGES)[number];

export const MAX_EXTRA_PAGES = 4; // research loop limit beyond the homepage

/** A fact with the URL it came from — every signal must be source-backed. */
export const FactSchema = z.object({
  fact: z.string().min(3).max(400),
  source_url: z.string().url(),
});
export type Fact = z.infer<typeof FactSchema>;

/** Gemini extraction output. Unknown scalars must be null, never guessed. */
export const ExtractionSchema = z.object({
  company_name: z.string().nullable(),
  product_description: z.string().nullable(),
  business_model: z.enum(["B2B", "B2C", "BOTH"]).nullable(),
  is_saas: z.boolean().nullable(),
  industry: z.string().nullable(),
  funding_stage: z.string().nullable(),
  funding_signals: z.array(FactSchema),
  growth_signals: z.array(FactSchema),
  customer_signals: z.array(FactSchema),
  enterprise_signals: z.array(FactSchema),
  security_compliance_evidence: z.array(FactSchema),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export type CompanyProfile = Extraction & {
  domain: string;
  source_urls: string[];
  missing_fields: string[];
};

export const CriterionSchema = z.enum(["met", "unmet", "unknown"]);
export const VerdictSchema = z.object({
  decision: z.enum(["QUALIFIED", "DISQUALIFIED", "NEEDS_MORE_INFO"]),
  reasoning: z.string().min(10).max(1200),
  criteria: z.object({
    b2b_saas: CriterionSchema,
    growth_stage: CriterionSchema,
    compliance_need: CriterionSchema,
  }),
  evidence: z.array(FactSchema),
});
export type Verdict = z.infer<typeof VerdictSchema>;
export type IcpStatus = "QUALIFIED" | "DISQUALIFIED" | "NEEDS_MORE_INFO" | "MANUAL_REVIEW";

export const PainPointSchema = z.object({
  title: z.string().min(5).max(120),
  theme: z.enum([
    "audit_preparation",
    "enterprise_security_requirements",
    "manual_evidence_collection",
    "continuous_monitoring",
  ]),
  kind: z.enum(["verified", "hypothesis"]),
  rationale: z.string().min(10).max(500),
  evidence_url: z.string().url().nullable(),
  sprinto_capability: z.string().min(5).max(200),
});
export const PainPointsSchema = z.object({ pain_points: z.array(PainPointSchema).length(2) });
export type PainPoint = z.infer<typeof PainPointSchema>;

export const EmailDraftSchema = z.object({
  subject: z.string().min(5).max(120),
  body: z.string().min(200).max(1600),
  hook: z.object({
    text: z.string().min(5).max(300),
    source_url: z.string().url(),
    evidence_quote: z.string().min(8).max(300),
  }),
});
export type EmailDraft = z.infer<typeof EmailDraftSchema>;

export interface CompanyRow {
  id: number;
  domain: string;
  name: string | null;
  profile: CompanyProfile | null;
  icp_status: IcpStatus | null;
  icp_reasoning: string | null;
  icp_verdict: Verdict | null;
  status: CompanyStatus;
  review_reason: string | null;
  created_at: string;
  updated_at: string;
}
export interface EvidenceRow {
  id: number;
  company_id: number;
  source_url: string;
  kind: "homepage" | "page";
  fetch_ok: boolean;
  fetch_error: string | null;
  content: string | null;
  links: string[] | null;
  extracted_facts: Extraction | null;
  created_at: string;
}
export interface ContactRow {
  id: number;
  company_id: number;
  name: string;
  title: string;
  email: string;
  source: string;
  verification_status: string;
  confidence: number | null;
  rank_reason: string | null;
}
export interface OutreachRow {
  id: number;
  company_id: number;
  campaign: string;
  contact_id: number | null;
  pain_points: PainPoint[] | null;
  subject: string | null;
  draft: string | null;
  hook: EmailDraft["hook"] | null;
  draft_history: { at: string; by: "ai" | "human" | "ai-revision"; subject: string; draft: string }[];
  revision_count: number;
  send_status: "NOT_SENT" | "SENDING" | "SENT" | "FAILED";
  gmail_message_id: string | null;
  gmail_status: string | null;
  sent_to: string | null;
  sent_at: string | null;
  send_error: string | null;
}
export interface RunRow {
  id: number;
  company_id: number;
  current_stage: Stage;
  attempts: number;
  pages_fetched: number;
  duration_ms: number;
  errors: { at: string; stage: string; message: string }[];
  locked_until: string | null;
  started_at: string;
  finished_at: string | null;
}
export interface EventRow {
  id: number;
  company_id: number | null;
  type: string;
  stage: string | null;
  message: string;
  data: unknown;
  created_at: string;
  domain?: string | null;
}
