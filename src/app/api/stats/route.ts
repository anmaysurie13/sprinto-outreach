import { handle, json } from "@/lib/api";
import { getStats } from "@/services/database";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => json(await getStats()));
}
