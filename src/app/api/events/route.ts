import { handle, json } from "@/lib/api";
import { listEvents } from "@/services/database";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(async () => {
    const sp = new URL(req.url).searchParams;
    const items = await listEvents({ type: sp.get("type") || undefined, limit: Number(sp.get("limit")) || 200 });
    return json({ items });
  });
}
