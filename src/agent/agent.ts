import { assessFreshness, type Freshness } from "../core/freshness.js";
import type { MarkdownProposal } from "../core/proposals.js";
import type { Epistemic } from "../core/types.js";
import type { ChatMessage, ChatModel } from "./model.js";
import type { AgentSession, AgentTool, ToolEffect } from "./tools.js";

export interface AutonomyPolicy {
  /** Efectos que el agente puede ejecutar sin pedir permiso. */
  allowedEffects: ToolEffect[];
  maxSteps: number;
  maxToolCalls: number;
}

/** Autónomo para leer y proponer; nada se aplica al Vault sin revisión. */
export const DEFAULT_POLICY: AutonomyPolicy = { allowedEffects: ["read", "propose"], maxSteps: 8, maxToolCalls: 16 };

export interface Citation {
  memoryId: string;
  statement: string;
  sourceId: string;
  path: string;
  anchor?: string;
  version?: string;
  freshness: Freshness;
}

export interface Claim {
  text: string;
  kind: Epistemic;
  citations: Citation[];
}

export interface AgentAnswer {
  answer: string;
  claims: Claim[];
  /** Lo que el agente no pudo responder con evidencia. */
  gaps: string[];
  /** Avisos añadidos por el sistema (fuentes antiguas, sintéticas, etc.). */
  warnings: string[];
  proposals: MarkdownProposal[];
  stoppedBy: "answer" | "budget" | "invalid";
  trace: Array<{ step: number; tool?: string; args?: string; error?: string }>;
  usage: { inputTokens: number; outputTokens: number };
}

const SYSTEM = `Eres el agente del Personal Intelligence System de una sola persona.
Reglas:
- Responde SOLO con información obtenida de las herramientas. Nunca inventes estado de proyectos.
- Busca antes de responder; si la pregunta es histórica o sobre decisiones revertidas, revisa la historia (get_memory / memory_as_of).
- Distingue: fact (lo que dice una fuente), inference (deducción tuya), recommendation (próximo paso sugerido).
- Cada fact debe citar al menos un memoryId devuelto por una herramienta. Inferencias y recomendaciones citan la evidencia en que se apoyan.
- Si falta información, dilo en "gaps"; no rellenes.
- Obsidian es la autoridad: si algo debería cambiar en el Vault, usa propose_vault_change (queda para revisión humana).
- Responde en el idioma de la pregunta.
Cuando termines, responde SOLO con JSON:
{"answer": "...", "claims": [{"text": "...", "kind": "fact|inference|recommendation", "memoryIds": ["..."]}], "gaps": ["..."]}`;

interface RawAnswer {
  answer: string;
  claims: Array<{ text: string; kind: Epistemic; memoryIds: string[] }>;
  gaps: string[];
}

function parseAnswer(content: string): RawAnswer | string {
  const json = content.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return "La respuesta final no es JSON válido.";
  }
  const d = data as Partial<RawAnswer>;
  if (typeof d.answer !== "string" || !Array.isArray(d.claims)) return "Faltan `answer` o `claims`.";
  for (const c of d.claims) {
    if (typeof c?.text !== "string" || !["fact", "inference", "recommendation"].includes(c.kind) || !Array.isArray(c.memoryIds)) {
      return "Cada claim necesita text, kind (fact|inference|recommendation) y memoryIds.";
    }
  }
  return { answer: d.answer, claims: d.claims, gaps: Array.isArray(d.gaps) ? d.gaps.filter((g) => typeof g === "string") : [] };
}

