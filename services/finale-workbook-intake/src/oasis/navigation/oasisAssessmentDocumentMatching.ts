export function normalizeOasisAssessmentType(value: string | null | undefined): string {
  const normalized = (value ?? "").trim().toUpperCase();
  if (/\bREC(?:ERT|ERTIFICATION)?\b/.test(normalized)) {
    return "RECERT";
  }
  if (/\bROC\b/.test(normalized) || /\bRESUMPTION\s+OF\s+CARE\b/.test(normalized)) {
    return "ROC";
  }
  if (/\bSOC\b/.test(normalized) || /\bSTART\s+OF\s+CARE\b/.test(normalized)) {
    return "SOC";
  }
  if (/\bDC\b/.test(normalized) || /\bDISCHARGE\b/.test(normalized)) {
    return "DC";
  }
  return normalized || "SOC";
}

export function deriveOasisAssessmentTypeFromWorkItem(workItem: {
  workflowTypes?: readonly string[];
  episodeContext?: {
    rfa?: string | null;
  } | null;
}): string {
  const workflowTypes = (workItem.workflowTypes ?? []).map((value) => value.toUpperCase());
  if (workflowTypes.includes("RECERT")) {
    return "RECERT";
  }
  if (workflowTypes.includes("ROC")) {
    return "ROC";
  }
  if (workflowTypes.includes("SOC")) {
    return "SOC";
  }

  const rfa = workItem.episodeContext?.rfa?.toUpperCase() ?? "";
  if (rfa.includes("REC")) {
    return "RECERT";
  }
  if (rfa.includes("ROC")) {
    return "ROC";
  }
  return "SOC";
}

function normalizeLabel(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function targetPattern(assessmentType: string): RegExp {
  switch (normalizeOasisAssessmentType(assessmentType)) {
    case "RECERT":
      return /\bREC\b|\bRECERT\b|\bRECERTIFICATION\b/;
    case "ROC":
      return /\bROC\b|\bRESUMPTION\s+OF\s+CARE\b/;
    case "DC":
      return /\bDC\b|\bDISCHARGE\b/;
    case "SOC":
    default:
      return /\bSOC\b|\bSTART\s+OF\s+CARE\b/;
  }
}

function competingAssessmentPattern(assessmentType: string): RegExp {
  switch (normalizeOasisAssessmentType(assessmentType)) {
    case "RECERT":
      return /\bSOC\b|\bSTART\s+OF\s+CARE\b|\bROC\b|\bRESUMPTION\s+OF\s+CARE\b|\bDC\b|\bDISCHARGE\b/;
    case "ROC":
      return /\bSOC\b|\bSTART\s+OF\s+CARE\b|\bREC\b|\bRECERT\b|\bRECERTIFICATION\b|\bDC\b|\bDISCHARGE\b/;
    case "DC":
      return /\bSOC\b|\bSTART\s+OF\s+CARE\b|\bREC\b|\bRECERT\b|\bRECERTIFICATION\b|\bROC\b|\bRESUMPTION\s+OF\s+CARE\b/;
    case "SOC":
    default:
      return /\bREC\b|\bRECERT\b|\bRECERTIFICATION\b|\bROC\b|\bRESUMPTION\s+OF\s+CARE\b|\bDC\b|\bDISCHARGE\b/;
  }
}

export function isOasisAssessmentLabelMatch(
  label: string | null | undefined,
  assessmentType: string,
): boolean {
  return targetPattern(assessmentType).test(normalizeLabel(label));
}

export function scoreOasisAssessmentDocumentLabel(input: {
  label: string | null | undefined;
  assessmentType: string;
  index?: number;
}): number {
  const normalizedLabel = normalizeLabel(input.label);
  if (!normalizedLabel || !targetPattern(input.assessmentType).test(normalizedLabel)) {
    return 0;
  }

  let score = 80;
  if (/\bOASIS\b/.test(normalizedLabel)) {
    score += 50;
  }
  if (/OASIS.*(?:SOC|ROC|REC|RECERT|DISCHARGE|DC)|(?:SOC|ROC|REC|RECERT|DISCHARGE|DC).*OASIS/.test(normalizedLabel)) {
    score += 20;
  }
  if (competingAssessmentPattern(input.assessmentType).test(normalizedLabel)) {
    score -= 60;
  }
  if (typeof input.index === "number") {
    score += Math.max(0, 100 - input.index);
  }

  return Math.max(0, score);
}
