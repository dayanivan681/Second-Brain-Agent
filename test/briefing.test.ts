import { describe, expect, it } from "vitest";
import type { ChatMessage, ChatModel, ModelTurn } from "../src/agent/model.js";
import { generateBriefing } from "../src/briefing/briefing.js";
import { localDate, StaticCalendar, type CalendarSource } from "../src/briefing/calendar.js";
import { forgetMemory } from "../src/briefing/forget.js";
import { InMemoryBriefingRepository, PostgresBriefingRepository, type BriefingRepository } from "../src/briefing/repository.js";
import { recordFeedback, runDailyBriefing, usefulness } from "../src/briefing/routine.js";
import { sha256 } from "../src/core/hash.js";
import { extractDrafts } from "../src/core/importer.js";
import { InMemoryRepository } from "../src/core/in-memory-repository.js";
import { MemoryStore } from "../src/core/store.js";
import { entry, fakeClock } from "./helpers.js";
import { freshDatabase } from "./repositories.js";

const NOTE = `---
domain: alfa
updated: 2026-10-01
---
## Objetivos
- Publicar la beta antes del 30 de noviembre
## Estado
- Onboarding en progreso
`;
const OLD = `---
domain: beta
updated: 2026-06-01
---
## Estado
- Entrevistas 2 de 5
`;

async function seed(clock: () => Date) {
  const store = new MemoryStore(new InMemoryRepository(), clock);
  for (const [id, note] of [["alfa", NOTE], ["beta", OLD]] as const) {
    await store.importSource(id, extractDrafts(`${id}.md`, note, entry({ id, path: `${id}.md`, sha256: sha256(note), synthetic: false, capturedAt: "2026-10-06T00:00:00Z" })));
  }
  return store;
}

/** Modelo que busca el objetivo y lo propone como prioridad citándolo. */
const prioritizer = (): ChatModel => {
  const turns: Array<(m: ChatMessage[]) => ModelTurn> = [
    () => ({ content: null, toolCalls: [{ id: "1", name: "search_memories", arguments: '{"query":"beta noviembre"}' }] }),
    (m) => {
      const id = (JSON.parse((m.at(-1) as { content: string }).content) as { results: Array<{ id: string }> }).results[0]!.id;
      return { content: JSON.stringify({ answer: "Hoy: avanzar hacia la beta.", claims: [{ text: "Terminar el onboarding", kind: "recommendation", memoryIds: [id] }], gaps: [] }), toolCalls: [], usage: { inputTokens: 100, outputTokens: 20 } };
    },
  ];
  return { name: "scripted", complete: async (m) => turns.shift()!(m) };
};

const CAL = new StaticCalendar([
  { id: "e1", title: "Llamada", start: "2026-10-07T14:00:00Z" },
  { id: "e2", title: "Mañana", start: "2026-10-08T14:00:00Z" },
  { id: "e3", title: "Festivo", start: "2026-10-07", allDay: true },
]);

