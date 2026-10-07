/** Normaliza para búsqueda ES/EN/Spanglish: minúsculas, sin acentos, espacios colapsados. */
export function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(input: string): string[] {
  const text = normalizeText(input);
  return text ? text.split(" ") : [];
}
