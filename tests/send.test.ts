import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyRow, ContactRow, EvidenceRow, OutreachRow } from "@/lib/types";
import { assertApprovedRecipient, buildRaw, composeTestMessage, RecipientBlockedError, sendRaw, sendViaResend } from "@/services/gmail";
import { sendTest, SendBlockedError, type SendDeps } from "@/services/send";

const TEST = "me.test@example.com";

describe("8. wrong Gmail recipient", () => {
  beforeEach(() => {
    process.env.TEST_EMAIL = TEST;
  });
  it("allows only TEST_EMAIL (case-insensitive)", () => {
    expect(() => assertApprovedRecipient("ME.TEST@example.com", TEST)).not.toThrow();
  });
  it.each(["jane.doe@acme.io", `${TEST}, jane@acme.io`, `${TEST}\nBcc: jane@acme.io`, `Jane <${TEST}>`, ""])("blocks %j", (to) => {
    expect(() => assertApprovedRecipient(to, TEST)).toThrow(RecipientBlockedError);
  });
  it("sendRaw refuses a prospect address BEFORE any network call", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(sendRaw("jane.doe@acme.io", "s", "b")).rejects.toThrow(RecipientBlockedError);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("Resend path refuses a prospect address BEFORE any network call", async () => {
    process.env.RESEND_API_KEY = "re_test_dummy";
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(sendViaResend("jane.doe@acme.io", "s", "b")).rejects.toThrow(RecipientBlockedError);
    await expect(sendViaResend(`${TEST}, jane@acme.io`, "s", "b")).rejects.toThrow(RecipientBlockedError);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    delete process.env.RESEND_API_KEY;
  });
  it("Resend request has a single `to`, no cc/bcc, and an idempotency key", async () => {
    process.env.RESEND_API_KEY = "re_test_dummy";
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "rs-1" }), { status: 200 }));
    await expect(sendViaResend(TEST, "Subj", "Body", "k-1")).resolves.toEqual({ messageId: "rs-1" });
    const [, init] = spy.mock.calls[0];
    const payload = JSON.parse(String(init!.body));
    expect(payload.to).toEqual([TEST]);
    expect(payload.cc).toBeUndefined();
    expect(payload.bcc).toBeUndefined();
    expect((init!.headers as Record<string, string>)["idempotency-key"]).toBe("k-1");
    spy.mockRestore();
    delete process.env.RESEND_API_KEY;
  });
  it("the MIME message has exactly one To header and no Cc/Bcc", () => {
    const raw = Buffer.from(buildRaw(TEST, "Hello\r\nBcc: x@y.com", "body"), "base64url").toString();
    expect(raw.match(/^To: /gm)).toHaveLength(1);
    expect(raw).not.toMatch(/^(Cc|Bcc):/im);
    expect(raw).toContain(`To: ${TEST}`);
  });
  it("shows the prospect's name in the test message without addressing them", () => {
    const m = composeTestMessage({ subject: "SOC 2 prep", draft: "Hi Jane,\n...", prospectName: "Jane Doe", prospectTitle: "CISO", domain: "acme.io" });
    expect(m.subject).toBe("[TEST] SOC 2 prep");
    expect(m.body).toMatch(/Jane Doe, CISO at acme\.io/);
    expect(m.body).toMatch(/NOT contacted/);
  });
});

function makeDeps(over: Partial<SendDeps> = {}) {
  let sendStatus: OutreachRow["send_status"] = "NOT_SENT";
  const company = { id: 1, domain: "acme.io", status: "DRAFT_READY" } as CompanyRow;
  const contact = { id: 1, name: "Jane Doe", title: "CISO", email: "jane.doe@acme.io" } as ContactRow;
  const outreach = { draft: "Hi Jane,\n\nI saw Acme runs a public trust center.\n\nBest,\nThe Sprinto team", subject: "Trust at Acme" } as OutreachRow;
  const evidence = [{ fetch_ok: true, content: "Acme runs a public trust center for enterprise buyers." }] as EvidenceRow[];
  const deps: SendDeps = {
    getCompany: async () => company,
    getContact: async () => contact,
    getOutreach: async () => outreach,
    listEvidence: async () => evidence,
    // atomic claim: only the first caller wins
    claimSend: vi.fn(async () => {
      if (sendStatus !== "NOT_SENT" && sendStatus !== "FAILED") return null;
      sendStatus = "SENDING";
      return outreach;
    }),
    markSent: vi.fn(async () => {
      sendStatus = "SENT";
      company.status = "SENT";
    }),
    markSendFailed: vi.fn(async () => {
      sendStatus = "FAILED";
    }),
    updateCompany: vi.fn(async () => {}),
    logEvent: vi.fn(async () => {}),
    send: vi.fn(async () => ({ messageId: "msg-123" })),
    approvedEmail: () => TEST,
    providerName: () => "Resend",
    ...over,
  };
  return deps;
}

describe("9. duplicate test send", () => {
  it("requires explicit confirmation", async () => {
    const deps = makeDeps();
    await expect(sendTest(1, false, deps)).rejects.toThrow(/confirmation/i);
    expect(deps.send).not.toHaveBeenCalled();
  });
  it("sends once, logs the message id as API_ACCEPTED, blocks the second attempt", async () => {
    const deps = makeDeps();
    const r = await sendTest(1, true, deps);
    expect(r).toEqual({ messageId: "msg-123", status: "API_ACCEPTED" });
    expect(deps.markSent).toHaveBeenCalledWith(1, "msg-123", TEST, "API_ACCEPTED");
    await expect(sendTest(1, true, deps)).rejects.toThrow(/duplicate/i);
    expect(deps.send).toHaveBeenCalledTimes(1);
  });
  it("two concurrent clicks send only one email", async () => {
    const deps = makeDeps();
    const results = await Promise.allSettled([sendTest(1, true, deps), sendTest(1, true, deps)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(deps.send).toHaveBeenCalledTimes(1);
  });
  it("records a failed send and does not mark the company SENT", async () => {
    const deps = makeDeps({ send: vi.fn(async () => { throw new Error("Gmail API send failed (HTTP 500)"); }) });
    await expect(sendTest(1, true, deps)).rejects.toThrow(/HTTP 500/);
    expect(deps.markSendFailed).toHaveBeenCalled();
    expect(deps.markSent).not.toHaveBeenCalled();
  });
  it("blocks a draft that contains an unsupported claim", async () => {
    const base = makeDeps();
    const deps = makeDeps({ getOutreach: async () => ({ ...(await base.getOutreach(1))!, draft: "Hi Jane, congrats on your $50M Series C!" }) });
    await expect(sendTest(1, true, deps)).rejects.toBeInstanceOf(SendBlockedError);
    expect(deps.send).not.toHaveBeenCalled();
  });
});
