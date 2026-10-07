// Rutina diaria del briefing de Today. Pensada para un cron (GitHub Actions o
// Vercel). Sin DATABASE_URL termina sin error: no hay nada que hacer todavía.
import { OpenAIChatModel } from "../src/agent/openai-chat.js";
import { PostgresBriefingRepository } from "../src/briefing/repository.js";
import { runDailyBriefing } from "../src/briefing/routine.js";
import { OpenAIEmbedder } from "../src/core/openai-embedder.js";
import { SemanticSearch } from "../src/core/semantic.js";
import { MemoryStore } from "../src/core/store.js";
import { createPgClient } from "../src/db/pg-client.js";
import { PostgresMemoryRepository } from "../src/db/postgres-repository.js";
import { PostgresVectorIndex } from "../src/db/postgres-vector-index.js";

const { DATABASE_URL, OPENAI_API_KEY, OPENAI_CHAT_MODEL } = process.env;
// Las variables vacías de GitHub Actions llegan como "", no como undefined.
const BRIEFING_TZ = process.env.BRIEFING_TZ || "UTC";

if (!DATABASE_URL) {
  console.log("Briefing omitido: falta DATABASE_URL.");
  process.exit(0);
}

const sql = createPgClient(DATABASE_URL);
try {
  const store = new MemoryStore(new PostgresMemoryRepository(sql));
  const llm = OPENAI_API_KEY && OPENAI_CHAT_MODEL ? new OpenAIChatModel(OPENAI_API_KEY, OPENAI_CHAT_MODEL) : undefined;
  const semantic = OPENAI_API_KEY ? new SemanticSearch(store, new PostgresVectorIndex(sql), new OpenAIEmbedder(OPENAI_API_KEY)) : undefined;
  if (semantic) await semantic.sync();

  const { briefing, created } = await runDailyBriefing({
    repo: new PostgresBriefingRepository(sql),
    store,
    now: () => new Date(),
    timeZone: BRIEFING_TZ,
    ...(llm ? { model: llm } : {}),
    ...(semantic ? { semantic } : {}),
    force: process.argv.includes("--force"),
  });
  console.log(
    JSON.stringify({
      date: briefing.date,
      created,
      priorities: briefing.priorities?.length ?? null,
      changes: briefing.changes.length,
      staleSources: briefing.staleSources.length,
      health: briefing.health,
      warnings: briefing.warnings,
    }),
  );
  if (briefing.health.model === "error") process.exitCode = 1;
} finally {
  await sql.end();
}
