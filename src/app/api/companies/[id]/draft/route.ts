import { handle, json, parseId, readJson } from "@/lib/api";
import { EditRejectedError, reviseWithAi, saveHumanEdit } from "@/services/orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** PATCH = human edit (claims re-validated against stored evidence). POST = the single AI revision. */
export function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const id = parseId((await params).id);
    const b = await readJson<{ subject?: string; body?: string }>(req);
    if (!b.subject?.trim() || !b.body?.trim() || b.body.length > 3000) return json({ error: "subject and body (≤3000 chars) are required" }, 400);
    try {
      await saveHumanEdit(id, b.subject.trim().slice(0, 200), b.body.trim());
    } catch (e) {
      if (e instanceof EditRejectedError) return json({ error: "Unsupported claims in draft", issues: e.issues }, 422);
      return json({ error: e instanceof Error ? e.message : "Edit failed" }, 400);
    }
    return json({ ok: true });
  });
}

export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const id = parseId((await params).id);
    const b = await readJson<{ feedback?: string }>(req);
    if (!b.feedback?.trim() || b.feedback.length > 600) return json({ error: "feedback (≤600 chars) is required" }, 400);
    try {
      await reviseWithAi(id, b.feedback.trim());
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Revision failed" }, 400);
    }
    return json({ ok: true });
  });
}
