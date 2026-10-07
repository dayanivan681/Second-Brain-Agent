import { beforeEach, describe, expect, it } from "vitest";
import { sha256 } from "../src/core/hash.js";
import { extractDrafts } from "../src/core/importer.js";
import { InMemoryRepository } from "../src/core/in-memory-repository.js";
import { InMemoryVectorIndex } from "../src/core/in-memory-vector-index.js";
import { OpenAIEmbedder } from "../src/core/openai-embedder.js";
import { HashingEmbedder, SemanticSearch, type VectorIndex } from "../src/core/semantic.js";
import { MemoryStore } from "../src/core/store.js";
import { PostgresMemoryRepository } from "../src/db/postgres-repository.js";
import { PostgresVectorIndex } from "../src/db/postgres-vector-index.js";
import type { SqlClient } from "../src/db/sql.js";
import { entry } from "./helpers.js";
import { freshDatabase } from "./repositories.js";

const NOTE = `## Decisiones
- Usar pagos mensuales en lugar de anuales
- Posponer la app móvil hasta después del piloto
## Estado
- Landing page terminada
`;
const OTHER = "---\ndomain: beta\n---\n## Decisions\n- Focus on B2B first\n";

async function importNote(store: MemoryStore, id: string, content: string) {
  await store.importSource(id, extractDrafts(`${id}.md`, content, entry({ id, sha256: sha256(content), domain: "alfa" })));
}

const BACKENDS: Array<[string, () => Promise<{ store: MemoryStore; index: VectorIndex; sql?: SqlClient }>]> = [
  ["en memoria", async () => ({ store: new MemoryStore(new InMemoryRepository()), index: new InMemoryVectorIndex() })],
  [
    "pgvector (PGlite)",
    async () => {
      const sql = await freshDatabase();
      return { store: new MemoryStore(new PostgresMemoryRepository(sql)), index: new PostgresVectorIndex(sql), sql };
    },
  ],
];

describe.each(BACKENDS)("SemanticSearch — %s", (_name, make) => {
  let store: MemoryStore;
  let index: VectorIndex;
  let search: SemanticSearch;
  let sql: SqlClient | undefined;

  beforeEach(async () => {
    ({ store, index, sql } = await make());
    search = new SemanticSearch(store, index, new HashingEmbedder());
    await importNote(store, "alfa", NOTE);
    await importNote(store, "beta", OTHER);
  });

  it("sincroniza solo lo necesario", async () => {
    expect(await search.sync()).toEqual({ embedded: 4, removed: 0, unchanged: 0 });
    expect(await search.sync()).toEqual({ embedded: 0, removed: 0, unchanged: 4 });
  });

  it("encuentra por similitud lo que la búsqueda textual no ve", async () => {
    await search.sync();
    expect(await store.search("mensualidad")).toHaveLength(0);
    const [top] = await search.search("mensualidad");
    expect(top?.memory.statement).toBe("Usar pagos mensuales en lugar de anuales");
    expect(top?.matchedBy).toEqual(["vector"]);
    expect(top?.similarity).toBeGreaterThan(0);
  });

  it("combina coincidencias textuales y vectoriales", async () => {
    await search.sync();
    const [top] = await search.search("app móvil");
    expect(top?.memory.statement).toContain("app móvil");
    expect(top?.matchedBy.sort()).toEqual(["text", "vector"]);
  });

  it("descarta vecinos poco similares", async () => {
    await search.sync();
    const hits = await search.search("zzz qqq xyzzy");
    expect(hits.filter((h) => h.matchedBy.includes("vector"))).toHaveLength(0);
  });

  it("filtra por dominio", async () => {
    await search.sync();
    const hits = await search.search("focus B2B", { domain: "alfa" });
    expect(hits.every((h) => h.memory.domain === "alfa")).toBe(true);
    expect((await search.search("focus B2B", { domain: "beta" }))[0]?.memory.statement).toBe("Focus on B2B first");
  });

  it("re-embebe tras una corrección y nunca devuelve el texto viejo sin sincronizar", async () => {
    await search.sync();
    const m = (await store.search("mensuales"))[0]!;
    await store.correct(m.id, "Usar pagos trimestrales", "aclaración");
    const before = await search.search("mensualidad");
    expect(before.every((h) => h.memory.id !== m.id || h.matchedBy.includes("text"))).toBe(true);
    expect(await search.sync()).toEqual({ embedded: 1, removed: 0, unchanged: 3 });
    expect((await search.search("trimestral"))[0]?.memory.id).toBe(m.id);
  });

  it("lo retractado o eliminado sale del índice y de los resultados", async () => {
    await search.sync();
    const landing = (await store.search("landing"))[0]!;
    const app = (await store.search("app movil"))[0]!;
    await store.retract(landing.id, "ya no aplica");
    await store.delete(app.id, "petición del usuario");
    const ids = [...(await search.search("landing page")), ...(await search.search("aplicacion movil"))].map((h) => h.memory.id);
    expect(ids).not.toContain(landing.id);
    expect(ids).not.toContain(app.id);
    expect((await search.sync()).removed).toBe(sql ? 1 : 2);
    expect((await index.entries()).has(app.id)).toBe(false);
  });

  it.runIf(_name.includes("pgvector"))("la base de datos purga el embedding al eliminar, sin esperar a sync", async () => {
    await search.sync();
    const m = (await store.search("landing"))[0]!;
    await store.delete(m.id, "petición del usuario");
    const rows = await sql!.query("select 1 from memory_embeddings where memory_id = $1", [m.id]);
    expect(rows).toHaveLength(0);
  });
});

describe("OpenAIEmbedder", () => {
  it("envía el lote y ordena la respuesta por índice", async () => {
    const calls: unknown[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({ data: [{ index: 1, embedding: new Array(1536).fill(1) }, { index: 0, embedding: new Array(1536).fill(0) }] }),
      );
    }) as typeof fetch;
    const embedder = new OpenAIEmbedder("sk-test", "text-embedding-3-small", fakeFetch);
    const [a, b] = await embedder.embed(["a", "b"]);
    expect(a![0]).toBe(0);
    expect(b![0]).toBe(1);
    expect(calls).toEqual([{ model: "text-embedding-3-small", input: ["a", "b"], dimensions: 1536 }]);
  });

  it("falla con errores HTTP y respuestas mal formadas", async () => {
    const status = (async () => new Response("no", { status: 429 })) as unknown as typeof fetch;
    await expect(new OpenAIEmbedder("k", undefined, status).embed(["a"])).rejects.toThrow("429");
    const bad = (async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }] }))) as unknown as typeof fetch;
    await expect(new OpenAIEmbedder("k", undefined, bad).embed(["a"])).rejects.toThrow("forma");
  });
});
