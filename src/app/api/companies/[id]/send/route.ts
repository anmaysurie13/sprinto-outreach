import { handle, json, parseId, readJson } from "@/lib/api";
import { RecipientBlockedError } from "@/services/gmail";
import { sendTest, SendBlockedError } from "@/services/send";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Sends ONE email to TEST_EMAIL only. Requires {confirmed:true}; never auto-called, never retried. */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const id = parseId((await params).id);
    const b = await readJson<{ confirmed?: boolean }>(req);
    try {
      return json(await sendTest(id, b.confirmed === true));
    } catch (e) {
      if (e instanceof SendBlockedError) return json({ error: e.message }, e.httpStatus);
      if (e instanceof RecipientBlockedError) return json({ error: e.message }, 403);
      return json({ error: e instanceof Error ? e.message : "Send failed" }, 502);
    }
  });
}
