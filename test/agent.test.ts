import { beforeEach, describe, expect, it } from "vitest";
import { runAgent } from "../src/agent/agent.js";
import type { ChatMessage, ChatModel, ModelTurn, ToolSpec } from "../src/agent/model.js";
import { OpenAIChatModel } from "../src/agent/openai-chat.js";
import { AgentSession, buildTools } from "../src/agent/tools.js";
import { sha256 } from "../src/core/hash.js";
import { extractDrafts } from "../src/core/importer.js";
import { InMemoryRepository } from "../src/core/in-memory-repository.js";
import { MemoryStore } from "../src/core/store.js";
import { entry } from "./helpers.js";

const NOW = new Date("2026-10-07T12:00:00Z");
const NOTE = `---
domain: alfa
updated: 2026-10-01
---
## Decisiones
- Usar pagos mensuales en lugar de anuales
## Estado
- Landing page terminada
`;

/** Modelo guionizado: cada turno es una función de la conversación hasta ahora. */
class ScriptedModel implements ChatModel {
  readonly name = "scripted";
  readonly seenTools: string[][] = [];
  constructor(private readonly turns: Array<(messages: ChatMessage[]) => ModelTurn>) {}
  async complete(messages: ChatMessage[], tools: ToolSpec[]): Promise<ModelTurn> {
    this.seenTools.push(tools.map((t) => t.name));
    const next = this.turns.shift();
    if (!next) throw new Error("Guion agotado");
    return next(messages);
  }
}

const call = (name: string, args: unknown, id = name): ModelTurn => ({ content: null, toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });
const final = (body: unknown): ModelTurn => ({ content: JSON.stringify(body), toolCalls: [] });
/** Id de la primera memoria devuelta por la última herramienta. */
const lastResultId = (messages: ChatMessage[]): string => {
  const tool = [...messages].reverse().find((m) => m.role === "tool") as { content: string };
  return (JSON.parse(tool.content) as { results: Array<{ id: string }> }).results[0]!.id;
};

