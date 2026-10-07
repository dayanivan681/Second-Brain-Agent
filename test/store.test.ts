import { beforeEach, describe, expect, it } from "vitest";
import { sha256 } from "../src/core/hash.js";
import { extractDrafts } from "../src/core/importer.js";
import { InMemoryRepository } from "../src/core/in-memory-repository.js";
import type { MemoryRepository } from "../src/core/repository.js";
import { ExportIntegrityError, MemoryStore } from "../src/core/store.js";
import { entry, fakeClock, loadSyntheticManifest, readSynthetic } from "./helpers.js";
import { REPOSITORIES } from "./repositories.js";

const NOTE_V1 = `---
domain: alfa
updated: 2026-09-01
---
## Decisiones
- Usar pagos mensuales
- Posponer la app móvil
## Estado
- Landing terminada
`;
const NOTE_V2 = NOTE_V1.replace("- Posponer la app móvil\n", "").replace("updated: 2026-09-01", "updated: 2026-09-20");

function draftsFor(content: string) {
  const e = entry({ id: "alfa", path: "alfa.md", sha256: sha256(content), domain: "alfa" });
  return extractDrafts("alfa.md", content, e);
}

function importNote(store: MemoryStore, content: string) {
  return store.importSource("alfa", draftsFor(content));
}

