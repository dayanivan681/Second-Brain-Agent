import type { MemoryRepository } from "../core/repository.js";
import type { Memory, Revision, SourceRef } from "../core/types.js";
import type { SqlClient } from "./sql.js";

interface MemoryRow extends Record<string, unknown> {
  id: string;
  key: string;
  domain: string;
  category: Memory["category"];
  epistemic: Memory["epistemic"];
  statement: string;
  status: Memory["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface SourceRow extends Record<string, unknown> {
  memory_id: string;
  source_id: string;
  path: string;
  content_hash: string;
  version: string | null;
  captured_at: string;
  synthetic: boolean;
  anchor: string | null;
}

interface RevisionRow extends Record<string, unknown> {
  memory_id: string;
  at: Date | string;
  by: Revision["by"];
  change: Revision["change"];
  previous_statement: string | null;
  reason: string | null;
  source: SourceRef | string | null;
}

const iso = (v: Date | string) => new Date(v).toISOString();

/** Construye SourceRef con el mismo orden de campos que el importador. */
function toSource(r: { source_id: string; path: string; content_hash: string; captured_at: string; synthetic: boolean; anchor: string | null; version: string | null }): SourceRef {
  return {
    sourceId: r.source_id,
    path: r.path,
    contentHash: r.content_hash,
    capturedAt: r.captured_at,
    synthetic: r.synthetic,
    ...(r.anchor !== null ? { anchor: r.anchor } : {}),
    ...(r.version !== null ? { version: r.version } : {}),
  };
}

function toRevision(r: RevisionRow): Revision {
  const source = typeof r.source === "string" ? (JSON.parse(r.source) as SourceRef) : r.source;
  return {
    at: iso(r.at),
    by: r.by,
    change: r.change,
    ...(r.previous_statement !== null ? { previousStatement: r.previous_statement } : {}),
    ...(r.reason !== null ? { reason: r.reason } : {}),
    ...(source ? { source } : {}),
  };
}

export class PostgresMemoryRepository implements MemoryRepository {
  constructor(private readonly sql: SqlClient) {}

  transaction<T>(fn: (repo: MemoryRepository) => Promise<T>): Promise<T> {
    return this.sql.transaction((tx) => fn(new PostgresMemoryRepository(tx)));
  }

  async getById(id: string): Promise<Memory | undefined> {
    return (await this.load("where id = $1", [id]))[0];
  }

  async getByKey(key: string): Promise<Memory | undefined> {
    return (await this.load("where key = $1", [key]))[0];
  }

  listActiveBySource(sourceId: string): Promise<Memory[]> {
    return this.load(
      "where status = 'active' and exists (select 1 from memory_sources s where s.memory_id = memories.id and s.source_id = $1)",
      [sourceId],
    );
  }

  listAll(): Promise<Memory[]> {
    return this.load("", []);
  }

  async count(): Promise<number> {
    const [row] = await this.sql.query<{ n: number }>("select count(*)::int as n from memories");
    return row?.n ?? 0;
  }

  save(memory: Memory): Promise<void> {
    return this.sql.transaction(async (tx) => {
      await tx.query(
        `insert into memories (id, key, domain, category, epistemic, statement, status, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (id) do update set key = excluded.key, domain = excluded.domain, category = excluded.category,
           epistemic = excluded.epistemic, statement = excluded.statement, status = excluded.status,
           updated_at = excluded.updated_at`,
        [memory.id, memory.key, memory.domain, memory.category, memory.epistemic, memory.statement, memory.status, memory.createdAt, memory.updatedAt],
      );
      // Fuentes y revisiones se reescriben: la eliminación debe poder purgarlas.
      await tx.query("delete from memory_sources where memory_id = $1", [memory.id]);
      await tx.query("delete from memory_revisions where memory_id = $1", [memory.id]);
      for (const [seq, s] of memory.sources.entries()) {
        await tx.query(
          `insert into memory_sources (memory_id, seq, source_id, path, content_hash, version, captured_at, synthetic, anchor)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [memory.id, seq, s.sourceId, s.path, s.contentHash, s.version ?? null, s.capturedAt, s.synthetic, s.anchor ?? null],
        );
      }
      for (const [seq, r] of memory.revisions.entries()) {
        await tx.query(
          `insert into memory_revisions (memory_id, seq, at, by, change, previous_statement, reason, source)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [memory.id, seq, r.at, r.by, r.change, r.previousStatement ?? null, r.reason ?? null, r.source ? JSON.stringify(r.source) : null],
        );
      }
    });
  }

  private async load(where: string, params: unknown[]): Promise<Memory[]> {
    const rows = await this.sql.query<MemoryRow>(`select * from memories ${where} order by created_at, id`, params);
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const sources = await this.sql.query<SourceRow>("select * from memory_sources where memory_id = any($1) order by memory_id, seq", [ids]);
    const revisions = await this.sql.query<RevisionRow>("select * from memory_revisions where memory_id = any($1) order by memory_id, seq", [ids]);
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      domain: r.domain,
      category: r.category,
      epistemic: r.epistemic,
      statement: r.statement,
      sources: sources.filter((s) => s.memory_id === r.id).map(toSource),
      status: r.status,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      revisions: revisions.filter((v) => v.memory_id === r.id).map(toRevision),
    }));
  }
}