export async function runAgent(input: {
  model: ChatModel;
  tools: AgentTool[];
  session: AgentSession;
  question: string;
  now: () => Date;
  policy?: AutonomyPolicy;
}): Promise<AgentAnswer> {
  const policy = input.policy ?? DEFAULT_POLICY;
  const tools = input.tools.filter((t) => policy.allowedEffects.includes(t.effect));
  const byName = new Map(tools.map((t) => [t.spec.name, t]));
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: input.question },
  ];
  const trace: AgentAnswer["trace"] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let toolCalls = 0;
  let repaired = false;

  const finish = (partial: Pick<AgentAnswer, "answer" | "claims" | "gaps" | "warnings" | "stoppedBy">): AgentAnswer => ({
    ...partial,
    proposals: input.session.proposals,
    trace,
    usage,
  });

  for (let step = 1; step <= policy.maxSteps; step++) {
    const turn = await input.model.complete(messages, tools.map((t) => t.spec));
    if (turn.usage) {
      usage.inputTokens += turn.usage.inputTokens;
      usage.outputTokens += turn.usage.outputTokens;
    }

    if (turn.toolCalls.length) {
      messages.push({ role: "assistant", content: turn.content, toolCalls: turn.toolCalls });
      for (const call of turn.toolCalls) {
        toolCalls++;
        let result: unknown;
        const tool = byName.get(call.name);
        if (toolCalls > policy.maxToolCalls) result = { error: "Límite de llamadas alcanzado; responde con lo que tienes." };
        else if (!tool) result = { error: `Herramienta no permitida: ${call.name}` };
        else {
          try {
            result = await tool.run(JSON.parse(call.arguments || "{}") as Record<string, unknown>);
          } catch (error) {
            result = { error: error instanceof Error ? error.message : String(error) };
          }
        }
        const error = (result as { error?: string }).error;
        trace.push({ step, tool: call.name, args: call.arguments, ...(error ? { error } : {}) });
        messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(result) });
      }
      continue;
    }

    const parsed = parseAnswer(turn.content ?? "");
    const problem = typeof parsed === "string" ? parsed : validate(parsed, input.session);
    if (problem) {
      trace.push({ step, error: problem });
      if (repaired) {
        return finish({ answer: "No pude producir una respuesta verificable con la evidencia disponible.", claims: [], gaps: [input.question], warnings: [problem], stoppedBy: "invalid" });
      }
      repaired = true;
      messages.push({ role: "assistant", content: turn.content });
      messages.push({ role: "user", content: `Respuesta rechazada: ${problem} Corrígela usando solo memoryIds devueltos por las herramientas.` });
      continue;
    }

    const raw = parsed as RawAnswer;
    const now = input.now();
    const warnings = new Set<string>();
    const claims: Claim[] = raw.claims.map((c) => ({
      text: c.text,
      kind: c.kind,
      citations: c.memoryIds.map((id) => {
        const m = input.session.seen.get(id)!;
        const freshness = assessFreshness(m, now);
        const s = m.sources.at(-1);
        if (freshness === "stale") warnings.add(`Fuente antigua: ${s?.path ?? id}; verifica antes de actuar.`);
        if (freshness === "synthetic") warnings.add("Respuesta basada en datos sintéticos.");
        if (freshness === "no-source") warnings.add(`Memoria sin fuente: ${id}.`);
        return {
          memoryId: id,
          statement: m.statement,
          sourceId: s?.sourceId ?? "",
          path: s?.path ?? "",
          ...(s?.anchor ? { anchor: s.anchor } : {}),
          ...(s?.version ? { version: s.version } : {}),
          freshness,
        };
      }),
    }));
    return finish({ answer: raw.answer, claims, gaps: raw.gaps, warnings: [...warnings], stoppedBy: "answer" });
  }

  return finish({
    answer: "Me quedé sin presupuesto de pasos antes de llegar a una respuesta verificable.",
    claims: [],
    gaps: [input.question],
    warnings: [],
    stoppedBy: "budget",
  });
}

function validate(answer: RawAnswer, session: AgentSession): string | null {
  for (const c of answer.claims) {
    const unknown = c.memoryIds.filter((id) => !session.seen.has(id));
    if (unknown.length) return `Cita memorias que no vienen de ninguna herramienta: ${unknown.join(", ")}.`;
    if (c.kind === "fact" && c.memoryIds.length === 0) return `El hecho «${c.text}» no cita evidencia.`;
  }
  return null;
}
