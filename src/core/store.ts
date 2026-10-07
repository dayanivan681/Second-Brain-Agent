import { randomUUID } from "node:crypto";
import { sha256 } from "./hash.js";
import type { MemoryRepository } from "./repository.js";
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
 * Semántica de memoria del MVP sobre cualquier `MemoryRepository`
 * (en memoria o Postgres). Los tests de contrato corren contra ambos.
 */
export class MemoryStore {
  constructor(
    private readonly repo: MemoryRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private now(): string {
    return this.clock().toISOString();
  }

  get(id: string): Promise<Memory | undefined> {
    return this.repo.getById(id);
  }

  async all(options: { includeInactive?: boolean } = {}): Promise<Memory[]> {
    return (await this.repo.listAll()).filter((m) => options.includeInactive || m.status === "active");
  }

  /**
   * Importa el estado completo de una fuente. Idempotente: reimportar el mismo
   * contenido no crea duplicados. Lo que ya no aparece en la fuente se retracta
   * conservando historia.
   */
  importSource(sourceId: string, drafts: MemoryDraft[]): Promise<ImportResult> {
    return this.repo.transaction(async (repo) => {
      const result: ImportResult = { created: 0, unchanged: 0, updated: 0, retracted: 0 };
      const at = this.now();
      const seen = new Set<string>();
      let latestSource: SourceRef | undefined;

      for (const draft of drafts) {
        if (draft.source.sourceId !== sourceId) throw new Error(`Draft de otra fuente: ${draft.source.sourceId}`);
        latestSource = draft.source;
        if (seen.has(draft.key)) continue;
        seen.add(draft.key);
        const existing = await repo.getByKey(draft.key);

        if (!existing) {
          await repo.save({
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
          });
          result.created++;
          continue;
        }
        if (existing.status === "deleted") {
          // El usuario eliminó esta memoria: no se resucita por reimportar.
          result.unchanged++;
          continue;
        }
        const lastSource = existing.sources.at(-1);
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
        await repo.save(existing);
        result.updated++;
      }

      for (const memory of await repo.listActiveBySource(sourceId)) {
        if (seen.has(memory.key)) continue;
        memory.status = "retracted";
        memory.updatedAt = at;
        memory.revisions.push({
          at,
          by: "import",
          change: "retract",
          reason: "Ya no aparece en la fuente",
          ...(latestSource ? { source: latestSource } : {}),
        });
        await repo.save(memory);
        result.retracted++;
      }
      return result;
    });
  }

  /** Corrección del usuario: cambia el texto y preserva el anterior en la historia. */
  correct(id: string, statement: string, reason: string): Promise<Memory> {
    return this.repo.transaction(async (repo) => {
      const memory = await requireMutable(repo, id);
      const at = this.now();
      memory.revisions.push({ at, by: "user", change: "correct", previousStatement: memory.statement, reason });
      memory.statement = statement;
      memory.status = "active";
      memory.updatedAt = at;
      await repo.save(memory);
      return memory;
    });
  }

  retract(id: string, reason: string): Promise<Memory> {
    return this.repo.transaction(async (repo) => {
      const memory = await requireMutable(repo, id);
      const at = this.now();
      memory.status = "retracted";
      memory.updatedAt = at;
      memory.revisions.push({ at, by: "user", change: "retract", reason });
      await repo.save(memory);
      return memory;
    });
  }

  /**
   * Eliminación real: purga el texto actual y el de revisiones anteriores.
   * Queda una lápida (id, clave, fechas) para que reimportar no la resucite.
   */
  delete(id: string, reason: string): Promise<void> {
    return this.repo.transaction(async (repo) => {
      const memory = await repo.getById(id);
      if (!memory) throw new Error(`Memoria inexistente: ${id}`);
      const at = this.now();
      memory.statement = "";
      memory.sources = [];
      memory.revisions = memory.revisions.map(({ previousStatement: _p, source: _s, ...rest }): Revision => rest);
      memory.revisions.push({ at, by: "user", change: "delete", reason });
      memory.status = "deleted";
      memory.updatedAt = at;
      await repo.save(memory);
    });
  }

  /** Estado de una memoria en una fecha pasada, o undefined si aún no existía o fue eliminada. */
  async asOf(id: string, date: string): Promise<{ statement: string; status: Memory["status"] } | undefined> {
    const memory = await this.repo.getById(id);
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
  async search(query: string, filter: { domain?: string; includeInactive?: boolean } = {}): Promise<Memory[]> {
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    return (await this.all({ includeInactive: filter.includeInactive ?? false }))
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

  async export(): Promise<MemoryExport> {
    const memories = await this.repo.listAll();
    return { schemaVersion: 1, exportedAt: this.now(), checksum: sha256(JSON.stringify(memories)), memories };
  }

  /** Restaura una exportación en un repositorio vacío. */
  static async restore(data: MemoryExport, repo: MemoryRepository, clock?: () => Date): Promise<MemoryStore> {
    if (data.schemaVersion !== 1) throw new ExportIntegrityError(`schemaVersion no soportado: ${data.schemaVersion}`);
    if (sha256(JSON.stringify(data.memories)) !== data.checksum) throw new ExportIntegrityError("Checksum inválido");
    await repo.transaction(async (tx) => {
      if ((await tx.count()) > 0) throw new ExportIntegrityError("El repositorio de destino no está vacío");
      const keys = new Set<string>();
      for (const m of data.memories) {
        if (keys.has(m.key)) throw new ExportIntegrityError(`Clave duplicada: ${m.key}`);
        keys.add(m.key);
        await tx.save(m);
      }
    });
    return new MemoryStore(repo, clock);
  }
}

async function requireMutable(repo: MemoryRepository, id: string): Promise<Memory> {
  const memory = await repo.getById(id);
  if (!memory) throw new Error(`Memoria inexistente: ${id}`);
  if (memory.status === "deleted") throw new Error(`Memoria eliminada: ${id}`);
  return memory;
}
