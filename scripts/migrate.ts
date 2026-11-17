import { config } from "dotenv";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });
config();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set (put it in .env.local).");
    process.exit(1);
  }
  const sql = neon(url);
  await sql.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  );
  const done = new Set(
    ((await sql.query("SELECT name FROM schema_migrations")) as { name: string }[]).map((r) => r.name),
  );
  const dir = join(process.cwd(), "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) {
      console.log(`skip  ${file}`);
      continue;
    }
    // Neon's HTTP driver runs one statement per call, so split on semicolons at line ends.
    const statements = readFileSync(join(dir, file), "utf8")
      .split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
      .filter(Boolean);
    for (const stmt of statements) await sql.query(stmt);
    await sql.query("INSERT INTO schema_migrations(name) VALUES ($1) ON CONFLICT DO NOTHING", [file]);
    console.log(`apply ${file} (${statements.length} statements)`);
  }
  console.log("Migrations complete.");
}

main().catch((e) => {
  console.error("Migration failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
