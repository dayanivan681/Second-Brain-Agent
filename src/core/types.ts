/** Distinción epistémica obligatoria para toda memoria. */
export type Epistemic = "fact" | "inference" | "recommendation";

/** Categorías cuya autoridad es Obsidian; la app solo guarda una copia derivada. */
export type Category = "goal" | "rule" | "decision" | "status" | "note" | "event";

export type MemoryStatus = "active" | "retracted" | "deleted";

export interface SourceRef {
  /** Identificador estable del manifiesto (no una ruta absoluta). */
  sourceId: string;
  /** Ruta relativa dentro del paquete de contexto. */
  path: string;
  /** sha256 del contenido importado. */
  contentHash: string;
  /** Versión declarada por la fuente, si existe (p. ej. `updated` en frontmatter). */
  version?: string;
  capturedAt: string;
  synthetic: boolean;
  /** Sección o ancla dentro de la nota. */
  anchor?: string;
}

export type RevisionChange = "create" | "update" | "correct" | "retract" | "delete" | "restore";

export interface Revision {
  at: string;
  by: "import" | "user" | "system";
  change: RevisionChange;
  /** Texto anterior. Se purga al eliminar. */
  previousStatement?: string;
  reason?: string;
  source?: SourceRef;
}

export interface Memory {
  id: string;
  /** Clave de deduplicación: misma clave ⇒ misma memoria al reimportar. */
  key: string;
  domain: string;
  category: Category;
  epistemic: Epistemic;
  statement: string;
  sources: SourceRef[];
  status: MemoryStatus;
  createdAt: string;
  updatedAt: string;
  revisions: Revision[];
}

export interface MemoryDraft {
  key: string;
  domain: string;
  category: Category;
  epistemic: Epistemic;
  statement: string;
  source: SourceRef;
}