describe("generateBriefing", () => {
  it("arma agenda, objetivos, cambios, fuentes antiguas y prioridades citadas", async () => {
    const clock = fakeClock("2026-10-07T10:00:00Z");
    const store = await seed(clock);
    const b = await generateBriefing({ store, now: clock, timeZone: "UTC", calendar: CAL, model: prioritizer() });
    expect(b.date).toBe("2026-10-07");
    expect(b.agenda.map((e) => e.id)).toEqual(["e3", "e1"]);
    expect(b.goals.map((g) => g.statement)).toEqual(["Publicar la beta antes del 30 de noviembre"]);
    expect(b.changes.length).toBe(3);
    expect(b.staleSources).toEqual([{ sourceId: "beta", path: "beta.md", domain: "beta" }]);
    expect(b.priorities?.[0]).toMatchObject({ kind: "recommendation", citations: [{ sourceId: "alfa" }] });
    expect(b.health).toEqual({ calendar: "ok", model: "ok" });
    expect(b.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  it("sin modelo ni calendario sigue entregando lo determinista", async () => {
    const clock = fakeClock("2026-10-07T10:00:00Z");
    const b = await generateBriefing({ store: await seed(clock), now: clock, timeZone: "UTC" });
    expect(b.priorities).toBeNull();
    expect(b.health).toEqual({ calendar: "not-configured", model: "not-configured" });
    expect(b.goals).toHaveLength(1);
  });

  it("los fallos se muestran sin tumbar el briefing", async () => {
    const clock = fakeClock("2026-10-07T10:00:00Z");
    const broken: CalendarSource = { name: "google", eventsOn: async () => { throw new Error("token caducado"); } };
    const failing: ChatModel = { name: "x", complete: async () => { throw new Error("HTTP 429"); } };
    const b = await generateBriefing({ store: await seed(clock), now: clock, timeZone: "UTC", calendar: broken, model: failing });
    expect(b.health).toEqual({ calendar: "error", model: "error" });
    expect(b.warnings.join(" ")).toMatch(/token caducado.*HTTP 429/);
    expect(b.goals).toHaveLength(1);
  });

  it("usa la fecha local de la zona horaria", () => {
    expect(localDate(new Date("2026-10-08T02:00:00Z"), "America/New_York")).toBe("2026-10-07");
  });
});

describe.each([
  ["en memoria", async () => new InMemoryBriefingRepository() as BriefingRepository],
  ["postgres (PGlite)", async () => new PostgresBriefingRepository(await freshDatabase()) as BriefingRepository],
])("rutina diaria — %s", (_name, makeRepo) => {
  it("es idempotente por día, cuenta cambios desde el anterior y conserva la valoración", async () => {
    const repo = await makeRepo();
    const clock = fakeClock("2026-10-07T10:00:00Z");
    const store = await seed(clock);
    const first = await runDailyBriefing({ repo, store, now: clock, timeZone: "UTC" });
    expect(first.created).toBe(true);
    expect((await runDailyBriefing({ repo, store, now: clock, timeZone: "UTC" })).created).toBe(false);

    await recordFeedback(repo, "2026-10-07", true, "útil", clock());
    const forced = await runDailyBriefing({ repo, store, now: clock, timeZone: "UTC", force: true });
    expect(forced.briefing.feedback?.useful).toBe(true);

    clock.advanceDays(1);
    const m = (await store.search("onboarding"))[0]!;
    await store.correct(m.id, "Onboarding terminado", "avance");
    const next = await runDailyBriefing({ repo, store, now: clock, timeZone: "UTC" });
    expect(next.briefing.changes.map((c) => c.change)).toEqual(["correct"]);
  });

  it("mide el criterio de 8 de 10 días laborables útiles", async () => {
    const repo = await makeRepo();
    const clock = fakeClock("2026-09-21T10:00:00Z"); // lunes
    const store = new MemoryStore(new InMemoryRepository(), clock);
    let rated = 0;
    for (let i = 0; i < 14; i++) {
      const { briefing } = await runDailyBriefing({ repo, store, now: clock, timeZone: "UTC" });
      const day = new Date(`${briefing.date}T12:00:00Z`).getUTCDay();
      if (day !== 0 && day !== 6) await recordFeedback(repo, briefing.date, rated++ % 5 !== 0, undefined, clock());
      clock.advanceDays(1);
    }
    const stats = await usefulness(repo);
    expect(stats.rated).toBe(10);
    expect(stats.useful).toBe(8);
    expect(stats.meetsTarget).toBe(true);
  });

  it("olvidar una memoria la borra también de los briefings guardados", async () => {
    const repo = await makeRepo();
    const clock = fakeClock("2026-10-07T10:00:00Z");
    const store = await seed(clock);
    await runDailyBriefing({ repo, store, now: clock, timeZone: "UTC", model: prioritizer() });
    const goal = (await store.search("beta noviembre"))[0]!;
    expect(await forgetMemory({ store, briefings: repo }, goal.id, "petición del usuario")).toEqual({ briefingsRedacted: 1 });
    const saved = JSON.stringify(await repo.get("2026-10-07"));
    expect(saved).not.toContain("Publicar la beta");
    expect(saved).not.toContain("avanzar hacia la beta");
  });
});