describe("agente de consultas", () => {
  let store: MemoryStore;
  let session: AgentSession;
  const run = (model: ChatModel, question = "¿Qué decidimos del pricing de Alfa?", policy?: Parameters<typeof runAgent>[0]["policy"]) =>
    runAgent({ model, tools: buildTools({ store, now: () => NOW, session }), session, question, now: () => NOW, ...(policy ? { policy } : {}) });

  beforeEach(async () => {
    store = new MemoryStore(new InMemoryRepository());
    session = new AgentSession();
    const e = entry({ id: "alfa", path: "alfa.md", sha256: sha256(NOTE), synthetic: false, capturedAt: "2026-10-06T00:00:00Z" });
    await store.importSource("alfa", extractDrafts("alfa.md", NOTE, e));
  });

  it("busca, responde y cita con procedencia", async () => {
    const answer = await run(
      new ScriptedModel([
        () => call("search_memories", { query: "pricing pagos" }),
        (m) => final({ answer: "Pagos mensuales.", claims: [{ text: "Se decidió usar pagos mensuales", kind: "fact", memoryIds: [lastResultId(m)] }], gaps: [] }),
      ]),
    );
    expect(answer.stoppedBy).toBe("answer");
    expect(answer.claims[0]?.citations[0]).toMatchObject({ sourceId: "alfa", path: "alfa.md", anchor: "Decisiones", freshness: "current" });
    expect(answer.trace.map((t) => t.tool)).toEqual(["search_memories"]);
  });

  it("rechaza citas inventadas y acepta la corrección", async () => {
    const answer = await run(
      new ScriptedModel([
        () => call("search_memories", { query: "pagos" }),
        () => final({ answer: "x", claims: [{ text: "x", kind: "fact", memoryIds: ["inventado"] }], gaps: [] }),
        (m) => {
          const tool = m.find((x) => x.role === "tool") as { content: string };
          const id = (JSON.parse(tool.content) as { results: Array<{ id: string }> }).results[0]!.id;
          return final({ answer: "Pagos mensuales.", claims: [{ text: "Pagos mensuales", kind: "fact", memoryIds: [id] }], gaps: [] });
        },
      ]),
    );
    expect(answer.stoppedBy).toBe("answer");
    expect(answer.trace.some((t) => t.error?.includes("inventado"))).toBe(true);
  });

  it("si insiste en algo no verificable, no devuelve afirmaciones", async () => {
    const bad = () => final({ answer: "Seguro que sí", claims: [{ text: "Algo", kind: "fact", memoryIds: [] }], gaps: [] });
    const answer = await run(new ScriptedModel([bad, bad]));
    expect(answer.stoppedBy).toBe("invalid");
    expect(answer.claims).toEqual([]);
  });

  it("reconoce datos ausentes sin inventar", async () => {
    const answer = await run(
      new ScriptedModel([() => call("search_memories", { query: "proyecto gamma" }), () => final({ answer: "No tengo información sobre Gamma.", claims: [], gaps: ["Estado de Gamma"] })]),
      "¿Cómo va Gamma?",
    );
    expect(answer.claims).toEqual([]);
    expect(answer.gaps).toEqual(["Estado de Gamma"]);
  });

  it("avisa cuando la evidencia es antigua", async () => {
    const old = NOTE.replace("updated: 2026-10-01", "updated: 2026-06-01").replace("mensuales", "trimestrales");
    await store.importSource("viejo", extractDrafts("viejo.md", old, entry({ id: "viejo", path: "viejo.md", sha256: sha256(old), synthetic: false, capturedAt: "2026-10-06T00:00:00Z" })));
    const answer = await run(
      new ScriptedModel([
        () => call("search_memories", { query: "trimestrales" }),
        (m) => final({ answer: "Trimestrales.", claims: [{ text: "Pagos trimestrales", kind: "fact", memoryIds: [lastResultId(m)] }], gaps: [] }),
      ]),
    );
    expect(answer.warnings.some((w) => w.includes("viejo.md"))).toBe(true);
  });

  it("revisa la historia de decisiones corregidas", async () => {
    const m = (await store.search("pagos"))[0]!;
    await store.correct(m.id, "Usar pagos anuales", "cambio de estrategia");
    const answer = await run(
      new ScriptedModel([
        () => call("search_memories", { query: "pagos" }),
        (msgs) => call("get_memory", { id: lastResultId(msgs) }),
        (msgs) => {
          const detail = JSON.parse((msgs.at(-1) as { content: string }).content) as { id: string; history: Array<{ change: string }> };
          expect(detail.history.map((h) => h.change)).toEqual(["create", "correct"]);
          return final({ answer: "Ahora anuales; antes mensuales.", claims: [{ text: "Se corrigió a pagos anuales", kind: "fact", memoryIds: [detail.id] }], gaps: [] });
        },
      ]),
    );
    expect(answer.stoppedBy).toBe("answer");
  });

  it("propone cambios al Vault sin aplicarlos, con la versión importada como base", async () => {
    const answer = await run(
      new ScriptedModel([
        () => call("propose_vault_change", { notePath: "02 Areas/Projects/alfa.md", sourceId: "alfa", proposedContent: "# Alfa\n", rationale: "Landing terminada" }),
        () => final({ answer: "Dejé una propuesta para revisar.", claims: [], gaps: [] }),
      ]),
    );
    expect(answer.proposals).toHaveLength(1);
    expect(answer.proposals[0]?.baseHash).toBe(sha256(NOTE));
  });

  it("la política limita herramientas y pasos", async () => {
    const readOnly = new ScriptedModel([() => call("propose_vault_change", { notePath: "x.md", proposedContent: "x", rationale: "r" }), () => final({ answer: "ok", claims: [], gaps: [] })]);
    const a = await run(readOnly, "q", { allowedEffects: ["read"], maxSteps: 4, maxToolCalls: 4 });
    expect(readOnly.seenTools[0]).not.toContain("propose_vault_change");
    expect(a.trace[0]?.error).toContain("no permitida");
    expect(a.proposals).toHaveLength(0);

    const loop = new ScriptedModel(Array.from({ length: 3 }, () => () => call("list_domains", {})));
    expect((await run(loop, "q", { allowedEffects: ["read"], maxSteps: 3, maxToolCalls: 10 })).stoppedBy).toBe("budget");
  });

  it("los errores de herramientas vuelven al modelo en vez de romper", async () => {
    const answer = await run(
      new ScriptedModel([
        () => ({ content: null, toolCalls: [{ id: "1", name: "search_memories", arguments: "{no json" }] }),
        () => call("memory_as_of", { id: "x", date: "no-fecha" }),
        () => final({ answer: "Sin datos.", claims: [], gaps: ["todo"] }),
      ]),
    );
    expect(answer.trace.filter((t) => t.error)).toHaveLength(2);
    expect(answer.stoppedBy).toBe("answer");
  });
});

describe("OpenAIChatModel", () => {
  it("traduce mensajes y herramientas, y lee tool_calls y uso", async () => {
    let sent: Record<string, unknown> = {};
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: null, tool_calls: [{ id: "c1", function: { name: "search_memories", arguments: '{"query":"x"}' } }] } }],
          usage: { prompt_tokens: 10, completion_tokens: 3 },
        }),
      );
    }) as typeof fetch;
    const model = new OpenAIChatModel("sk-test", "modelo-configurado", fakeFetch);
    const turn = await model.complete(
      [
        { role: "user", content: "hola" },
        { role: "assistant", content: null, toolCalls: [{ id: "a", name: "list_domains", arguments: "{}" }] },
        { role: "tool", toolCallId: "a", content: "{}" },
      ],
      [{ name: "search_memories", description: "d", parameters: { type: "object" } }],
    );
    expect(turn).toEqual({ content: null, toolCalls: [{ id: "c1", name: "search_memories", arguments: '{"query":"x"}' }], usage: { inputTokens: 10, outputTokens: 3 } });
    expect(sent.model).toBe("modelo-configurado");
    expect((sent.messages as unknown[])[2]).toEqual({ role: "tool", tool_call_id: "a", content: "{}" });
    expect((sent.tools as Array<{ function: { name: string } }>)[0]?.function.name).toBe("search_memories");
  });

  it("falla con errores HTTP", async () => {
    const failing = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    await expect(new OpenAIChatModel("k", "m", failing).complete([], [])).rejects.toThrow("500");
  });
});
