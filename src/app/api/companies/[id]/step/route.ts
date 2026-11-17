import { handle, json, parseId } from "@/lib/api";
import { stepCompany } from "@/services/orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One persisted pipeline step per request — the client loops until `done`. */
export function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => json(await stepCompany(parseId((await params).id))));
}
