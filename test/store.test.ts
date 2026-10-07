import { describe, expect, it } from "vitest";
import { sha256 } from "../src/core/hash.js";
import { extractDrafts } from "../src/core/importer.js";
import { ExportIntegrityError, MemoryStore } from "../src/core/store.js";
import { entry, fakeClock, loadSyntheticManifest, readSynthetic } from "./helpers.js";

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

function importNote(store: MemoryStore, content: string) {
  const e = entry({ id: "alfa", path: "alfa.md", sha256: sha256(content), domain: "alfa" });
  return store.importSource("alfa", extractDrafts("alfa.md", content, e));
}

describe("importación", () => {
  it("importa el paquete sintético completo con procedencia", () => {
    const store = new MemoryStore();
    for (const e of loadSyntheticManifest().entries) {
      store.importSource(e.id, extractDrafts(e.path, readSynthetic(e.path)!, e));
    }
    const all = store.all();
    expect(all.length).toBe(12);
    expect(all.every((m) => m.sources[0]?.synthetic && m.epistemic === "fact")).toBe(true);
    expect(all.filter((m) => m.category === "decision").map((m) => m.domain).sort()).toEqual([
      "sintetico-alfa",
      "sintetico-alfa",
      "sintetico-beta",
    ]);
  });

  it("reimportar el mismo contenido no duplica", () => {
    const store = new MemoryStore();
    expect(importNote(store, NOTE_V1)).toEqual({ created: 3, unchanged: 0, updated: 0, retracted: 0 });
    expect(importNote(store, NOTE_V1)).toEqual({ created: 0, unchanged: 3, updated: 0, retracted: 0 });
    expect(store.all()).toHaveLength(3);
  });

  it("una decisión eliminada de la nota se retracta con historia, no se borra", () => {
    const clock = fakeClock();
    const store = new MemoryStore(clock);
    importNote(store, NOTE_V1);
    const before = clock().toISOString();
    clock.advanceDays(5);
    expect(importNote(store, NOTE_V2)).toEqual({ created: 0, unchanged: 0, updated: 2, retracted: 1 });
    const reverted = store.all({ includeInactive: true }).find((m) => m.statement.includes("app móvil"))!;
    expect(reverted.status).toBe("retracted");
    expect(reverted.revisions.map((r) => r.change)).toEqual(["create", "retract"]);
    expect(store.asOf(reverted.id, before)?.status).toBe("active");
    expect(store.search("app movil")).toHaveLength(0);
    expect(store.search("app movil", { includeInactive: true })).toHaveLength(1);
  });

  it("si la decisión vuelve a la nota, se restaura la misma memoria", () => {
    const store = new MemoryStore(fakeClock());
    importNote(store, NOTE_V1);
    importNote(store, NOTE_V2);
    importNote(store, NOTE_V1);
    const m = store.all().find((x) => x.statement.includes("app móvil"))!;
    expect(m.revisions.map((r) => r.change)).toEqual(["create", "retract", "restore"]);
    expect(store.all({ includeInactive: true })).toHaveLength(3);
  });
});

describe("corrección, retracción y eliminación", () => {
  it("la corrección conserva el texto anterior y la consulta histórica lo devuelve", () => {
    const clock = fakeClock();
    const store = new MemoryStore(clock);
    importNote(store, NOTE_V1);
    const m = store.search("pagos mensuales")[0]!;
    const before = clock().toISOString();
    clock.advanceDays(1);
    store.correct(m.id, "Usar pagos anuales", "El usuario aclaró la decisión");
    expect(store.get(m.id)?.statement).toBe("Usar pagos anuales");
    expect(store.asOf(m.id, before)?.statement).toBe("Usar pagos mensuales");
    expect(store.asOf(m.id, "2020-01-01")).toBeUndefined();
  });

  it("una retracción del usuario no se deshace al reimportar", () => {
    const store = new MemoryStore();
    importNote(store, NOTE_V1);
    const m = store.search("landing")[0]!;
    store.retract(m.id, "Ya no es cierto");
    importNote(store, NOTE_V1);
    expect(store.get(m.id)?.status).toBe("retracted");
  });

  it("eliminar purga el texto y la historia, y no resucita al reimportar", () => {
    const store = new MemoryStore();
    importNote(store, NOTE_V1);
    const m = store.search("pagos")[0]!;
    store.correct(m.id, "Texto corregido", "x");
    store.delete(m.id, "Petición del usuario");
    importNote(store, NOTE_V1);
    const tomb = store.get(m.id)!;
    expect(tomb.status).toBe("deleted");
    expect(JSON.stringify(tomb)).not.toMatch(/pagos|corregido/i);
    expect(store.search("pagos", { includeInactive: true })).toHaveLength(0);
    expect(() => store.correct(m.id, "x", "y")).toThrow();
  });
});

describe("exportación y restauración", () => {
  it("restaura registros, versiones y evidencia exactamente", () => {
    const store = new MemoryStore(fakeClock());
    importNote(store, NOTE_V1);
    importNote(store, NOTE_V2);
    store.correct(store.all()[0]!.id, "corregido", "r");
    const dump = store.export();
    const restored = MemoryStore.restore(JSON.parse(JSON.stringify(dump)));
    expect(restored.all({ includeInactive: true })).toEqual(store.all({ includeInactive: true }));
    expect(importNote(restored, NOTE_V2).created).toBe(0);
  });

  it("rechaza exportaciones alteradas", () => {
    const store = new MemoryStore();
    importNote(store, NOTE_V1);
    const dump = store.export();
    dump.memories[0]!.statement = "manipulado";
    expect(() => MemoryStore.restore(dump)).toThrow(ExportIntegrityError);
  });
});

describe("búsqueda multilingüe", () => {
  it("ignora acentos y mayúsculas", () => {
    const store = new MemoryStore();
    importNote(store, NOTE_V1);
    expect(store.search("APP MOVIL")).toHaveLength(1);
    expect(store.search("decisiones pagos")[0]?.statement).toBe("Usar pagos mensuales");
  });
});
