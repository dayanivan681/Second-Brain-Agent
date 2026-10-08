import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadEvaluationPackage, runLiveEvaluation, structurallyValid } from "../src/agent/live-evaluation.js";
import { OpenAIChatModel } from "../src/agent/openai-chat.js";

try {
  const { values } = parseArgs({ options: {
    package: { type: "string", default: "fixtures/synthetic/vault" },
    questions: { type: "string", default: "fixtures/synthetic/evaluation.json" },
    output: { type: "string", default: "evaluation-results/report.local.json" },
    "dry-run": { type: "boolean", default: false },
  } });
  const pack = loadEvaluationPackage(values.package!, values.questions!);
  if (values["dry-run"]) {
    console.log(JSON.stringify({ dryRun: true, synthetic: pack.manifest.synthetic, questions: pack.questions.length, networkCalls: 0 }));
  } else {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("Falta OPENAI_API_KEY; la evaluación no se ejecutó");
    const model = new OpenAIChatModel(key, process.env.OPENAI_CHAT_MODEL || "gpt-6-luna");
    const report = await runLiveEvaluation({ pack, model, commit: process.env.GITHUB_SHA });
    const output = resolve(values.output!);
    mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
    writeFileSync(output, JSON.stringify(report, null, 2), { mode: 0o600, flag: "wx" });
    writeFileSync(output + ".review.local.json", JSON.stringify(report.results.map((r) => ({ questionId: r.question.id, correct: null })), null, 2), { mode: 0o600, flag: "wx" });
    const valid = report.results.filter(structurallyValid).length;
    console.log(JSON.stringify({ complete: report.complete, synthetic: report.synthetic, evaluated: report.results.length,
      structurallyValid: valid, semanticReview: "pending", usage: report.results.reduce((n, r) => ({
        inputTokens: n.inputTokens + (r.answer?.usage.inputTokens ?? 0), outputTokens: n.outputTokens + (r.answer?.usage.outputTokens ?? 0),
      }), { inputTokens: 0, outputTokens: 0 }) }));
    if (!report.complete || valid !== pack.questions.length) process.exitCode = 1;
  }
} catch (e) {
  // Only our own setup/validation messages; provider errors are handled inside the runner.
  console.error(e instanceof Error ? e.message : "Evaluación fallida");
  process.exitCode = 1;
}
