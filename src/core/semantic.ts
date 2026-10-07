import { sha256 } from "./hash.js";
import type { MemoryStore } from "./store.js";
import { normalizeText } from "./text.js";
import type { Memory } from "./types.js";

/** Adaptador de embeddings (OpenAI en producción; determinista en tests). */
export interface Embedder {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface VectorEntry {
  memoryId: string;
  model: string;
  contentHash: string;
  embedding: number[];
}

export interface VectorIndex {
  upsert(entries: VectorEntry[]): Promise<void>;
  remove(memoryIds: string[]): Promise<void>;
  /** memoryId → modelo y hash del texto embebido. */
  entries(): Promise<Map<string, { model: string; contentHash: string }>>;
  /** Vecinos por distancia coseno ascendente, solo del `model` indicado. */
  nearest(embedding: number[], model: string, k: number): Promise<Array<{ memoryId: string; contentHash: string; distance: number }>>;
}

export interface SyncResult {
  embedded: number;
  removed: number;
  unchanged: number;
}

export interface SearchHit {
  memory: Memory;
  /** Fusión de rangos (RRF) de las búsquedas textual y vectorial. */
  score: number;
  matchedBy: Array<"text" | "vector">;
  /** Similitud coseno (1 = idéntico) si hubo coincidencia vectorial. */
  similarity?: number;
}

const RRF_K = 60;
const BATCH = 100;

/** Texto que se embebe por memoria. */
export function embeddingText(memory: Memory): string {
  return memory.statement;
}

/**
 * Búsqueda híbrida (textual + vectorial). Solo indexa memorias activas; lo
 * retractado o eliminado sale del índice en `sync` y nunca se devuelve.
 */
export class SemanticSearch {
  constructor(
    private readonly store: MemoryStore,
    private readonly index: VectorIndex,
    private readonly embedder: Embedder,
  ) {}

  async sync(): Promise<SyncResult> {
    const result: SyncResult = { embedded: 0, removed: 0, unchanged: 0 };
    const memories = await this.store.all({ includeInactive: true });
    const indexed = await this.index.entries();
    const active = new Map(memories.filter((m) => m.status === "active").map((m) => [m.id, m]));

    const stale = [...indexed.keys()].filter((id) => !active.has(id));
    if (stale.length) await this.index.remove(stale);
    result.removed = stale.length;

    const pending: Array<{ memory: Memory; text: string; hash: string }> = [];
    for (const memory of active.values()) {
      const text = embeddingText(memory);
      const hash = sha256(text);
      const current = indexed.get(memory.id);
      if (current?.model === this.embedder.model && current.contentHash === hash) result.unchanged++;
      else pending.push({ memory, text, hash });
    }
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      const vectors = await this.embedder.embed(batch.map((p) => p.text));
      await this.index.upsert(
        batch.map((p, j) => ({ memoryId: p.memory.id, model: this.embedder.model, contentHash: p.hash, embedding: vectors[j]! })),
      );
      result.embedded += batch.length;
    }
    return result;
  }

  /**
   * `minSimilarity` descarta vecinos irrelevantes (depende del modelo; 0.25 es
   * conservador para text-embedding-3-small). Calibrar con la evaluación real.
   */
  async search(query: string, options: { k?: number; domain?: string; minSimilarity?: number } = {}): Promise<SearchHit[]> {
    const k = options.k ?? 10;
    const minSimilarity = options.minSimilarity ?? 0.25;
    if (!normalizeText(query)) return [];
    const hits = new Map<string, SearchHit>();
    const add = (memory: Memory, rank: number, by: "text" | "vector", similarity?: number) => {
      const hit = hits.get(memory.id) ?? { memory, score: 0, matchedBy: [] };
      hit.score += 1 / (RRF_K + rank + 1);
      hit.matchedBy.push(by);
      if (similarity !== undefined) hit.similarity = similarity;
      hits.set(memory.id, hit);
    };

    const textual = await this.store.search(query, options.domain ? { domain: options.domain } : {});
    textual.slice(0, k * 4).forEach((m, rank) => add(m, rank, "text"));

    const [queryVector] = await this.embedder.embed([query]);
    const neighbours = await this.index.nearest(queryVector!, this.embedder.model, k * 4);
    let rank = 0;
    for (const { memoryId, contentHash, distance } of neighbours) {
      const memory = await this.store.get(memoryId);
      // Descarta lo inactivo, de otro dominio u obsoleto (texto cambiado sin re-sincronizar).
      if (!memory || memory.status !== "active") continue;
      if (options.domain && memory.domain !== options.domain) continue;
      if (contentHash !== sha256(embeddingText(memory))) continue;
      if (1 - distance < minSimilarity) break; // vienen ordenados por distancia
      add(memory, rank++, "vector", 1 - distance);
    }
    return [...hits.values()].sort((a, b) => b.score - a.score).slice(0, k);
  }
}

/**
 * Embeddings por hashing de palabras y trigramas. NO es semántico: sirve para
 * tests y desarrollo sin red ni coste. Tolera acentos y variaciones de forma.
 */
export class HashingEmbedder implements Embedder {
  readonly model = "hashing-v1";
  constructor(readonly dimensions = 1536) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const v = new Array<number>(this.dimensions).fill(0);
      for (const word of normalizeText(text).split(" ").filter(Boolean)) {
        const padded = ` ${word} `;
        const features = [word];
        for (let i = 0; i + 3 <= padded.length; i++) features.push(`#${padded.slice(i, i + 3)}`);
        for (const f of features) {
          const h = sha256(f);
          const index = parseInt(h.slice(0, 8), 16) % this.dimensions;
          v[index]! += parseInt(h.slice(8, 9), 16) % 2 === 0 ? 1 : -1;
        }
      }
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }
}
