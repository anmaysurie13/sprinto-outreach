import { handle, json, maskEmail, parseId } from "@/lib/api";
import * as db from "@/services/database";

export const dynamic = "force-dynamic";

export function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const id = parseId((await params).id);
    const company = await db.getCompany(id);
    if (!company) return json({ error: "Not found" }, 404);
    const [evidence, contact, outreach, run, events] = await Promise.all([
      db.listEvidence(id),
      db.getContact(id),
      db.getOutreach(id),
      db.getRun(id),
      db.listEvents({ companyId: id, limit: 100 }),
    ]);
    return json({
      company,
      // Page text stays server-side; the UI gets sizes + extracted facts only.
      evidence: evidence.map(({ content, links, ...e }) => ({ ...e, content_chars: content?.length ?? 0, link_count: links?.length ?? 0 })),
      contact: contact ? { ...contact, email: maskEmail(contact.email) } : null,
      testInbox: process.env.TEST_EMAIL?.trim() ? maskEmail(process.env.TEST_EMAIL.trim()) : null,
      outreach,
      run,
      events,
    });
  });
}
