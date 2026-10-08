import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { purgeSynthetic } from "../src/briefing/purge-synthetic.js";
import { InMemoryBriefingRepository } from "../src/briefing/repository.js";
import { runDailyBriefing } from "../src/briefing/routine.js";
import { importPackage } from "../src/core/import-package.js";
import { InMemoryRepository } from "../src/core/in-memory-repository.js";
import { MemoryStore } from "../src/core/store.js";
import { SYNTHETIC_DIR } from "./helpers.js";

describe("importPackage", () => {
  it("importa el paquete sintético y es idempotente", async () => {
    const store = new MemoryStore(new InMemoryRepository());
    const first = await importPackage(SYNTHETIC_DIR, store);
    expect(first.issues).toEqual([]);
    expect(first.synthetic).toBe(true);
    expect(first.sources.reduce((n, s) => n + s.created, 0)).toBe(12);
    const again = await importPackage(SYNTHETIC_DIR, store);
    expect(again.sources.reduce((n, s) => n + s.created, 0)).toBe(0);
  });

  it("dry-run no escribe nada", async () => {
    const store = new MemoryStore(new InMemoryRepository());
    expect((await importPackage(SYNTHETIC_DIR, store, { dryRun: true })).sources).toEqual([]);
    expect(await store.all()).toHaveLength(0);
  });

  it("si el manifiesto no verifica, no importa nada", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pkg-"));
    cpSync(SYNTHETIC_DIR, dir, { recursive: true });
    writeFileSync(join(dir, "reglas-generales.md"), "alterado");
    const store = new MemoryStore(new InMemoryRepository());
    const result = await importPackage(dir, store);
    expect(result.issues.map((i) => i.code)).toContain("hash-mismatch");
    expect(await store.all()).toHaveLength(0);
  });
});

describe("purgeSynthetic", () => {
  it("elimina las memorias sintéticas y su rastro en briefings", async () => {
    const store = new MemoryStore(new InMemoryRepository());
    const briefings = new InMemoryBriefingRepository();
    await importPackage(SYNTHETIC_DIR, store);
    await runDailyBriefing({ repo: briefings, store, now: () => new Date("2026-10-08T10:00:00Z"), timeZone: "UTC" });
    expect(await purgeSynthetic({ store, briefings })).toEqual({ deleted: 12 });
    expect(await store.all()).toHaveLength(0);
    expect(JSON.stringify(await briefings.get("2026-10-08"))).not.toContain("Publicar la versión beta");
  });
});
