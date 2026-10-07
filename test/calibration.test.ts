import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chooseThreshold, collectCandidates } from "../src/core/calibration.js";
import type { EvalQuestion } from "../src/core/evaluation.js";
import { extractDrafts } from "../src/core/importer.js";
import { InMemoryRepository } from "../src/core/in-memory-repository.js";
import { InMemoryVectorIndex } from "../src/core/in-memory-vector-index.js";
import { HashingEmbedder, SemanticSearch } from "../src/core/semantic.js";
import { MemoryStore } from "../src/core/store.js";
import { loadSyntheticManifest, readSynthetic } from "./helpers.js";

describe("chooseThreshold", () => {
  it("elige el umbral con mejor F1 y, en empate, el más alto", () => {
    const choice = chooseThreshold([
      { similarity: 0.9, relevant: true },
      { similarity: 0.7, relevant: true },
      { similarity: 0.6, relevant: false },
      { similarity: 0.3, relevant: false },
      { similarity: 0.2, relevant: true },
    ]);
    expect(choice?.threshold).toBe(0.7);
    expect(choice?.precision).toBe(1);
    expect(choice?.recall).toBeCloseTo(2 / 3);
  });

  it("sin positivos no hay umbral que calibrar", () => {
    expect(chooseThreshold([{ similarity: 0.5, relevant: false }])).toBeNull();
  });
});

describe("collectCandidates", () => {
  it("etiqueta vecinos con la evidencia de la batería (sintética)", async () => {
    const store = new MemoryStore(new InMemoryRepository());
    for (const e of loadSyntheticManifest().entries) {
      await store.importSource(e.id, extractDrafts(e.path, readSynthetic(e.path)!, e));
    }
    const search = new SemanticSearch(store, new InMemoryVectorIndex(), new HashingEmbedder());
    await search.sync();
    const { questions } = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "fixtures", "synthetic", "evaluation.json"), "utf8"),
    ) as { questions: EvalQuestion[] };
    const candidates = await collectCandidates(search, questions, 5);
    expect(candidates.some((c) => c.relevant)).toBe(true);
    expect(candidates.some((c) => !c.relevant)).toBe(true);
    const choice = chooseThreshold(candidates)!;
    expect(choice.f1).toBeGreaterThan(0);
    expect(choice.threshold).toBeGreaterThanOrEqual(-1);
  });
});
