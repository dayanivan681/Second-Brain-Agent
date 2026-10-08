import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { runAgent, type AgentAnswer } from "./agent.js";
import { AgentSession, buildTools } from "./tools.js";
import type { ChatModel } from "./model.js";
import { MemoryStore } from "../core/store.js";
import { InMemoryRepository } from "../core/in-memory-repository.js";
import { extractDrafts } from "../core/importer.js";
import { validateManifest, verifyManifestFiles, type ContextManifest } from "../core/manifest.js";
import { scoreEvaluation, type EvalQuestion } from "../core/evaluation.js";
import { sha256 } from "../core/hash.js";

export interface EvaluationPackage {
  manifest: ContextManifest;
  questions: EvalQuestion[];
  contents: Map<string, string>;
}

/** Validate all selected input before any network request. Never reads a live DB. */
export function loadEvaluationPackage(packageDir: string, questionsFile: string): EvaluationPackage {
  const root = realpathSync(packageDir);
  const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8")) as ContextManifest;
  if (manifest.schemaVersion !== 1 || typeof manifest.synthetic !== "boolean" || !Array.isArray(manifest.entries)) {
    throw new Error("Manifiesto de evaluación inválido");
  }
  const structural = validateManifest(manifest);
  if (structural.length) throw new Error(`Manifiesto rechazado: ${structural.map((x) => x.code).join(", ")}`);
  const contents = new Map<string, string>();
  for (const entry of manifest.entries) {
    if (entry.synthetic !== manifest.synthetic) throw new Error("No mezclar fuentes reales y sintéticas");
    const full = realpathSync(resolve(root, entry.path));
    const rel = relative(root, full);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith("../")) throw new Error("Fuente fuera del paquete");
    contents.set(entry.path, readFileSync(full, "utf8"));
  }
  const issues = verifyManifestFiles(manifest, (path) => contents.get(path));
  if (issues.length) throw new Error(`Fuentes rechazadas: ${issues.map((x) => x.code).join(", ")}`);
  const pack = JSON.parse(readFileSync(questionsFile, "utf8")) as { synthetic: boolean; questions: EvalQuestion[] };
  if (pack.synthetic !== manifest.synthetic || !Array.isArray(pack.questions) || !pack.questions.length) {
    throw new Error("Preguntas incompatibles con el paquete");
  }
  if (!pack.synthetic && (pack.questions.length < 30 || pack.questions.length > 50)) {
    throw new Error("La evaluación real requiere 30–50 preguntas");
  }
  const ids = new Set<string>();
  const sources = new Set(manifest.entries.map((e) => e.id));
  for (const q of pack.questions) {
    if (typeof q.id !== "string" || !q.id || ids.has(q.id) || typeof q.question !== "string" || !q.question.trim()
      || typeof q.expected !== "string" || !q.expected.trim() || typeof q.critical !== "boolean"
      || q.synthetic !== manifest.synthetic || !["es", "en", "spanglish"].includes(q.lang)
      || !["current", "historical", "correction", "reverted-decision", "deletion", "permissions", "missing-data"].includes(q.kind)
      || !Array.isArray(q.evidence) || q.evidence.some((id) => !sources.has(id))) {
      throw new Error("Pregunta inválida, duplicada o con evidencia desconocida");
    }
    ids.add(q.id);
  }
  return { manifest, questions: pack.questions, contents };
}

export interface LiveEvaluationReport {
  schemaVersion: 1;
  model: string;
  commit: string | null;
  packageId: string;
  packageHash: string;
  synthetic: boolean;
  startedAt: string;
  complete: boolean;
  results: Array<{
    question: EvalQuestion;
    elapsedMs: number;
    answer?: AgentAnswer;
    error?: string;
  }>;
}

export async function runLiveEvaluation(input: {
  pack: EvaluationPackage;
  model: ChatModel;
  now?: () => Date;
  commit?: string;
}): Promise<LiveEvaluationReport> {
  const now = input.now ?? (() => new Date());
  const store = new MemoryStore(new InMemoryRepository(), now);
  for (const entry of input.pack.manifest.entries) {
    const drafts = extractDrafts(entry.path, input.pack.contents.get(entry.path)!, entry);
    if (!drafts.length) throw new Error(`Fuente sin memorias importables: ${entry.id}`);
    await store.importSource(entry.id, drafts);
  }
  const report: LiveEvaluationReport = {
    schemaVersion: 1, model: input.model.name, commit: input.commit ?? null,
    packageId: input.pack.manifest.packageId, packageHash: sha256(JSON.stringify(input.pack.manifest)),
    synthetic: input.pack.manifest.synthetic, startedAt: now().toISOString(), complete: false, results: [],
  };
  for (const question of input.pack.questions) {
    const start = performance.now();
    const session = new AgentSession();
    try {
      const answer = await runAgent({
        model: input.model, tools: buildTools({ store, now, session }), session, question: question.question, now,
        policy: { allowedEffects: ["read"], maxSteps: 8, maxToolCalls: 16 },
      });
      report.results.push({ question, elapsedMs: Math.round(performance.now() - start), answer });
    } catch {
      // Do not serialize provider errors, request headers, credentials or selected content to logs.
      report.results.push({ question, elapsedMs: Math.round(performance.now() - start), error: "model-request-failed" });
      return report;
    }
  }
  report.complete = true;
  return report;
}

/** Structural success is deliberately separate from reviewed semantic correctness. */
export function structurallyValid(result: LiveEvaluationReport["results"][number]): boolean {
  const a = result.answer;
  return !!a && a.stoppedBy === "answer" && a.trace.some((t) => !!t.tool && !t.error)
    && !a.trace.some((t) => !!t.error) && a.proposals.length === 0
    && result.question.evidence.every((s) => a.claims.some((c) => c.citations.some((x) => x.sourceId === s)));
}

export function scoreReviewedReport(report: LiveEvaluationReport, reviews: Array<{ questionId: string; correct: boolean }>) {
  if (!report.complete || !report.results.length) throw new Error("Ejecución incompleta");
  const ids = new Set(report.results.map((r) => r.question.id));
  if (ids.size !== report.results.length || reviews.length !== ids.size || new Set(reviews.map((r) => r.questionId)).size !== ids.size
    || reviews.some((r) => !ids.has(r.questionId) || typeof r.correct !== "boolean")) {
    throw new Error("Se requiere una revisión explícita de cada respuesta, sin duplicados");
  }
  const byId = new Map(reviews.map((r) => [r.questionId, r.correct]));
  return scoreEvaluation(report.results.map((r) => r.question), report.results.map((r) => ({
    questionId: r.question.id, correct: structurallyValid(r) && byId.get(r.question.id) === true,
    citedEvidence: [...new Set(r.answer?.claims.flatMap((c) => c.citations.map((s) => s.sourceId)) ?? [])],
  })));
}
