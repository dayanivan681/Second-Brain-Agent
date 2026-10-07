import { randomUUID } from "node:crypto";
import { sha256 } from "./hash.js";
import { normalizeText, tokenize } from "./text.js";
import type { Memory, MemoryDraft, Revision, SourceRef } from "./types.js";

export interface ImportResult {
  created: number;
  unchanged: number;
  updated: number;
  /** Memorias que desaparecieron de la fuente (p. ej. decisión revertida). */
  retracted: number;
}

export interface MemoryExport {
  schemaVersion: 1;
  exportedAt: string;
  checksum: string;
  memories: Memory[];
}

export class ExportIntegrityError extends Error {}

/**
 * Almacén en memoria con la semántica del MVP. La versión Postgres implementará
 * la misma interfaz; los tests de este archivo son su contrato.
 */
export class MemoryStore {
  private readonly memories = new Map<string, Memory>();
  private readonly byKey = new Map<string, string>();

  constructor(private readonly clock: () => Date = () => new Date()) {}

  private now(): string {
    return this.clock().toISOString();
  }

  get(id: string): Memory | undefined {
    const m = this.memories.get(id);
    return m && structuredClone(m);
  }

  all(options: { includeInactive?: boolean } = {}): Memory[] {
    return [...this.memories.values()]
      .filter((m) => options.includeInactive || m.status === "active")
      .map((m) => structuredClone(m));
  }

  /**
   * Importa el estado completo de una fuente. Idempotente: reimportar el mismo
   * contenido no crea duplicados. Lo que ya no aparece en la fuente se retracta
   * conservando historia.
   */
  importSource(sourceId: string, drafts: MemoryDraft[]): ImportResult {
    const result: ImportResult = { created: 0, unchanged: 0, updated: 0, retracted: 0 };
    const at = this.now();
    const seen = new Set<string>();
    let latestSource: SourceRef | undefined;

    for (const draft of drafts) {
      if (draft.source.sourceId !== sourceId) throw new Error(`Draft de otra fuente: ${draft.source.sourceId}`);
      latestSource = draft.source;
      seen.add(draft.key);
      const existingId = this.byKey.get(draft.key);
      const existing = existingId ? this.memories.get(existingId) : undefined;

      if (!existing) {
        const memory: Memory = {
          id: randomUUID(),
          key: draft.key,
          domain: draft.domain,
          category: draft.category,
          epistemic: draft.epistemic,
          statement: draft.statement,
          sources: [draft.source],
          status: "active",
          createdAt: at,
          updatedAt: at,
          revisions: [{ at, by: "import", change: "create", source: draft.source }],
        };
        this.memories.set(memory.id, memory);
        this.byKey.set(memory.key, memory.id);
        result.created++;
        continue;
      }
      if (existing.status === "deleted") {
        // El usuario eliminó esta memoria: no se resucita por reimportar.
        result.unchanged++;
        continue;
      }
      const lastSource = existing.sources[existing.sources.length - 1];
      const reappeared = existing.status === "retracted" && existing.revisions.at(-1)?.by === "import";
      if (lastSource?.contentHash === draft.source.contentHash && !reappeared) {
        result.unchanged++;
        continue;
      }
      if (existing.status === "retracted" && !reappeared) {
        // Retractada por el usuario: se respeta su corrección.
        result.unchanged++;
        continue;
      }
      existing.sources.push(draft.source);
      existing.status = "active";
      existing.updatedAt = at;
      existing.revisions.push({
        at,
        by: "import",
        change: reappeared ? "restore" : "update",
        source: draft.source,
        reason: reappeared ? "Reaparece en la fuente" : "Nueva versión de la fuente",
      });
      result.updated++;
    }

    for (const memory of this.memories.values()) {
      if (memory.status !== "active" || seen.has(memory.key)) continue;
      if (!memory.sources.some((s) => s.sourceId === sourceId)) continue;
      memory.status = "retracted";
      memory.updatedAt = at;
      memory.revisions.push({
        at,
        by: "import",
        change: "retract",
        reason: "Ya no aparece en la fuente",
        ...(latestSource ? { source: latestSource } : {}),
      });
      result.retracted++;
    }
    return result;
  }

