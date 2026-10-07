#!/usr/bin/env node
// Genera manifest.json para un paquete de contexto: rutas relativas + sha256.
// Uso: node scripts/build-manifest.mjs <dir-paquete> <packageId> [--synthetic]
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const [dir, packageId, flag] = process.argv.slice(2);
if (!dir || !packageId) {
  console.error("Uso: node scripts/build-manifest.mjs <dir-paquete> <packageId> [--synthetic]");
  process.exit(1);
}
const synthetic = flag === "--synthetic";
const capturedAt = new Date().toISOString();

function walk(d) {
  return readdirSync(d).flatMap((name) => {
    const p = join(d, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const entries = walk(dir)
  .filter((p) => p.endsWith(".md") && !p.endsWith(`${sep}README.md`))
  .sort()
  .map((p) => {
    const rel = relative(dir, p).split(sep).join("/");
    const content = readFileSync(p, "utf8");
    const updated = /^updated:\s*(.+)$/m.exec(content)?.[1]?.trim();
    const domain = /^domain:\s*(.+)$/m.exec(content)?.[1]?.trim();
    return {
      id: rel.replace(/\.md$/, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase(),
      path: rel,
      sha256: createHash("sha256").update(content, "utf8").digest("hex"),
      capturedAt,
      originalNote: rel,
      ...(updated ? { version: updated } : {}),
      ...(domain ? { domain } : {}),
      synthetic,
    };
  });

const manifest = { schemaVersion: 1, packageId, capturedAt, synthetic, entries };
writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest.json: ${entries.length} entradas`);
