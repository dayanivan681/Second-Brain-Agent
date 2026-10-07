import { compareMemories, type MemoryRepository } from "./repository.js";
import type { Memory } from "./types.js";

export class InMemoryRepository implements MemoryRepository {
  private memories = new Map<string, Memory>();
  private byKey = new Map<string, string>();

  async transaction<T>(fn: (repo: MemoryRepository) => Promise<T>): Promise<T> {
    const memories = structuredClone(this.memories);
    const byKey = new Map(this.byKey);
    try {
      return await fn(this);
    } catch (error) {
      this.memories = memories;
      this.byKey = byKey;
      throw error;
    }
  }

  async getById(id: string): Promise<Memory | undefined> {
    const m = this.memories.get(id);
    return m && structuredClone(m);
  }

  async getByKey(key: string): Promise<Memory | undefined> {
    const id = this.byKey.get(key);
    return id === undefined ? undefined : this.getById(id);
  }

  async listActiveBySource(sourceId: string): Promise<Memory[]> {
    return (await this.listAll()).filter((m) => m.status === "active" && m.sources.some((s) => s.sourceId === sourceId));
  }

  async listAll(): Promise<Memory[]> {
    return [...this.memories.values()].map((m) => structuredClone(m)).sort(compareMemories);
  }

  async save(memory: Memory): Promise<void> {
    const ownerOfKey = this.byKey.get(memory.key);
    if (ownerOfKey !== undefined && ownerOfKey !== memory.id) throw new Error(`Clave duplicada: ${memory.key}`);
    this.memories.set(memory.id, structuredClone(memory));
    this.byKey.set(memory.key, memory.id);
  }

  async count(): Promise<number> {
    return this.memories.size;
  }
}
