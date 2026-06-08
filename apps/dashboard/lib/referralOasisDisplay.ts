export function compactDisplayText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function formatClinicalSourceDate(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const isoDate = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) {
    return isoDate[1];
  }

  return trimmed;
}

export function normalizeLabelForComparison(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stripPocElementAnnotation(value: string): string {
  const start = value.search(/\s*\(POC Element/i);
  if (start < 0) {
    return value;
  }

  let depth = 0;
  let end = -1;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth <= 0) {
        end = index + 1;
        break;
      }
    }
  }

  if (end < 0) {
    return value.slice(0, start);
  }

  return `${value.slice(0, start)}${value.slice(end)}`;
}

export function cleanOasisDisplayLabel(value: string): string {
  const compacted = compactDisplayText(value).replace(/[^\x20-\x7E]/g, " ");
  if (normalizeLabelForComparison(compacted) === "icd 10 code") {
    return "Diagnosis Code";
  }
  const withoutPocElement = stripPocElementAnnotation(compacted);
  const cleaned = withoutPocElement
    .replace(/\bICD-?10 Code\b/gi, "")
    .replace(/\b(?:PRIMARY|OTHER)\s+DIAGNOSIS\s*(?:-\s*\d+)?\b/gi, "")
    .replace(/\s*:\s*-\s*/g, " - ")
    .replace(/\s+[-:]\s*$/g, "")
    .replace(/[:\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return cleaned.length > 0 ? cleaned : compacted.trim();
}

export function cleanDiagnosisDescription(value: string | null | undefined, code: string): string | null {
  const cleaned = compactDisplayText(value ?? "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?:-|:|\\))?\\s*`, "i"), "")
    .replace(/^ICD-?10 Code\s*/i, "")
    .replace(/\bICD-?10 Code\b/gi, "")
    .trim();
  const normalized = normalizeLabelForComparison(cleaned);
  if (
    !cleaned ||
    /^[A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?$/i.test(cleaned) ||
    /^diagnoses?$/i.test(cleaned) ||
    /^active diagnoses$/i.test(cleaned) ||
    normalized === "icd 10 code" ||
    /^(?:primary|other) diagnosis(?: \d+)?$/.test(normalized)
  ) {
    return null;
  }
  return cleaned;
}
