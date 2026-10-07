import type { Memory } from "./types.js";

export type Freshness = "current" | "stale" | "no-source" | "synthetic";

export interface FreshnessPolicy {
  /** Días tras los cuales una fuente se considera antigua. */
  maxAgeDays: number;
}

export const DEFAULT_FRESHNESS: FreshnessPolicy = { maxAgeDays: 30 };

/**
 * Las respuestas deben mostrar esta marca: nada `stale`, `no-source` o
 * `synthetic` se presenta como información actual.
 */
export function assessFreshness(memory: Memory, now: Date, policy: FreshnessPolicy = DEFAULT_FRESHNESS): Freshness {
  const latest = memory.sources.at(-1);
  if (!latest) return "no-source";
  if (latest.synthetic) return "synthetic";
  // Una nota capturada hoy pero editada hace meses sigue siendo antigua.
  const versionTime = latest.version ? Date.parse(latest.version) : NaN;
  const reference = Number.isNaN(versionTime) ? Date.parse(latest.capturedAt) : Math.min(versionTime, Date.parse(latest.capturedAt));
  const ageDays = (now.getTime() - reference) / 86_400_000;
  return ageDays > policy.maxAgeDays ? "stale" : "current";
}
