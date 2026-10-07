import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AgentSession, buildTools, type AgentTool } from "../agent/tools.js";
import type { BriefingRepository } from "../briefing/repository.js";
import { assessFreshness } from "../core/freshness.js";
import type { SemanticSearch } from "../core/semantic.js";
import type { MemoryStore } from "../core/store.js";

export interface McpDeps {
  store: MemoryStore;
  now: () => Date;
  semantic?: SemanticSearch;
  briefings?: BriefingRepository;
}

const INSTRUCTIONS = `Memoria personal con procedencia (Personal Intelligence System).
- Responde solo con lo que devuelvan estas herramientas y cita los memoryId.
- Distingue hecho (lo que dice la fuente), inferencia y recomendación.
- Si freshness es "stale", "synthetic" o "no-source", dilo; no lo presentes como actual.
- Antes de responder, verifica tus citas con check_citations.
- Si algo no está en la memoria, dilo: no lo inventes.`;

/**
 * Servidor MCP de solo lectura sobre la memoria. Expone las mismas
 * herramientas de lectura que el agente interno, más verificación de citas y
 * el briefing del día. No escribe nada.
 */
export function createMcpServer(deps: McpDeps): Server {
  const server = new Server({ name: "personal-intelligence-system", version: "0.1.0" }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });

  const extra: AgentTool[] = [
    {
      effect: "read",
      spec: {
        name: "check_citations",
        description: "Verifica una lista de memoryId antes de citarlos: si existen, si siguen activos, su frescura y su fuente.",
        parameters: { type: "object", properties: { memoryIds: { type: "array", items: { type: "string" }, maxItems: 50 } }, required: ["memoryIds"] },
      },
      async run(args) {
        const ids = Array.isArray(args.memoryIds) ? args.memoryIds.filter((x): x is string => typeof x === "string").slice(0, 50) : [];
        const now = deps.now();
        const results = [];
        for (const id of ids) {
          const m = await deps.store.get(id);
          if (!m || m.status === "deleted") {
            results.push({ id, valid: false, reason: "no existe o fue eliminada" });
            continue;
          }
          const s = m.sources.at(-1);
          results.push({
            id,
            valid: m.status === "active",
            status: m.status,
            freshness: assessFreshness(m, now),
            statement: m.statement,
            source: s ? { sourceId: s.sourceId, path: s.path, anchor: s.anchor, version: s.version } : null,
          });
        }
        return { results };
      },
    },
  ];
  if (deps.briefings) {
    const briefings = deps.briefings;
    extra.push({
      effect: "read",
      spec: {
        name: "get_briefing",
        description: "Devuelve el briefing de Today de una fecha (YYYY-MM-DD) o el más reciente.",
        parameters: { type: "object", properties: { date: { type: "string" } } },
      },
      async run(args) {
        const b = typeof args.date === "string" && args.date ? await briefings.get(args.date) : (await briefings.recent(1))[0];
        return b ?? { error: "No hay briefing para esa fecha" };
      },
    });
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [...readTools(deps), ...extra];
    return {
      tools: tools.map((t) => ({ name: t.spec.name, description: t.spec.description, inputSchema: t.spec.parameters as { type: "object" }, annotations: { readOnlyHint: true } })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // Cada llamada usa su propia sesión: las citas se verifican con check_citations.
    const tool = [...readTools(deps), ...extra].find((t) => t.spec.name === request.params.name);
    if (!tool) return { isError: true, content: [{ type: "text" as const, text: `Herramienta desconocida: ${request.params.name}` }] };
    try {
      const result = await tool.run((request.params.arguments ?? {}) as Record<string, unknown>);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] };
    }
  });

  return server;
}

function readTools(deps: McpDeps): AgentTool[] {
  const session = new AgentSession();
  return buildTools({ store: deps.store, now: deps.now, session, ...(deps.semantic ? { semantic: deps.semantic } : {}) }).filter((t) => t.effect === "read");
}
