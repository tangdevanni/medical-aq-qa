export function normalizeQaWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function normalizeQaComparable(value: string | null | undefined): string {
  return normalizeQaWhitespace(value)
    .replace(/[,/.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}
