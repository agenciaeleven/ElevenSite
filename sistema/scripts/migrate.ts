import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "../src/lib/db";

export async function migrate(log = true) {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const dir = join(__dirname, "..", "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set((await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));
  for (const f of files) {
    if (applied.has(f)) continue;
    const body = readFileSync(join(dir, f), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (name) VALUES (${f})`;
    });
    if (log) console.log(`✔ migração aplicada: ${f}`);
  }
}

if (require.main === module) {
  migrate()
    .then(() => sql.end())
    .catch(async (e) => {
      console.error(e);
      await sql.end();
      process.exit(1);
    });
}
