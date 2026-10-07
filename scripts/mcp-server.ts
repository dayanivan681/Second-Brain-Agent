// Servidor MCP de solo lectura sobre la memoria en Supabase.
// Variables: DATABASE_URL, MCP_TOKEN (≥ 32 caracteres), PORT; OPENAI_API_KEY opcional (búsqueda semántica).
import { PostgresBriefingRepository } from "../src/briefing/repository.js";
import { OpenAIEmbedder } from "../src/core/openai-embedder.js";
import { SemanticSearch } from "../src/core/semantic.js";
import { MemoryStore } from "../src/core/store.js";
import { createPgClient } from "../src/db/pg-client.js";
import { PostgresMemoryRepository } from "../src/db/postgres-repository.js";
import { PostgresVectorIndex } from "../src/db/postgres-vector-index.js";
import { createMcpHttpServer } from "../src/mcp/http.js";

const { DATABASE_URL, MCP_TOKEN, OPENAI_API_KEY } = process.env;
const PORT = Number(process.env.PORT || 8787);
if (!DATABASE_URL || !MCP_TOKEN) {
  console.error("Faltan DATABASE_URL o MCP_TOKEN.");
  process.exit(1);
}

const sql = createPgClient(DATABASE_URL);
const store = new MemoryStore(new PostgresMemoryRepository(sql));
const server = createMcpHttpServer({
  store,
  now: () => new Date(),
  token: MCP_TOKEN,
  briefings: new PostgresBriefingRepository(sql),
  ...(OPENAI_API_KEY ? { semantic: new SemanticSearch(store, new PostgresVectorIndex(sql), new OpenAIEmbedder(OPENAI_API_KEY)) } : {}),
});
server.listen(PORT, () => console.log(`MCP en http://localhost:${PORT}/mcp`));
const stop = () => server.close(() => void sql.end().then(() => process.exit(0)));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
