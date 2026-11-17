import { handle, json, parseId } from "@/lib/api";
import { retryCompany } from "@/services/orchestrator";

export const dynamic = "force-dynamic";

export function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    try {
      await retryCompany(parseId((await params).id));
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Retry failed" }, 400);
    }
    return json({ ok: true });
  });
}
