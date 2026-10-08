import type { MemoryStore } from "../core/store.js";
import { forgetMemory } from "./forget.js";
import type { BriefingRepository } from "./repository.js";

/** Elimina (con purga completa) toda memoria cuyas fuentes son todas sintéticas. */
export async function purgeSynthetic(deps: { store: MemoryStore; briefings: BriefingRepository }): Promise<{ deleted: number }> {
  let deleted = 0;
  for (const m of await deps.store.all({ includeInactive: true })) {
    if (m.status === "deleted" || m.sources.length === 0 || !m.sources.every((s) => s.synthetic)) continue;
    await forgetMemory(deps, m.id, "Limpieza de datos sintéticos de prueba");
    deleted++;
  }
  return { deleted };
}
