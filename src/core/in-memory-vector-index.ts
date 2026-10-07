import type { VectorEntry, VectorIndex } from "./semantic.js";

export class InMemoryVectorIndex implements VectorIndex {
  private readonly rows = new Map<string, VectorEntry>();

  async upsert(entries: VectorEntry[]): Promise<void> {
    for (const e of entries) this.rows.set(e.memoryId, { ...e, embedding: [...e.embedding] });
  }

  async remove(memoryIds: string[]): Promise<void> {
    for (const id of memoryIds) this.rows.delete(id);
  }

  async entries(): Promise<Map<string, { model: string; contentHash: string }>> {
    return new Map([...this.rows.values()].map((e) => [e.memoryId, { model: e.model, contentHash: e.contentHash }]));
  }

  async nearest(embedding: number[], model: string, k: number): Promise<Array<{ memoryId: string; contentHash: string; distance: number }>> {
    return [...this.rows.values()]
      .filter((e) => e.model === model)
      .map((e) => ({ memoryId: e.memoryId, contentHash: e.contentHash, distance: 1 - cosine(embedding, e.embedding) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k);
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! ** 2;
    nb += b[i]! ** 2;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
