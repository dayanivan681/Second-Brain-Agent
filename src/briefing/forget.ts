import type { MemoryStore } from "../core/store.js";
import { redactMemory, type BriefingRepository } from "./repository.js";

/**
 * Eliminación completa: la memoria (texto e historia), su embedding (trigger en
 * Postgres o el próximo `sync`) y su rastro en los briefings guardados.
 * Toda eliminación pedida por el usuario debe pasar por aquí.
 */
export async function forgetMemory(deps: { store: MemoryStore; briefings: BriefingRepository }, id: string, reason: string): Promise<{ briefingsRedacted: number }> {
  await deps.store.delete(id, reason);
  const dates = await deps.briefings.datesMentioning(id);
  for (const date of dates) {
    const b = await deps.briefings.get(date);
    if (b) await deps.briefings.save(redactMemory(b, id));
  }
  return { briefingsRedacted: dates.length };
}
