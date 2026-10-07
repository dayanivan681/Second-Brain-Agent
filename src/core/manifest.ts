import { sha256 } from "./hash.js";

export interface ManifestEntry {
  id: string;
  /** Ruta relativa dentro del paquete. */
  path: string;
  sha256: string;
  capturedAt: string;
  /** Nota original en el Vault (ruta relativa al Vault). */
  originalNote?: string;
  version?: string;
  synthetic: boolean;
  domain?: string;
}

export interface ContextManifest {
  schemaVersion: 1;
  packageId: string;
  capturedAt: string;
  synthetic: boolean;
  entries: ManifestEntry[];
}

export interface ManifestIssue {
  entryId?: string;
  code:
    | "absolute-path"
    | "path-traversal"
    | "machine-path"
    | "duplicate-id"
    | "duplicate-path"
    | "bad-hash"
    | "bad-date"
    | "hash-mismatch"
    | "missing-file"
    | "secret-detected"
    | "synthetic-mismatch";
  message: string;
}

const MACHINE_PATH = /(\/Users\/|Mobile Documents|com~apple~CloudDocs|iCloud|^~)/i;

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /^\s*[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|API_KEY)[A-Z0-9_]*\s*[:=]\s*\S{8,}/m,
];

export function isPortablePath(path: string): ManifestIssue["code"] | null {
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return "absolute-path";
  if (MACHINE_PATH.test(path)) return "machine-path";
  if (path.split(/[\\/]/).includes("..")) return "path-traversal";
  return null;
}

export function detectSecrets(content: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(content));
}

/** Validación estructural, sin leer archivos. */
export function validateManifest(manifest: ContextManifest): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const entry of manifest.entries) {
    const pathIssue = isPortablePath(entry.path);
    if (pathIssue) issues.push({ entryId: entry.id, code: pathIssue, message: `Ruta no portable: ${entry.path}` });
    if (entry.originalNote) {
      const originIssue = isPortablePath(entry.originalNote);
      if (originIssue) issues.push({ entryId: entry.id, code: originIssue, message: `originalNote no portable: ${entry.originalNote}` });
    }
    if (ids.has(entry.id)) issues.push({ entryId: entry.id, code: "duplicate-id", message: `Id duplicado: ${entry.id}` });
    if (paths.has(entry.path)) issues.push({ entryId: entry.id, code: "duplicate-path", message: `Ruta duplicada: ${entry.path}` });
    ids.add(entry.id);
    paths.add(entry.path);
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) issues.push({ entryId: entry.id, code: "bad-hash", message: "sha256 inválido" });
    if (Number.isNaN(Date.parse(entry.capturedAt))) issues.push({ entryId: entry.id, code: "bad-date", message: "capturedAt inválido" });
    if (manifest.synthetic && !entry.synthetic) {
      issues.push({ entryId: entry.id, code: "synthetic-mismatch", message: "Paquete sintético con entrada marcada como real" });
    }
  }
  return issues;
}

/** Comprueba hashes y secretos contra el contenido real de cada archivo. */
export function verifyManifestFiles(
  manifest: ContextManifest,
  readFile: (path: string) => string | undefined,
): ManifestIssue[] {
  const issues = validateManifest(manifest);
  for (const entry of manifest.entries) {
    const content = readFile(entry.path);
    if (content === undefined) {
      issues.push({ entryId: entry.id, code: "missing-file", message: `Falta ${entry.path}` });
      continue;
    }
    if (sha256(content) !== entry.sha256) {
      issues.push({ entryId: entry.id, code: "hash-mismatch", message: `El contenido de ${entry.path} no coincide con el manifiesto` });
    }
    if (detectSecrets(content)) {
      issues.push({ entryId: entry.id, code: "secret-detected", message: `Posible secreto en ${entry.path}` });
    }
  }
  return issues;
}
