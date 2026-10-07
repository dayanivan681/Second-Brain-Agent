import { assessFreshness, type Freshness } from "../core/freshness.js";
import { createProposal, type MarkdownProposal } from "../core/proposals.js";
import type { SemanticSearch } from "../core/semantic.js";
import type { MemoryStore } from "../core/store.js";
import type { Memory } from "../core/types.js";
import type { ToolSpec } from "./model.js";

/** Lo que una herramienta puede hacer, para la política de autonomía. */
export type ToolEffect = "read" | "propose";

export interface AgentTool {
  spec: ToolSpec;
  effect: ToolEffect;
  run(args: Record<string, unknown>): Promise<unknown>;
}

/** Estado de una ejecución: qué evidencia vio el agente y qué propuso. */
export class AgentSession {
  /** Memorias que el agente recibió de una herramienta: las únicas que puede citar. */
  readonly seen = new Map<string, Memory>();
  readonly proposals: MarkdownProposal[] = [];
}

export interface ToolContext {
  store: MemoryStore;
  semantic?: SemanticSearch;
  now: () => Date;
  session: AgentSession;
}

function view(memory: Memory, now: Date): Record<string, unknown> {
  const freshness: Freshness = assessFreshness(memory, now);
  return {
    id: memory.id,
    statement: memory.statement,
    domain: memory.domain,
    category: memory.category,
    epistemic: memory.epistemic,
    status: memory.status,
    freshness,
    updatedAt: memory.updatedAt,
    sources: memory.sources.map((s) => ({ sourceId: s.sourceId, path: s.path, anchor: s.anchor, version: s.version, capturedAt: s.capturedAt })),
  };
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v.trim()) throw new Error(`Argumento requerido: ${name}`);
  return v;
};

export function buildTools(ctx: ToolContext): AgentTool[] {
  const remember = (m: Memory) => {
    ctx.session.seen.set(m.id, m);
    return view(m, ctx.now());
  };

  return [
    {
      effect: "read",
      spec: {
        name: "search_memories",
        description:
          "Busca memorias activas (objetivos, reglas, decisiones, estado) por texto y similitud. Acepta español, inglés o Spanglish. Devuelve id, texto, frescura y fuentes.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            domain: { type: "string", description: "Filtra por dominio (opcional)" },
            k: { type: "integer", minimum: 1, maximum: 20 },
          },
          required: ["query"],
        },
      },
      async run(args) {
        const query = str(args.query, "query");
        const domain = typeof args.domain === "string" && args.domain ? args.domain : undefined;
        const k = typeof args.k === "number" ? Math.min(20, Math.max(1, Math.floor(args.k))) : 8;
        const memories = ctx.semantic
          ? (await ctx.semantic.search(query, { k, ...(domain ? { domain } : {}) })).map((h) => h.memory)
          : (await ctx.store.search(query, domain ? { domain } : {})).slice(0, k);
        return { results: memories.map(remember) };
      },
    },
    {
      effect: "read",
      spec: {
        name: "get_memory",
        description: "Devuelve una memoria por id, incluida su historia de revisiones (correcciones, retracciones). Sirve para saber si una decisión fue revertida.",
        parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
      async run(args) {
        const memory = await ctx.store.get(str(args.id, "id"));
        if (!memory || memory.status === "deleted") return { error: "No existe o fue eliminada" };
        return {
          ...remember(memory),
          history: memory.revisions.map((r) => ({ at: r.at, by: r.by, change: r.change, reason: r.reason, previousStatement: r.previousStatement })),
        };
      },
    },
    {
      effect: "read",
      spec: {
        name: "memory_as_of",
        description: "Estado de una memoria en una fecha pasada (ISO 8601). Para preguntas históricas.",
        parameters: { type: "object", properties: { id: { type: "string" }, date: { type: "string" } }, required: ["id", "date"] },
      },
      async run(args) {
        const id = str(args.id, "id");
        const date = str(args.date, "date");
        if (Number.isNaN(Date.parse(date))) throw new Error("Fecha inválida");
        const memory = await ctx.store.get(id);
        if (!memory || memory.status === "deleted") return { error: "No existe o fue eliminada" };
        remember(memory);
        return { id, date, state: (await ctx.store.asOf(id, date)) ?? "no existía en esa fecha" };
      },
    },
    {
      effect: "read",
      spec: {
        name: "list_domains",
        description: "Lista los dominios con memorias activas, cuántas tienen y la fecha de su fuente más reciente.",
        parameters: { type: "object", properties: {} },
      },
      async run() {
        const domains = new Map<string, { active: number; latestSource: string | null }>();
        for (const m of await ctx.store.all()) {
          const d = domains.get(m.domain) ?? { active: 0, latestSource: null };
          d.active++;
          for (const s of m.sources) {
            const ref = s.version ?? s.capturedAt;
            if (!d.latestSource || ref > d.latestSource) d.latestSource = ref;
          }
          domains.set(m.domain, d);
        }
        return { domains: [...domains.entries()].map(([domain, d]) => ({ domain, ...d })) };
      },
    },
    {
      effect: "propose",
      spec: {
        name: "propose_vault_change",
        description:
          "Propone un cambio Markdown para el Vault de Obsidian. NO lo aplica: queda en cola para revisión humana. Para una nota existente indica `sourceId` (su versión importada será la base); sin él, la nota debe ser nueva.",
        parameters: {
          type: "object",
          properties: {
            notePath: { type: "string", description: "Ruta relativa al Vault" },
            sourceId: { type: "string" },
            proposedContent: { type: "string", description: "Contenido completo propuesto de la nota" },
            rationale: { type: "string" },
          },
          required: ["notePath", "proposedContent", "rationale"],
        },
      },
      async run(args) {
        const notePath = str(args.notePath, "notePath");
        const proposedContent = str(args.proposedContent, "proposedContent");
        const rationale = str(args.rationale, "rationale");
        let baseHash: string | null = null;
        if (typeof args.sourceId === "string" && args.sourceId) {
          const sources = (await ctx.store.all({ includeInactive: true }))
            .flatMap((m) => m.sources)
            .filter((s) => s.sourceId === args.sourceId)
            .sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
          if (!sources[0]) throw new Error(`Fuente desconocida: ${args.sourceId}`);
          baseHash = sources[0].contentHash;
        }
        const proposal = { ...createProposal({ notePath, baseContent: null, proposedContent, rationale, now: ctx.now() }), baseHash };
        ctx.session.proposals.push(proposal);
        return { queued: true, notePath, status: "pendiente de revisión humana" };
      },
    },
  ];
}
