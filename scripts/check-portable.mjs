#!/usr/bin/env node
// Falla si el repositorio contiene rutas del Mac/iCloud: la construcción debe
// funcionar en un entorno limpio en la nube.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [/\/Users\/[A-Za-z]/, /Mobile Documents/, /com~apple~CloudDocs/, /Library\/CloudStorage/];
// Archivos que contienen estos patrones a propósito (validadores y sus tests).
const ALLOW = (file) => file === "scripts/check-portable.mjs" || file === "src/core/manifest.ts" || file.startsWith("test/");

const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
const hits = [];
for (const file of files) {
  if (ALLOW(file) || file === "package-lock.json") continue;
  const content = readFileSync(file, "utf8");
  content.split("\n").forEach((line, i) => {
    if (PATTERNS.some((re) => re.test(line))) hits.push(`${file}:${i + 1}: ${line.trim()}`);
  });
}
if (hits.length) {
  console.error("Rutas no portables encontradas:\n" + hits.join("\n"));
  process.exit(1);
}
console.log(`OK: ${files.length} archivos sin rutas locales`);
