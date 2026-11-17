import { requireEnv, testEmail } from "@/lib/env";

export class RecipientBlockedError extends Error {
  constructor(attempted: string) {
    super(`Blocked: "${attempted}" is not the approved test inbox. Emails are only ever sent to TEST_EMAIL.`);
    this.name = "RecipientBlockedError";
  }
}

/** Hard rule: the only allowed recipient is TEST_EMAIL (exact, single address; no lists, no CC/BCC). */
export function assertApprovedRecipient(to: string, approved: string): void {
  const t = to.trim().toLowerCase();
  if (/[,;\r\n<>]/.test(t) || t !== approved.trim().toLowerCase()) throw new RecipientBlockedError(to.slice(0, 80));
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const wrap76 = (s: string) => s.replace(/(.{76})/g, "$1\r\n");

/** Pure MIME builder. Deliberately has NO cc/bcc support. */
export function buildRaw(to: string, subject: string, body: string): string {
  const cleanSubject = subject.replace(/[\r\n]+/g, " ").trim();
  const msg = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${b64(cleanSubject)}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(body)),
  ].join("\r\n");
  return Buffer.from(msg, "utf8").toString("base64url");
}

export function composeTestMessage(opts: {
  subject: string;
  draft: string;
  prospectName: string;
  prospectTitle: string;
  domain: string;
}): { subject: string; body: string } {
  const banner = `[TEST SEND — drafted for ${opts.prospectName}, ${opts.prospectTitle} at ${opts.domain}. The prospect was NOT contacted; this message went only to the configured test inbox.]`;
  return { subject: `[TEST] ${opts.subject}`, body: `${banner}\n\n${opts.draft}` };
}

let tokenCache: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      refresh_token: requireEnv("GOOGLE_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google OAuth token refresh failed (HTTP ${res.status})`); // never include the body/tokens
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

/** Single send attempt, no automatic retry (a retry could double-send). */
export async function sendRaw(to: string, subject: string, body: string): Promise<{ messageId: string; threadId?: string }> {
  assertApprovedRecipient(to, testEmail());
  const token = await accessToken();
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw: buildRaw(to, subject, body) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Gmail API send failed (HTTP ${res.status})`);
  const j = (await res.json()) as { id: string; threadId?: string };
  return { messageId: j.id, threadId: j.threadId };
}

/**
 * Resend alternative (used when RESEND_API_KEY is set). Same hard recipient rule; single `to`,
 * no cc/bcc fields; an idempotency key makes Resend itself reject a repeated send.
 */
export async function sendViaResend(
  to: string,
  subject: string,
  body: string,
  idempotencyKey?: string,
): Promise<{ messageId: string }> {
  assertApprovedRecipient(to, testEmail());
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM?.trim() || "Sprinto Outreach Test <onboarding@resend.dev>",
      to: [to],
      subject: subject.replace(/[\r\n]+/g, " ").trim(),
      text: body,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const detail = ((await res.json().catch(() => ({}))) as { message?: string }).message ?? "";
    throw new Error(`Resend API send failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const j = (await res.json()) as { id: string };
  return { messageId: j.id };
}

export const mailProvider = (): "Resend" | "Gmail" => (process.env.RESEND_API_KEY?.trim() ? "Resend" : "Gmail");

/** Recipient is read from TEST_EMAIL here — callers cannot choose it. */
export const sendToTestInbox = (subject: string, body: string, idempotencyKey?: string) =>
  mailProvider() === "Resend"
    ? sendViaResend(testEmail(), subject, body, idempotencyKey)
    : sendRaw(testEmail(), subject, body);
