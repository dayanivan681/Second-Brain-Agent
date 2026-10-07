import { parse as parseYaml } from "yaml";
import { sha256 } from "./hash.js";
import type { ManifestEntry } from "./manifest.js";
import { normalizeText } from "./text.js";
import type { Category, Epistemic, MemoryDraft, SourceRef } from "./types.js";

export interface ParsedNote {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parseNote(content: string): ParsedNote {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) return { frontmatter: {}, body: content };
  const data = parseYaml(match[1] ?? "") as unknown;
  const frontmatter = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  return { frontmatter, body: content.slice(match[0].length) };
}

/** Encabezados reconocidos (ES/EN) → categoría. */
const SECTION_CATEGORY: Array<[RegExp, Category]> = [
  [/^(objetivos?|goals?)$/, "goal"],
  [/^(reglas?|rules?)$/, "rule"],
  [/^(decisiones?|decisions?)$/, "decision"],
  [/^(estado|status)$/, "status"],
];

function categoryFor(heading: string): Category | undefined {
  const normalized = normalizeText(heading);
  return SECTION_CATEGORY.find(([re]) => re.test(normalized))?.[1];
}

/**
 * Extrae viñetas bajo secciones reconocidas. Todo lo extraído de una nota es
 * `fact` respecto de la nota (lo que la nota afirma); las inferencias y
 * recomendaciones las produce la capa de consultas, nunca el importador.
 */
export function extractDrafts(path: string, content: string, entry: ManifestEntry): MemoryDraft[] {
  const { frontmatter, body } = parseNote(content);
  const domain = String(frontmatter.domain ?? entry.domain ?? "general");
  const version = frontmatter.updated !== undefined ? String(frontmatter.updated) : entry.version;
  const contentHash = sha256(content);
  const drafts: MemoryDraft[] = [];
  let category: Category | undefined;
  let heading = "";

  for (const line of body.split(/\r?\n/)) {
    const h = /^#{2,6}\s+(.+?)\s*$/.exec(line);
    if (h) {
      heading = h[1] ?? "";
      category = categoryFor(heading);
      continue;
    }
    const bullet = /^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/.exec(line);
    if (!category || !bullet) continue;
    const statement = bullet[1] ?? "";
    const epistemic: Epistemic = "fact";
    const source: SourceRef = {
      sourceId: entry.id,
      path,
      contentHash,
      capturedAt: entry.capturedAt,
      synthetic: entry.synthetic,
      anchor: heading,
      ...(version !== undefined ? { version } : {}),
    };
    drafts.push({
      key: `${entry.id}#${category}#${sha256(normalizeText(statement)).slice(0, 16)}`,
      domain,
      category,
      epistemic,
      statement,
      source,
    });
  }
  return drafts;
}
