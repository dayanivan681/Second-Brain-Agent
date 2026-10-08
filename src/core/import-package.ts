import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractDrafts } from "./importer.js";
import { verifyManifestFiles, type ContextManifest, type ManifestIssue } from "./manifest.js";
import type { ImportResult, MemoryStore } from "./store.js";

export interface PackageImport {
  packageId: string;
  synthetic: boolean;
  issues: ManifestIssue[];
  /** Vacío si hubo problemas: no se importa nada. */
  sources: Array<{ sourceId: string; path: string } & ImportResult>;
}

/**
 * Importa un paquete de contexto (manifest.json + notas). Si el manifiesto no
 * verifica (rutas, hashes, secretos), no importa nada.
 */
export async function importPackage(dir: string, store: MemoryStore, options: { dryRun?: boolean } = {}): Promise<PackageImport> {
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`No existe ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ContextManifest;
  const read = (path: string) => {
    const full = join(dir, path);
    return existsSync(full) ? readFileSync(full, "utf8") : undefined;
  };
  const issues = verifyManifestFiles(manifest, read);
  const result: PackageImport = { packageId: manifest.packageId, synthetic: manifest.synthetic, issues, sources: [] };
  if (issues.length || options.dryRun) return result;
  for (const entry of manifest.entries) {
    const drafts = extractDrafts(entry.path, read(entry.path)!, entry);
    result.sources.push({ sourceId: entry.id, path: entry.path, ...(await store.importSource(entry.id, drafts)) });
  }
  return result;
}
