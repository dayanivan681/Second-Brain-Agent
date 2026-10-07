import type { Memory } from "./types.js";

/**
 * Persistencia de memorias como agregados (memoria + fuentes + revisiones).
 * `MemoryStore` contiene la lógica; cada adaptador solo guarda y lee.
 */
export interface MemoryRepository {
  /** Ejecuta `fn` de forma atómica: si lanza, no queda ningún cambio. */
  transaction<T>(fn: (repo: MemoryRepository) => Promise<T>): Promise<T>;
  getById(id: string): Promise<Memory | undefined>;
  getByKey(key: string): Promise<Memory | undefined>;
  /** Memorias activas con al menos una fuente `sourceId`. */
  listActiveBySource(sourceId: string): Promise<Memory[]>;
  /** Todas las memorias, ordenadas por `createdAt` y luego `id`. */
  listAll(): Promise<Memory[]>;
  /** Inserta o reemplaza el agregado completo. */
  save(memory: Memory): Promise<void>;
  count(): Promise<number>;
}

export function compareMemories(a: Memory, b: Memory): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
