import { sha256 } from "./hash.js";
import { isPortablePath } from "./manifest.js";

/**
 * Cambio propuesto desde la nube para una nota del Vault. Nunca se aplica solo:
 * se revisa y se comprueba contra la versión actual antes de incorporarlo.
 */
export interface MarkdownProposal {
  /** Ruta relativa al Vault. */
  notePath: string;
  /** sha256 de la nota sobre la que se redactó; null si la nota es nueva. */
  baseHash: string | null;
  proposedContent: string;
  createdAt: string;
  rationale: string;
}

export type ProposalCheck =
  | { status: "clean" }
  | { status: "new-note" }
  | { status: "already-applied" }
  | { status: "conflict"; reason: string };

export function createProposal(input: {
  notePath: string;
  baseContent: string | null;
  proposedContent: string;
  rationale: string;
  now?: Date;
}): MarkdownProposal {
  const pathIssue = isPortablePath(input.notePath);
  if (pathIssue) throw new Error(`Ruta de nota no portable (${pathIssue}): ${input.notePath}`);
  return {
    notePath: input.notePath,
    baseHash: input.baseContent === null ? null : sha256(input.baseContent),
    proposedContent: input.proposedContent,
    createdAt: (input.now ?? new Date()).toISOString(),
    rationale: input.rationale,
  };
}

/** `currentContent` = contenido actual de la nota en el Vault, o null si no existe. */
export function checkProposal(proposal: MarkdownProposal, currentContent: string | null): ProposalCheck {
  if (currentContent !== null && sha256(currentContent) === sha256(proposal.proposedContent)) {
    return { status: "already-applied" };
  }
  if (proposal.baseHash === null) {
    return currentContent === null
      ? { status: "new-note" }
      : { status: "conflict", reason: "La nota se creó en el Vault después de redactar la propuesta" };
  }
  if (currentContent === null) return { status: "conflict", reason: "La nota base ya no existe en el Vault" };
  if (sha256(currentContent) !== proposal.baseHash) {
    return { status: "conflict", reason: "La nota se modificó después de exportar; revisar a mano" };
  }
  return { status: "clean" };
}
