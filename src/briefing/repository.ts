import type { SqlClient } from "../db/sql.js";
import type { Briefing } from "./briefing.js";

export interface BriefingRepository {
  get(date: string): Promise<Briefing | undefined>;
  save(briefing: Briefing): Promise<void>;
  /** Más recientes primero. */
  recent(limit: number): Promise<Briefing[]>;
  /** Fechas de los briefings que mencionan la memoria. */
  datesMentioning(memoryId: string): Promise<string[]>;
}

/**
 * Quita de un briefing todo rastro de una memoria eliminada: objetivos,
 * cambios, citas y las prioridades que se apoyaban en ella (su texto podría
 * parafrasearla); si había alguna, también el resumen libre.
 */
export function redactMemory(b: Briefing, memoryId: string): Briefing {
  const out = structuredClone(b);
  out.goals = out.goals.filter((g) => g.memoryId !== memoryId);
  out.changes = out.changes.map((c) => (c.memoryId === memoryId ? { ...c, statement: "" } : c));
  if (out.priorities?.some((p) => p.citations.some((c) => c.memoryId === memoryId))) {
    out.priorities = out.priorities.filter((p) => !p.citations.some((c) => c.memoryId === memoryId));
    out.prioritiesSummary = "[resumen retirado: citaba una memoria eliminada]";
  }
  return out;
}

export class InMemoryBriefingRepository implements BriefingRepository {
  private readonly rows = new Map<string, Briefing>();
  async get(date: string) {
    const b = this.rows.get(date);
    return b && structuredClone(b);
  }
  async save(briefing: Briefing) {
    this.rows.set(briefing.date, structuredClone(briefing));
  }
  async recent(limit: number) {
    return [...this.rows.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, limit).map((b) => structuredClone(b));
  }
  async datesMentioning(memoryId: string) {
    return [...this.rows.values()].filter((b) => JSON.stringify(b).includes(memoryId)).map((b) => b.date);
  }
}

export class PostgresBriefingRepository implements BriefingRepository {
  constructor(private readonly sql: SqlClient) {}

  async get(date: string) {
    const [row] = await this.sql.query<{ content: Briefing | string }>("select content from briefings where date = $1", [date]);
    return row ? parse(row.content) : undefined;
  }

  async save(b: Briefing) {
    await this.sql.query(
      `insert into briefings (date, generated_at, content, useful)
       values ($1, $2, $3, $4)
       on conflict (date) do update set generated_at = excluded.generated_at, content = excluded.content, useful = excluded.useful`,
      [b.date, b.generatedAt, JSON.stringify(b), b.feedback?.useful ?? null],
    );
  }

  async recent(limit: number) {
    const rows = await this.sql.query<{ content: Briefing | string }>("select content from briefings order by date desc limit $1", [limit]);
    return rows.map((r) => parse(r.content));
  }

  async datesMentioning(memoryId: string) {
    const rows = await this.sql.query<{ date: string }>("select date from briefings where content::text like $1", [`%${memoryId}%`]);
    return rows.map((r) => r.date);
  }
}

const parse = (c: Briefing | string): Briefing => (typeof c === "string" ? (JSON.parse(c) as Briefing) : c);
