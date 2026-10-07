import { localDate } from "./calendar.js";
import { generateBriefing, type Briefing, type BriefingDeps } from "./briefing.js";
import type { BriefingRepository } from "./repository.js";

/**
 * Rutina diaria: genera y guarda el briefing de hoy una sola vez (idempotente).
 * Los cambios se cuentan desde el briefing anterior.
 */
export async function runDailyBriefing(
  deps: Omit<BriefingDeps, "since"> & { repo: BriefingRepository; force?: boolean },
): Promise<{ briefing: Briefing; created: boolean }> {
  const date = localDate(deps.now(), deps.timeZone);
  const existing = await deps.repo.get(date);
  if (existing && !deps.force) return { briefing: existing, created: false };
  const previous = (await deps.repo.recent(2)).find((b) => b.date < date);
  const briefing = await generateBriefing({ ...deps, ...(previous ? { since: previous.generatedAt } : {}) });
  if (existing?.feedback) briefing.feedback = existing.feedback;
  await deps.repo.save(briefing);
  return { briefing, created: true };
}

export async function recordFeedback(repo: BriefingRepository, date: string, useful: boolean, note?: string, now = new Date()): Promise<Briefing> {
  const briefing = await repo.get(date);
  if (!briefing) throw new Error(`No hay briefing para ${date}`);
  briefing.feedback = { useful, at: now.toISOString(), ...(note ? { note } : {}) };
  await repo.save(briefing);
  return briefing;
}

/**
 * Criterio de aceptación: briefing útil en al menos 8 de los últimos 10 días
 * laborables valorados.
 */
export async function usefulness(repo: BriefingRepository, window = 10): Promise<{ rated: number; useful: number; meetsTarget: boolean }> {
  const weekdays = (await repo.recent(60)).filter((b) => {
    const day = new Date(`${b.date}T12:00:00Z`).getUTCDay();
    return day !== 0 && day !== 6 && b.feedback;
  });
  const lastRated = weekdays.slice(0, window);
  const useful = lastRated.filter((b) => b.feedback!.useful).length;
  return { rated: lastRated.length, useful, meetsTarget: lastRated.length >= window && useful >= Math.ceil(window * 0.8) };
}
