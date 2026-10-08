// Importa un paquete de contexto a Supabase: npm run import -- <dir> [--dry-run]
// Ej. datos sintéticos de prueba: npm run import -- fixtures/synthetic/vault
import { importPackage } from "../src/core/import-package.js";
import { OpenAIEmbedder } from "../src/core/openai-embedder.js";
import { SemanticSearch } from "../src/core/semantic.js";
import { MemoryStore } from "../src/core/store.js";
import { createPgClient } from "../src/db/pg-client.js";
import { PostgresMemoryRepository } from "../src/db/postgres-repository.js";
import { PostgresVectorIndex } from "../src/db/postgres-vector-index.js";

const dir = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
const { DATABASE_URL, OPENAI_API_KEY } = process.env;
if (!dir || !DATABASE_URL) {
  console.error("Uso: DATABASE_URL=… npm run import -- <dir-paquete> [--dry-run]");
  process.exit(1);
}

const sql = createPgClient(DATABASE_URL);
try {
  const store = new MemoryStore(new PostgresMemoryRepository(sql));
  const result = await importPackage(dir, store, { dryRun });
  if (result.issues.length) {
    console.error("Manifiesto rechazado; no se importó nada:");
    for (const i of result.issues) console.error(`- [${i.code}] ${i.message}`);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ packageId: result.packageId, synthetic: result.synthetic, dryRun, sources: result.sources }, null, 2));
    if (!dryRun && OPENAI_API_KEY) {
      const sync = await new SemanticSearch(store, new PostgresVectorIndex(sql), new OpenAIEmbedder(OPENAI_API_KEY)).sync();
      console.log(`Embeddings: ${JSON.stringify(sync)}`);
    } else if (!dryRun) {
      console.log("Sin OPENAI_API_KEY: solo búsqueda textual hasta sincronizar embeddings.");
    }
  }
} finally {
  await sql.end();
}
