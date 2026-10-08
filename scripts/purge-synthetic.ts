// Borra de Supabase las memorias de prueba cuyas fuentes son todas sintéticas.
import { purgeSynthetic } from "../src/briefing/purge-synthetic.js";
import { PostgresBriefingRepository } from "../src/briefing/repository.js";
import { MemoryStore } from "../src/core/store.js";
import { createPgClient } from "../src/db/pg-client.js";
import { PostgresMemoryRepository } from "../src/db/postgres-repository.js";

if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL.");
  process.exit(1);
}
const sql = createPgClient(process.env.DATABASE_URL);
try {
  const result = await purgeSynthetic({ store: new MemoryStore(new PostgresMemoryRepository(sql)), briefings: new PostgresBriefingRepository(sql) });
  console.log(`Memorias sintéticas eliminadas: ${result.deleted}`);
} finally {
  await sql.end();
}
