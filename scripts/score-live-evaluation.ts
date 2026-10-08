import { readFileSync } from "node:fs";
import { scoreReviewedReport, type LiveEvaluationReport } from "../src/agent/live-evaluation.js";

const [reportFile, reviewFile] = process.argv.slice(2);
if (!reportFile || !reviewFile) throw new Error("Uso: score-live-evaluation <report> <review>");
const report = JSON.parse(readFileSync(reportFile, "utf8")) as LiveEvaluationReport;
const reviews = JSON.parse(readFileSync(reviewFile, "utf8")) as Array<{ questionId: string; correct: boolean }>;
const summary = scoreReviewedReport(report, reviews);
console.log(JSON.stringify(summary));
// A successful synthetic circuit is not approval of the real-context phase.
if (!summary.passed) process.exitCode = 1;