describe.each(REPOSITORIES)("MemoryStore — %s", (_name, makeRepo, resetSlots) => {
  let repo: MemoryRepository;
  beforeEach(async () => {
    resetSlots();
    repo = await makeRepo();
  });
  const newStore = (clock?: () => Date) => new MemoryStore(repo, clock);

  describe("importación", () => {
    it("importa el paquete sintético completo con procedencia", async () => {
      const store = newStore();
      for (const e of loadSyntheticManifest().entries) {
        await store.importSource(e.id, extractDrafts(e.path, readSynthetic(e.path)!, e));
      }
      const all = await store.all();
      expect(all.length).toBe(12);
      expect(all.every((m) => m.sources[0]?.synthetic && m.epistemic === "fact")).toBe(true);
      expect(all.filter((m) => m.category === "decision").map((m) => m.domain).sort()).toEqual([
        "sintetico-alfa",
        "sintetico-alfa",
        "sintetico-beta",
      ]);
    });

    it("reimportar el mismo contenido no duplica", async () => {
      const store = newStore();
      expect(await importNote(store, NOTE_V1)).toEqual({ created: 3, unchanged: 0, updated: 0, retracted: 0 });
      expect(await importNote(store, NOTE_V1)).toEqual({ created: 0, unchanged: 3, updated: 0, retracted: 0 });
      expect(await store.all()).toHaveLength(3);
    });

    it("una decisión eliminada de la nota se retracta con historia, no se borra", async () => {
      const clock = fakeClock();
      const store = newStore(clock);
      await importNote(store, NOTE_V1);
      const before = clock().toISOString();
      clock.advanceDays(5);
      expect(await importNote(store, NOTE_V2)).toEqual({ created: 0, unchanged: 0, updated: 2, retracted: 1 });
      const reverted = (await store.all({ includeInactive: true })).find((m) => m.statement.includes("app móvil"))!;
      expect(reverted.status).toBe("retracted");
      expect(reverted.revisions.map((r) => r.change)).toEqual(["create", "retract"]);
      expect((await store.asOf(reverted.id, before))?.status).toBe("active");
      expect(await store.search("app movil")).toHaveLength(0);
      expect(await store.search("app movil", { includeInactive: true })).toHaveLength(1);
    });

    it("si la decisión vuelve a la nota, se restaura la misma memoria", async () => {
      const store = newStore(fakeClock());
      await importNote(store, NOTE_V1);
      await importNote(store, NOTE_V2);
      await importNote(store, NOTE_V1);
      const m = (await store.all()).find((x) => x.statement.includes("app móvil"))!;
      expect(m.revisions.map((r) => r.change)).toEqual(["create", "retract", "restore"]);
      expect(await store.all({ includeInactive: true })).toHaveLength(3);
    });

    it("una importación que falla no deja cambios a medias", async () => {
      const store = newStore();
      await importNote(store, NOTE_V1);
      const drafts = draftsFor(NOTE_V2);
      const foreign = { ...drafts[0]!, source: { ...drafts[0]!.source, sourceId: "otra" } };
      await expect(store.importSource("alfa", [...drafts, foreign])).rejects.toThrow();
      const all = await store.all({ includeInactive: true });
      expect(all.every((m) => m.status === "active" && m.revisions.length === 1)).toBe(true);
    });
  });

  describe("corrección, retracción y eliminación", () => {
    it("la corrección conserva el texto anterior y la consulta histórica lo devuelve", async () => {
      const clock = fakeClock();
      const store = newStore(clock);
      await importNote(store, NOTE_V1);
      const m = (await store.search("pagos mensuales"))[0]!;
      const before = clock().toISOString();
      clock.advanceDays(1);
      await store.correct(m.id, "Usar pagos anuales", "El usuario aclaró la decisión");
      expect((await store.get(m.id))?.statement).toBe("Usar pagos anuales");
      expect((await store.asOf(m.id, before))?.statement).toBe("Usar pagos mensuales");
      expect(await store.asOf(m.id, "2020-01-01")).toBeUndefined();
    });

    it("una retracción del usuario no se deshace al reimportar", async () => {
      const store = newStore();
      await importNote(store, NOTE_V1);
      const m = (await store.search("landing"))[0]!;
      await store.retract(m.id, "Ya no es cierto");
      await importNote(store, NOTE_V1);
      expect((await store.get(m.id))?.status).toBe("retracted");
    });

    it("eliminar purga el texto y la historia, y no resucita al reimportar", async () => {
      const store = newStore();
      await importNote(store, NOTE_V1);
      const m = (await store.search("pagos"))[0]!;
      await store.correct(m.id, "Texto corregido", "x");
      await store.delete(m.id, "Petición del usuario");
      await importNote(store, NOTE_V1);
      const tomb = (await store.get(m.id))!;
      expect(tomb.status).toBe("deleted");
      expect(JSON.stringify(tomb)).not.toMatch(/pagos|corregido/i);
      expect(await store.search("pagos", { includeInactive: true })).toHaveLength(0);
      await expect(store.correct(m.id, "x", "y")).rejects.toThrow();
    });
  });

  describe("exportación y restauración", () => {
    it("restaura registros, versiones y evidencia exactamente", async () => {
      const store = newStore(fakeClock());
      await importNote(store, NOTE_V1);
      await importNote(store, NOTE_V2);
      await store.correct((await store.all())[0]!.id, "corregido", "r");
      const dump = await store.export();
      const restored = await MemoryStore.restore(JSON.parse(JSON.stringify(dump)), await makeRepo());
      expect(await restored.all({ includeInactive: true })).toEqual(await store.all({ includeInactive: true }));
      expect((await importNote(restored, NOTE_V2)).created).toBe(0);
    });

    it("migra entre adaptadores: memoria → este repositorio", async () => {
      const source = new MemoryStore(new InMemoryRepository(), fakeClock());
      await importNote(source, NOTE_V1);
      await importNote(source, NOTE_V2);
      const dump = await source.export();
      const target = await MemoryStore.restore(dump, repo);
      expect(await target.all({ includeInactive: true })).toEqual(dump.memories);
    });

    it("rechaza exportaciones alteradas y destinos no vacíos", async () => {
      const store = newStore();
      await importNote(store, NOTE_V1);
      const dump = await store.export();
      await expect(MemoryStore.restore(dump, repo)).rejects.toThrow(ExportIntegrityError);
      dump.memories[0]!.statement = "manipulado";
      await expect(MemoryStore.restore(dump, await makeRepo())).rejects.toThrow(ExportIntegrityError);
    });
  });

  describe("búsqueda multilingüe", () => {
    it("ignora acentos y mayúsculas", async () => {
      const store = newStore();
      await importNote(store, NOTE_V1);
      expect(await store.search("APP MOVIL")).toHaveLength(1);
      expect((await store.search("decisiones pagos"))[0]?.statement).toBe("Usar pagos mensuales");
    });
  });
});
