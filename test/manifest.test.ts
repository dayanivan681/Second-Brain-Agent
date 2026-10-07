import { describe, expect, it } from "vitest";
import { detectSecrets, isPortablePath, validateManifest, verifyManifestFiles } from "../src/core/manifest.js";
import { entry, loadSyntheticManifest, readSynthetic } from "./helpers.js";

describe("manifiesto del paquete de contexto", () => {
  it("el paquete sintético es válido y sus hashes coinciden", () => {
    const manifest = loadSyntheticManifest();
    expect(manifest.synthetic).toBe(true);
    expect(verifyManifestFiles(manifest, readSynthetic)).toEqual([]);
  });

  it("rechaza rutas absolutas, del Mac/iCloud y con ..", () => {
    expect(isPortablePath("/Users/yo/Vault/nota.md")).toBe("absolute-path");
    expect(isPortablePath("Library/Mobile Documents/iCloud~md~obsidian/nota.md")).toBe("machine-path");
    expect(isPortablePath("~/Vault/nota.md")).toBe("machine-path");
    expect(isPortablePath("../fuera.md")).toBe("path-traversal");
    expect(isPortablePath("02 Areas/Projects/Personal Intelligence System.md")).toBeNull();
  });

  it("detecta ids duplicados y entradas reales en un paquete sintético", () => {
    const codes = validateManifest({
      schemaVersion: 1,
      packageId: "x",
      capturedAt: "2026-10-01",
      synthetic: true,
      entries: [entry(), entry({ path: "otra.md", synthetic: false })],
    }).map((i) => i.code);
    expect(codes).toContain("duplicate-id");
    expect(codes).toContain("synthetic-mismatch");
  });

  it("detecta contenido modificado, ausente o con secretos", () => {
    const manifest = loadSyntheticManifest();
    const tampered = verifyManifestFiles(manifest, (p) => (p === "reglas-generales.md" ? "cambiado\nOPENAI_API_KEY=abcdefghijkl" : readSynthetic(p)));
    expect(tampered.map((i) => i.code).sort()).toEqual(["hash-mismatch", "secret-detected"]);
    const missing = verifyManifestFiles(manifest, () => undefined);
    expect(missing.every((i) => i.code === "missing-file")).toBe(true);
  });

  it("detectSecrets no marca texto normal", () => {
    expect(detectSecrets("## Reglas\n- Revisar prioridades cada lunes")).toBe(false);
    expect(detectSecrets("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
  });
});
