import type { EvalQuestion } from "./evaluation.js";
import type { SemanticSearch } from "./semantic.js";

export interface LabeledCandidate {
  similarity: number;
  relevant: boolean;
}

export interface ThresholdChoice {
  threshold: number;
  precision: number;
  recall: number;
  f1: number;
  /** Candidatos usados: relevantes / total. */
  relevant: number;
  total: number;
}

/**
 * Recoge los vecinos vectoriales de cada pregunta de evaluación y los etiqueta:
 * relevante si la memoria cita alguna fuente de `evidence`. Las preguntas sin
 * evidencia (datos ausentes) aportan solo negativos: idealmente nada debe pasar.
 */
export async function collectCandidates(search: SemanticSearch, questions: EvalQuestion[], k = 10): Promise<LabeledCandidate[]> {
  const out: LabeledCandidate[] = [];
  for (const q of questions) {
    const hits = await search.search(q.question, { k, minSimilarity: -1 });
    for (const hit of hits) {
      if (hit.similarity === undefined) continue;
      out.push({ similarity: hit.similarity, relevant: hit.memory.sources.some((s) => q.evidence.includes(s.sourceId)) });
    }
  }
  return out;
}

/** Umbral (similitud ≥ umbral) que maximiza F1; en empate, el más alto. */
export function chooseThreshold(candidates: LabeledCandidate[]): ThresholdChoice | null {
  const relevant = candidates.filter((c) => c.relevant).length;
  if (relevant === 0) return null;
  const thresholds = [...new Set(candidates.map((c) => c.similarity))].sort((a, b) => b - a);
  let best: ThresholdChoice | null = null;
  for (const threshold of thresholds) {
    const kept = candidates.filter((c) => c.similarity >= threshold);
    const tp = kept.filter((c) => c.relevant).length;
    const precision = tp / kept.length;
    const recall = tp / relevant;
    const f1 = tp === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    if (!best || f1 > best.f1) best = { threshold, precision, recall, f1, relevant, total: candidates.length };
  }
  return best;
}
