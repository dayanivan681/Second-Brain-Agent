export interface EvalQuestion {
  id: string;
  question: string;
  lang: "es" | "en" | "spanglish";
  /** current = estado actual; historical = estado en una fecha pasada. */
  kind: "current" | "historical" | "correction" | "reverted-decision" | "deletion" | "permissions" | "missing-data";
  expected: string;
  /** sourceIds que deben citarse como evidencia. */
  evidence: string[];
  critical: boolean;
  synthetic: boolean;
}

export interface EvalResult {
  questionId: string;
  correct: boolean;
  citedEvidence: string[];
}

export interface EvalSummary {
  total: number;
  correctWithEvidence: number;
  accuracy: number;
  criticalFailures: string[];
  passed: boolean;
  /** Una evaluación con preguntas sintéticas nunca aprueba la fase real. */
  syntheticOnly: boolean;
}

export const ACCURACY_THRESHOLD = 0.9;

export function scoreEvaluation(questions: EvalQuestion[], results: EvalResult[]): EvalSummary {
  const byId = new Map(results.map((r) => [r.questionId, r]));
  let correctWithEvidence = 0;
  const criticalFailures: string[] = [];
  for (const q of questions) {
    const r = byId.get(q.id);
    const ok = !!r && r.correct && q.evidence.every((e) => r.citedEvidence.includes(e));
    if (ok) correctWithEvidence++;
    else if (q.critical) criticalFailures.push(q.id);
  }
  const total = questions.length;
  const accuracy = total === 0 ? 0 : correctWithEvidence / total;
  const syntheticOnly = total > 0 && questions.every((q) => q.synthetic);
  return {
    total,
    correctWithEvidence,
    accuracy,
    criticalFailures,
    passed: total > 0 && accuracy >= ACCURACY_THRESHOLD && criticalFailures.length === 0 && !syntheticOnly,
    syntheticOnly,
  };
}
