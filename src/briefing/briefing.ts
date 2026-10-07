import { runAgent, type Claim } from "../agent/agent.js";
import type { ChatModel } from "../agent/model.js";
import { AgentSession, buildTools } from "../agent/tools.js";
import { assessFreshness } from "../core/freshness.js";
import type { SemanticSearch } from "../core/semantic.js";
import type { MemoryStore } from "../core/store.js";
import { localDate, type CalendarEvent, type CalendarSource } from "./calendar.js";

export type Health = "ok" | "error" | "not-configured";

export interface BriefingChange {
  memoryId: string;
  domain: string;
  change: string;
  at: string;
  /** Vacío si la memoria se eliminó: no se conserva su texto. */
  statement: string;
}

export interface Briefing {
  date: string;
  timeZone: string;
  generatedAt: string;
  /** Prioridades del agente con citas; null si no hay modelo o falló. */
  priorities: Claim[] | null;
  prioritiesSummary: string | null;
  agenda: CalendarEvent[];
  goals: Array<{ memoryId: string; domain: string; statement: string }>;
  changes: BriefingChange[];
  staleSources: Array<{ sourceId: string; path: string; domain: string }>;
  warnings: string[];
  health: { calendar: Health; model: Health };
  usage: { inputTokens: number; outputTokens: number };
  feedback?: { useful: boolean; note?: string; at: string };
}

export interface BriefingDeps {
  store: MemoryStore;
  now: () => Date;
  timeZone: string;
  calendar?: CalendarSource;
  model?: ChatModel;
  semantic?: SemanticSearch;
  /** Desde cuándo reportar cambios (p. ej. el briefing anterior). Por defecto, 24 h. */
  since?: string;
}

/**
 * Briefing de Today. Las secciones deterministas (agenda, objetivos, cambios,
 * fuentes antiguas) salen siempre; las prioridades las redacta el agente en
 * modo solo lectura. Un fallo de una parte se muestra, no tumba el resto.
 */
export async function generateBriefing(deps: BriefingDeps): Promise<Briefing> {
  const now = deps.now();
  const date = localDate(now, deps.timeZone);
  const since = deps.since ?? new Date(now.getTime() - 86_400_000).toISOString();
  const warnings: string[] = [];
  const health: Briefing["health"] = { calendar: "not-configured", model: "not-configured" };

  let agenda: CalendarEvent[] = [];
  if (deps.calendar) {
    try {
      agenda = await deps.calendar.eventsOn(date, deps.timeZone);
      health.calendar = "ok";
    } catch (error) {
      health.calendar = "error";
      warnings.push(`No se pudo leer el calendario (${deps.calendar.name}): ${message(error)}`);
    }
  }

  const all = await deps.store.all({ includeInactive: true });
  const active = all.filter((m) => m.status === "active");
  const goals = active.filter((m) => m.category === "goal").map((m) => ({ memoryId: m.id, domain: m.domain, statement: m.statement }));

  const changes: BriefingChange[] = all
    .flatMap((m) =>
      m.revisions
        .filter((r) => r.at > since)
        .map((r) => ({ memoryId: m.id, domain: m.domain, change: r.change, at: r.at, statement: m.status === "deleted" ? "" : m.statement })),
    )
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  const stale = new Map<string, { sourceId: string; path: string; domain: string }>();
  for (const m of active) {
    const s = m.sources.at(-1);
    if (s && assessFreshness(m, now) === "stale") stale.set(s.sourceId, { sourceId: s.sourceId, path: s.path, domain: m.domain });
  }
  if (active.some((m) => assessFreshness(m, now) === "synthetic")) warnings.push("Incluye datos sintéticos.");

  let priorities: Claim[] | null = null;
  let prioritiesSummary: string | null = null;
  const usage = { inputTokens: 0, outputTokens: 0 };
  if (deps.model) {
    const session = new AgentSession();
    const agendaText = agenda.length ? agenda.map((e) => `- ${e.allDay ? "todo el día" : e.start}: ${e.title}`).join("\n") : "(sin eventos)";
    try {
      const result = await runAgent({
        model: deps.model,
        tools: buildTools({ store: deps.store, now: deps.now, session, ...(deps.semantic ? { semantic: deps.semantic } : {}) }),
        session,
        now: deps.now,
        policy: { allowedEffects: ["read"], maxSteps: 8, maxToolCalls: 16 },
        question:
          `Prepara el briefing de hoy (${date}). Propón como máximo 3 prioridades, cada una como claim "recommendation" ` +
          `citando las memorias (objetivos, estado, decisiones, reglas) que la justifican. Usa list_domains y search_memories. ` +
          `Si una fuente es antigua, dilo. Agenda de hoy:\n${agendaText}`,
      });
      usage.inputTokens = result.usage.inputTokens;
      usage.outputTokens = result.usage.outputTokens;
      warnings.push(...result.warnings);
      if (result.stoppedBy === "answer") {
        priorities = result.claims;
        prioritiesSummary = result.answer;
        health.model = "ok";
      } else {
        health.model = "error";
        warnings.push(`El agente no produjo prioridades verificables (${result.stoppedBy}).`);
      }
    } catch (error) {
      health.model = "error";
      warnings.push(`Falló el modelo: ${message(error)}`);
    }
  }

  return {
    date,
    timeZone: deps.timeZone,
    generatedAt: now.toISOString(),
    priorities,
    prioritiesSummary,
    agenda,
    goals,
    changes,
    staleSources: [...stale.values()],
    warnings: [...new Set(warnings)],
    health,
    usage,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
