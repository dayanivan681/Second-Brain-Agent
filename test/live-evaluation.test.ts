import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadEvaluationPackage, runLiveEvaluation, scoreReviewedReport, structurallyValid } from "../src/agent/live-evaluation.js";
import type { ChatModel, ChatMessage } from "../src/agent/model.js";

const root = join(import.meta.dirname, "..", "fixtures", "synthetic");
const load = () => loadEvaluationPackage(join(root, "vault"), join(root, "evaluation.json"));

function answeringModel(): ChatModel {
  return {
    name: "scripted-evaluation",
    async complete(messages: ChatMessage[], tools) {
      expect(tools.some((t) => t.name === "propose_vault_change")).toBe(false);
      const result = messages.find((m) => m.role === "tool");
      if (!result) return { content: null, toolCalls: [{ id: "search", name: "search_memories", arguments: '{"query":"Alfa Beta","k":20}' }] };
      const memories = JSON.parse(result.content!) as { results: Array<{ id: string }> };
      return { content: JSON.stringify({ answer: "Respuesta guionizada para probar el arnés", claims: memories.results.map((m) => ({ text: "Guion", kind: "fact", memoryIds: [m.id] })), gaps: [] }), toolCalls: [], usage: { inputTokens: 10, outputTokens: 3 } };
    },
  };
}

describe("live evaluation harness", () => {
  it("validates synthetic hashes and runs a read-only tool cycle for every question", async () => {
    const report = await runLiveEvaluation({ pack: load(), model: answeringModel() });
    expect(report.complete).toBe(true);
    expect(report.results).toHaveLength(6);
    expect(report.results.every(structurallyValid)).toBe(true);
    const score = scoreReviewedReport(report, report.results.map((r) => ({ questionId: r.question.id, correct: true })));
    expect(score.accuracy).toBe(1);
    expect(score.syntheticOnly).toBe(true);
    expect(score.passed).toBe(false);
  });

  it("stops on a provider error and never persists its secret-bearing message", async () => {
    const model: ChatModel = { name: "failing", async complete() { throw new Error("credential-do-not-store"); } };
    const report = await runLiveEvaluation({ pack: load(), model });
    expect(report.complete).toBe(false);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.error).toBe("model-request-failed");
    expect(JSON.stringify(report)).not.toContain("credential-do-not-store");
    expect(() => scoreReviewedReport(report, [])).toThrow("incompleta");
  });

  it("requires individual human verdicts and rejects duplicates and pending answers", async () => {
    const report = await runLiveEvaluation({ pack: load(), model: answeringModel() });
    const reviews = report.results.map((r) => ({ questionId: r.question.id, correct: true }));
    expect(() => scoreReviewedReport(report, reviews.slice(1))).toThrow("revisión");
    expect(() => scoreReviewedReport(report, [...reviews.slice(1), reviews[1]!])).toThrow("revisión");
    expect(() => scoreReviewedReport(report, reviews.map((r) => ({ ...r, correct: null as unknown as boolean })))).toThrow("revisión");
  });

  it("does not let a positive human verdict override missing cited evidence", async () => {
    const report = await runLiveEvaluation({ pack: load(), model: answeringModel() });
    report.results[0]!.answer!.claims = [];
    expect(structurallyValid(report.results[0]!)).toBe(false);
    const score = scoreReviewedReport(report, report.results.map((r) => ({ questionId: r.question.id, correct: true })));
    expect(score.correctWithEvidence).toBe(5);
  });
});
