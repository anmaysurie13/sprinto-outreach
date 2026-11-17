import { testEmail } from "@/lib/env";
import type { CompanyRow, ContactRow, EvidenceRow, OutreachRow } from "@/lib/types";
import * as db from "./database";
import { checkClaims } from "./email-generator";
import { composeTestMessage, mailProvider, sendToTestInbox } from "./gmail";

export class SendBlockedError extends Error {
  constructor(message: string, public httpStatus = 409) {
    super(message);
    this.name = "SendBlockedError";
  }
}

export interface SendDeps {
  getCompany(id: number): Promise<CompanyRow | null>;
  getContact(id: number): Promise<ContactRow | null>;
  getOutreach(id: number): Promise<OutreachRow | null>;
  listEvidence(id: number): Promise<EvidenceRow[]>;
  claimSend(id: number): Promise<OutreachRow | null>;
  markSent(id: number, messageId: string, to: string, gmailStatus: string): Promise<unknown>;
  markSendFailed(id: number, error: string): Promise<unknown>;
  updateCompany(id: number, patch: { status: CompanyRow["status"] }): Promise<unknown>;
  logEvent(e: { company_id: number; type: string; message: string; data?: unknown }): Promise<unknown>;
  send(subject: string, body: string, idempotencyKey?: string): Promise<{ messageId: string }>;
  approvedEmail(): string;
  providerName(): string;
}

export const defaultSendDeps: SendDeps = {
  ...db,
  send: sendToTestInbox,
  approvedEmail: testEmail,
  providerName: mailProvider,
};

/**
 * Send ONE test email to TEST_EMAIL. Never to the prospect.
 * Order matters: confirmation → state/claim validation → atomic duplicate lock → send → log.
 */
export async function sendTest(companyId: number, confirmed: boolean, deps: SendDeps = defaultSendDeps) {
  if (confirmed !== true) throw new SendBlockedError("Explicit confirmation is required before every test send.", 400);

  const company = await deps.getCompany(companyId);
  if (!company) throw new SendBlockedError("Company not found", 404);
  if (company.status === "SENT") throw new SendBlockedError("Duplicate blocked: a test email was already sent for this company/campaign.");
  if (company.status !== "DRAFT_READY") throw new SendBlockedError(`Company is ${company.status}; only DRAFT_READY drafts can be test-sent.`);

  const [contact, outreach, evidence] = await Promise.all([deps.getContact(companyId), deps.getOutreach(companyId), deps.listEvidence(companyId)]);
  if (!contact || !outreach?.draft || !outreach.subject) throw new SendBlockedError("No complete draft/contact to send.");

  const evidenceText = evidence.filter((e) => e.fetch_ok && e.content).map((e) => e.content).join("\n");
  const issues = checkClaims(outreach.draft, evidenceText, { contactEmail: contact.email });
  if (issues.length) throw new SendBlockedError(`Draft contains unsupported claims: ${issues.join("; ")}`, 422);

  const claimed = await deps.claimSend(companyId); // atomic: NOT_SENT|FAILED → SENDING, else null
  if (!claimed) throw new SendBlockedError("Duplicate blocked: this draft is already sending or was already sent.");

  const msg = composeTestMessage({
    subject: outreach.subject,
    draft: outreach.draft,
    prospectName: contact.name,
    prospectTitle: contact.title,
    domain: company.domain,
  });
  try {
    const { messageId } = await deps.send(msg.subject, msg.body, `sprinto-test-${companyId}-default`);
    await deps.markSent(companyId, messageId, deps.approvedEmail(), "API_ACCEPTED");
    await deps.updateCompany(companyId, { status: "SENT" });
    await deps.logEvent({
      company_id: companyId,
      type: "send",
      message: `${deps.providerName()} API accepted test email (message ${messageId}). Inbox delivery is not confirmed by this status.`,
      data: { messageId, provider: deps.providerName(), status: "API_ACCEPTED", at: new Date().toISOString() },
    });
    return { messageId, status: "API_ACCEPTED" as const };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Send failed";
    await deps.markSendFailed(companyId, message);
    await deps.logEvent({ company_id: companyId, type: "send", message: `Test send FAILED: ${message}`, data: { status: "FAILED" } });
    throw e;
  }
}
