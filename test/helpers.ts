import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ContextManifest, ManifestEntry } from "../src/core/manifest.js";

export const SYNTHETIC_DIR = join(import.meta.dirname, "..", "fixtures", "synthetic", "vault");

export function loadSyntheticManifest(): ContextManifest {
  return JSON.parse(readFileSync(join(SYNTHETIC_DIR, "manifest.json"), "utf8")) as ContextManifest;
}

export function readSynthetic(path: string): string | undefined {
  try {
    return readFileSync(join(SYNTHETIC_DIR, path), "utf8");
  } catch {
    return undefined;
  }
}

export function entry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    id: "nota",
    path: "nota.md",
    sha256: "0".repeat(64),
    capturedAt: "2026-10-01T00:00:00.000Z",
    synthetic: true,
    ...overrides,
  };
}

/** Reloj controlable para probar historia. */
export function fakeClock(start = "2026-10-01T00:00:00.000Z") {
  let t = Date.parse(start);
  const clock = () => new Date(t);
  clock.advanceDays = (days: number) => {
    t += days * 86_400_000;
  };
  return clock;
}
