import type { VectorEntry, VectorIndex } from "../core/semantic.js";
import type { SqlClient } from "./sql.js";

const literal = (v: number[]) => `[${v.join(",")}]`;

/** Índice pgvector (`memory_embeddings`, distancia coseno con HNSW). */
export class PostgresVectorIndex implements VectorIndex {
  constructor(private readonly sql: SqlClient) {}

  upsert(entries: VectorEntry[]): Promise<void> {
    return this.sql.transaction(async (tx) => {
      for (const e of entries) {
        await tx.query(
          `insert into memory_embeddings (memory_id, model, content_hash, embedding, updated_at)
           values ($1, $2, $3, $4::extensions.vector, now())
           on conflict (memory_id) do update set model = excluded.model, content_hash = excluded.content_hash,
             embedding = excluded.embedding, updated_at = now()`,
          [e.memoryId, e.model, e.contentHash, literal(e.embedding)],
        );
      }
    });
  }

  async remove(memoryIds: string[]): Promise<void> {
    if (memoryIds.length) await this.sql.query("delete from memory_embeddings where memory_id = any($1)", [memoryIds]);
  }

  async entries(): Promise<Map<string, { model: string; contentHash: string }>> {
    const rows = await this.sql.query<{ memory_id: string; model: string; content_hash: string }>(
      "select memory_id, model, content_hash from memory_embeddings",
    );
    return new Map(rows.map((r) => [r.memory_id, { model: r.model, contentHash: r.content_hash }]));
  }

  async nearest(embedding: number[], model: string, k: number): Promise<Array<{ memoryId: string; contentHash: string; distance: number }>> {
    const rows = await this.sql.query<{ memory_id: string; content_hash: string; distance: number }>(
      `select memory_id, content_hash, embedding operator(extensions.<=>) $1::extensions.vector as distance
       from memory_embeddings where model = $2 order by distance limit $3`,
      [literal(embedding), model, k],
    );
    return rows.map((r) => ({ memoryId: r.memory_id, contentHash: r.content_hash, distance: Number(r.distance) }));
  }
}
