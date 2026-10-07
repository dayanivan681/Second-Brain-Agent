import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assessFreshness } from "../src/core/freshness.js";
import { checkProposal, createProposal } from "../src/core/proposals.js";
import { scoreEvaluation, type EvalQuestion } from "../src/core/evaluation.js";
import type { Memory } from "../src/core/types.js";

function memory(capturedAt: string | null, synthetic = false): Memory {
  return {
    id: "m",
    key: "k",
    domain: "d",
    category: "status",
    epistemic: "fact",
    statement: "s",
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    revisions: [],
    sources: capturedAt ? [{ sourceId: "x", path: "x.md", contentHash: "h", capturedAt, synthetic }] : [],
  };
}

describe("frescura", () => {
  const now = new Date("2026-10-07T00:00:00Z");
  it("marca fuentes antiguas, ausentes y sintéticas", () => {
    expect(assessFreshness(memory("2026-10-01T00:00:00Z"), now)).toBe("current");
    expect(assessFreshness(memory("2026-08-01T00:00:00Z"), now)).toBe("stale");
    expect(assessFreshness(memory(null), now)).toBe("no-source");
    expect(assessFreshness(memory("2026-10-06T00:00:00Z", true), now)).toBe("synthetic");
  });
  it("usa la fecha de versión de la nota si es anterior a la captura", () => {
    const m = memory("2026-10-06T00:00:00Z");
    m.sources[0]!.version = "2026-08-01";
    expect(assessFreshness(m, now)).toBe("stale");
  });
});

describe("propuestas Markdown", () => {
  const base = "# Nota\n\n- a\n";
  const proposal = createProposal({ notePath: "02 Areas/Projects/X.md", baseContent: base, proposedContent: base + "- b\n", rationale: "test" });

  it("limpia si la nota no cambió", () => {
    expect(checkProposal(proposal, base)).toEqual({ status: "clean" });
  });
  it("conflicto si la nota se modificó después de exportar", () => {
    expect(checkProposal(proposal, base + "- editado en el Mac\n").status).toBe("conflict");
  });
  it("conflicto si la nota base desapareció", () => {
    expect(checkProposal(proposal, null).status).toBe("conflict");
  });
  it("detecta propuestas ya aplicadas", () => {
    expect(checkProposal(proposal, base + "- b\n")).toEqual({ status: "already-applied" });
  });
  it("nota nueva: conflicto si alguien la creó entretanto", () => {
    const fresh = createProposal({ notePath: "03 Logs/x.md", baseContent: null, proposedContent: "x", rationale: "t" });
    expect(checkProposal(fresh, null)).toEqual({ status: "new-note" });
    expect(checkProposal(fresh, "otra cosa").status).toBe("conflict");
  });
  it("rechaza rutas no portables", () => {
    expect(() => createProposal({ notePath: "/Users/yo/Vault/x.md", baseContent: null, proposedContent: "", rationale: "" })).toThrow();
  });
});

describe("evaluación", () => {
  const { questions } = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "fixtures", "synthetic", "evaluation.json"), "utf8"),
  ) as { questions: EvalQuestion[] };

  it("exige evidencia citada y todos los casos críticos", () => {
    const all = questions.map((q) => ({ questionId: q.id, correct: true, citedEvidence: q.evidence }));
    expect(scoreEvaluation(questions, all).accuracy).toBe(1);
    const noEvidence = all.map((r) => (r.questionId === "s04" ? { ...r, citedEvidence: [] } : r));
    expect(scoreEvaluation(questions, noEvidence).criticalFailures).toEqual(["s04"]);
  });

  it("una batería sólo sintética nunca aprueba la fase real", () => {
    const all = questions.map((q) => ({ questionId: q.id, correct: true, citedEvidence: q.evidence }));
    const summary = scoreEvaluation(questions, all);
    expect(summary.syntheticOnly).toBe(true);
    expect(summary.passed).toBe(false);
  });

  it("aprueba con ≥90 % y sin fallos críticos en preguntas reales", () => {
    const real = Array.from({ length: 10 }, (_, i): EvalQuestion => ({
      id: `r${i}`, question: "q", lang: "es", kind: "current", expected: "e", evidence: ["s"], critical: i === 0, synthetic: false,
    }));
    const results = real.map((q, i) => ({ questionId: q.id, correct: i !== 9, citedEvidence: ["s"] }));
    expect(scoreEvaluation(real, results).passed).toBe(true);
    results[0]!.correct = false;
    expect(scoreEvaluation(real, results).passed).toBe(false);
  });
});
