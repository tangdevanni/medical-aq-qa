export function sanitizeObservabilityText(message: string | null | undefined, maxLength = 140): string {
  const sanitized = (message ?? "")
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\/documents\/(?:note\/visitnote|assessment|oasis|planofcare|plan-of-care|poc|order|orders)\/\S+/gi, "/documents/[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b\d{2,}\b/g, "[n]")
    .trim();

  if (!sanitized) {
    return "Portal action failed.";
  }

  return sanitized.slice(0, maxLength);
}