  /** Corrección del usuario: cambia el texto y preserva el anterior en la historia. */
  correct(id: string, statement: string, reason: string): Memory {
    const memory = this.requireMutable(id);
    const at = this.now();
    memory.revisions.push({ at, by: "user", change: "correct", previousStatement: memory.statement, reason });
    memory.statement = statement;
    memory.status = "active";
    memory.updatedAt = at;
    return structuredClone(memory);
  }

  retract(id: string, reason: string): Memory {
    const memory = this.requireMutable(id);
    const at = this.now();
    memory.status = "retracted";
    memory.updatedAt = at;
    memory.revisions.push({ at, by: "user", change: "retract", reason });
    return structuredClone(memory);
  }

  /**
   * Eliminación real: purga el texto actual y el de revisiones anteriores.
   * Queda una lápida (id, clave, fechas) para que reimportar no la resucite.
   */
  delete(id: string, reason: string): void {
    const memory = this.memories.get(id);
    if (!memory) throw new Error(`Memoria inexistente: ${id}`);
    const at = this.now();
    memory.statement = "";
    memory.sources = [];
    memory.revisions = memory.revisions.map(({ previousStatement: _p, source: _s, ...rest }): Revision => rest);
    memory.revisions.push({ at, by: "user", change: "delete", reason });
    memory.status = "deleted";
    memory.updatedAt = at;
  }

  /** Estado de una memoria en una fecha pasada, o undefined si aún no existía o fue eliminada. */
  asOf(id: string, date: string): { statement: string; status: Memory["status"] } | undefined {
    const memory = this.memories.get(id);
    if (!memory || memory.status === "deleted") return undefined;
    const t = Date.parse(date);
    if (t < Date.parse(memory.createdAt)) return undefined;
    const before = memory.revisions.filter((r) => Date.parse(r.at) <= t);
    const firstLaterCorrection = memory.revisions.find((r) => Date.parse(r.at) > t && r.change === "correct");
    const statement = firstLaterCorrection?.previousStatement ?? memory.statement;
    const status: Memory["status"] = before.at(-1)?.change === "retract" ? "retracted" : "active";
    return { statement, status };
  }

  /** Búsqueda textual insensible a acentos y mayúsculas (ES/EN/Spanglish). */
  search(query: string, filter: { domain?: string; includeInactive?: boolean } = {}): Memory[] {
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    return this.all({ includeInactive: filter.includeInactive ?? false })
      .filter((m) => !filter.domain || m.domain === filter.domain)
      .map((m) => {
        const haystack = normalizeText(`${m.statement} ${m.domain} ${m.sources.map((s) => s.anchor ?? "").join(" ")}`);
        const score = terms.filter((t) => haystack.includes(t)).length;
        return { m, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ m }) => m);
  }

  export(): MemoryExport {
    const memories = [...this.memories.values()].map((m) => structuredClone(m));
    return { schemaVersion: 1, exportedAt: this.now(), checksum: sha256(JSON.stringify(memories)), memories };
  }

  static restore(data: MemoryExport, clock?: () => Date): MemoryStore {
    if (data.schemaVersion !== 1) throw new ExportIntegrityError(`schemaVersion no soportado: ${data.schemaVersion}`);
    if (sha256(JSON.stringify(data.memories)) !== data.checksum) throw new ExportIntegrityError("Checksum inválido");
    const store = new MemoryStore(clock);
    for (const m of data.memories) {
      if (store.byKey.has(m.key)) throw new ExportIntegrityError(`Clave duplicada: ${m.key}`);
      store.memories.set(m.id, structuredClone(m));
      store.byKey.set(m.key, m.id);
    }
    return store;
  }

  private requireMutable(id: string): Memory {
    const memory = this.memories.get(id);
    if (!memory) throw new Error(`Memoria inexistente: ${id}`);
    if (memory.status === "deleted") throw new Error(`Memoria eliminada: ${id}`);
    return memory;
  }
}
