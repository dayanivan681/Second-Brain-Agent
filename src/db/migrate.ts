import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqlClient } from "./sql.js";

export const MIGRATIONS_DIR = join(import.meta.dirname, "..", "..", "supabase", "migrations");

/**
 * Aplica en orden las migraciones pendientes. En Supabase se aplican con
 * `supabase db push`; esta función sirve para tests y entornos locales.
 */
export async function migrate(sql: SqlClient, dir = MIGRATIONS_DIR): Promise<string[]> {
  await sql.exec("create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())");
  const applied = new Set((await sql.query<{ version: string }>("select version from schema_migrations")).map((r) => r.version));
  const pending = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().filter((f) => !applied.has(f));
  for (const file of pending) {
    await sql.transaction(async (tx) => {
      await tx.exec(readFileSync(join(dir, file), "utf8"));
      await tx.query("insert into schema_migrations (version) values ($1)", [file]);
    });
  }
  return pending;
}
