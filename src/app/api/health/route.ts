import { handle, json } from "@/lib/api";
import { envPresence } from "@/lib/env";
import { ping } from "@/services/database";

export const dynamic = "force-dynamic";

/** Reports which env vars are set (booleans only) and whether Neon is reachable. */
export function GET() {
  return handle(async () => {
    const env = envPresence();
    let database: "ok" | "error" | "not_configured" = "not_configured";
    if (env.DATABASE_URL) {
      try {
        await ping();
        database = "ok";
      } catch {
        database = "error";
      }
    }
    return json({ env, database });
  });
}
