import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OasisReadyDiagnosisDocument } from "./codingInputExportService";
import type {
  OasisDiagnosisPageSnapshot,
  OasisDiagnosisRowSnapshot,
} from "../portal/utils/oasisDiagnosisInspector";
import { isComparableOasisDiagnosisRow } from "../portal/utils/oasisDiagnosisInspector";
import type { OasisLockStateSnapshot } from "../portal/utils/oasisLockStateDetector";

const ICD10_EXACT_REGEX = /^[A-TV-Z][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?$/;

type VerificationDiagnosisType = "primary" | "other";

type ReadyDiagnosisEntry = {
  diagnosisType: VerificationDiagnosisType;
  slotLabel: string;
  code: string;
  description: string;
};

export type OasisDiagnosisVerificationMatch = {
  diagnosisType: VerificationDiagnosisType;
  slotLabel: string;
  portalRowIndex: number;
  code: string;
  description: string;
  portalCode: string;
  portalDescription: string;
  matchType: "exact" | "normalized";
  score: number;
};

export type OasisDiagnosisVerificationMismatch = {
  diagnosisType: VerificationDiagnosisType;
  slotLabel: string;
  portalRowIndex: number;
  expected: string;
  actual: string;
};

export type OasisDiagnosisVerificationMissing = {
  diagnosisType: VerificationDiagnosisType;
  slotLabel: string;
  code: string;
  description: string;
};

export type OasisDiagnosisVerificationExtra = {
  portalRowIndex: number;
  code: string;
  description: string;
};

export type OasisDiagnosisVerificationReport = {
  schemaVersion: "1";
  generatedAt: string;
  mode: "verification_only" | "input_capable";
  lockState: OasisLockStateSnapshot["oasisLockState"];
  primaryDiagnosisMatch: boolean;
  matchedDiagnoses: OasisDiagnosisVerificationMatch[];
  missingInPortal: OasisDiagnosisVerificationMissing[];
  extraInPortal: OasisDiagnosisVerificationExtra[];
  mismatchedDescriptions: OasisDiagnosisVerificationMismatch[];
  mismatchedCodes: OasisDiagnosisVerificationMismatch[];
  warnings: string[];
};

export type OasisDiagnosisVerificationExportResult = {
  filePath: string;
  report: OasisDiagnosisVerificationReport;
};

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeText(value: string | null | undefined): string {
  return normalizeWhitespace(value)
    .toUpperCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIcd(value: string | null | undefined): string {
  const normalized = normalizeWhitespace(value)
    .toUpperCase()
    .replace(/[^A-Z0-9.]/g, "")
    .trim();
  return ICD10_EXACT_REGEX.test(normalized) ? normalized : "";
}

function tokenize(value: string | null | undefined): string[] {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(" ").filter((token) => token.length >= 3) : [];
}

function tokenOverlap(left: string | null | undefined, right: string | null | undefined): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let overlap = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(leftSet.size, rightSet.size);
}

function buildPortalDescription(row: OasisDiagnosisRowSnapshot): string {
  return normalizeWhitespace(row.description) || normalizeWhitespace(row.rawText).slice(0, 220);
}

function buildReadyDiagnosisEntries(document: OasisReadyDiagnosisDocument): ReadyDiagnosisEntry[] {
  const entries: ReadyDiagnosisEntry[] = [];
  if (normalizeWhitespace(document.primaryDiagnosis.description)) {
    entries.push({
      diagnosisType: "primary",
      slotLabel: "primary",
      code: normalizeIcd(document.primaryDiagnosis.code),
      description: normalizeWhitespace(document.primaryDiagnosis.description),
    });
  }

  document.otherDiagnoses.forEach((diagnosis, index) => {
    if (!normalizeWhitespace(diagnosis.description)) {
      return;
    }
    entries.push({
      diagnosisType: "other",
      slotLabel: String(index + 1),
      code: normalizeIcd(diagnosis.code),
      description: normalizeWhitespace(diagnosis.description),
    });
  });

  return entries;
}

function scoreReadyToPortalMatch(entry: ReadyDiagnosisEntry, row: OasisDiagnosisRowSnapshot): number {
  let score = 0;
  const expectedCode = normalizeIcd(entry.code);
  const portalCode = normalizeIcd(row.icd10Code);
  const portalDescription = buildPortalDescription(row);
  const descEqual = normalizeText(entry.description) === normalizeText(portalDescription);

  if (entry.diagnosisType === "primary" && row.sectionLabel === "PRIMARY DIAGNOSIS") {
    score += 0.2;
  }
  if (entry.diagnosisType === "other" && row.sectionLabel === "OTHER DIAGNOSIS") {
    score += 0.05;
  }
  if (expectedCode && portalCode && expectedCode === portalCode) {
    score += 0.6;
  } else if (expectedCode && portalCode && expectedCode !== portalCode) {
    score -= 0.1;
  }
  if (descEqual) {
    score += 0.3;
  } else {
    score += tokenOverlap(entry.description, portalDescription) * 0.3;
  }

  return score;
}

function classifyMatch(entry: ReadyDiagnosisEntry, row: OasisDiagnosisRowSnapshot, score: number): "exact" | "normalized" | "mismatch" {
  const expectedCode = normalizeIcd(entry.code);
  const portalCode = normalizeIcd(row.icd10Code);
  const portalDescription = buildPortalDescription(row);
  const descEqual = normalizeText(entry.description) === normalizeText(portalDescription);
  const codeEqual = expectedCode === portalCode;

  if (descEqual && codeEqual) {
    return "exact";
  }
  if (score >= 0.45) {
    return "normalized";
  }
  return "mismatch";
}

export function buildOasisDiagnosisVerificationReport(input: {
  readyDiagnosis: OasisReadyDiagnosisDocument;
  snapshot: OasisDiagnosisPageSnapshot;
  lockState: OasisLockStateSnapshot | null;
}): OasisDiagnosisVerificationReport {
  const readyEntries = buildReadyDiagnosisEntries(input.readyDiagnosis);
  const comparableRows = input.snapshot.rows.filter(isComparableOasisDiagnosisRow);
  const usedRows = new Set<number>();
  const matchedDiagnoses: OasisDiagnosisVerificationMatch[] = [];
  const missingInPortal: OasisDiagnosisVerificationMissing[] = [];
  const extraInPortal: OasisDiagnosisVerificationExtra[] = [];
  const mismatchedDescriptions: OasisDiagnosisVerificationMismatch[] = [];
  const mismatchedCodes: OasisDiagnosisVerificationMismatch[] = [];
  const warnings = [...input.snapshot.extractionWarnings];

  for (const entry of readyEntries) {
    let bestIndex = -1;
    let bestScore = -1;
    for (const [portalRowIndex, row] of comparableRows.entries()) {
      if (usedRows.has(portalRowIndex)) {
        continue;
      }
      const score = scoreReadyToPortalMatch(entry, row);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = portalRowIndex;
      }
    }

    if (bestIndex < 0 || bestScore < 0.45) {
      missingInPortal.push({
        diagnosisType: entry.diagnosisType,
        slotLabel: entry.slotLabel,
        code: entry.code,
        description: entry.description,
      });
      continue;
    }

    usedRows.add(bestIndex);
    const row = comparableRows[bestIndex]!;
    const portalCode = normalizeIcd(row.icd10Code);
    const portalDescription = buildPortalDescription(row);
    const matchType = classifyMatch(entry, row, bestScore);

    if (matchType === "mismatch") {
      missingInPortal.push({
        diagnosisType: entry.diagnosisType,
        slotLabel: entry.slotLabel,
        code: entry.code,
        description: entry.description,
      });
      extraInPortal.push({
        portalRowIndex: bestIndex,
        code: portalCode,
        description: portalDescription,
      });
      continue;
    }

    matchedDiagnoses.push({
      diagnosisType: entry.diagnosisType,
      slotLabel: entry.slotLabel,
      portalRowIndex: bestIndex,
      code: entry.code,
      description: entry.description,
      portalCode,
      portalDescription,
      matchType,
      score: Number(bestScore.toFixed(3)),
    });

    if (normalizeText(entry.description) !== normalizeText(portalDescription)) {
      mismatchedDescriptions.push({
        diagnosisType: entry.diagnosisType,
        slotLabel: entry.slotLabel,
        portalRowIndex: bestIndex,
        expected: entry.description,
        actual: portalDescription,
      });
    }
    if (entry.code !== portalCode) {
      mismatchedCodes.push({
        diagnosisType: entry.diagnosisType,
        slotLabel: entry.slotLabel,
        portalRowIndex: bestIndex,
        expected: entry.code || "(blank)",
        actual: portalCode || "(blank)",
      });
    }
  }

  comparableRows.forEach((row, portalRowIndex) => {
    if (usedRows.has(portalRowIndex)) {
      return;
    }
    extraInPortal.push({
      portalRowIndex,
      code: normalizeIcd(row.icd10Code),
      description: buildPortalDescription(row),
    });
  });

  if (!input.lockState || input.lockState.oasisLockState === "unknown") {
    warnings.push("Verification report built without a confirmed OASIS lock state.");
  }
  if (comparableRows.length !== input.snapshot.rows.length) {
    warnings.push(
      `Verification ignored ${input.snapshot.rows.length - comparableRows.length} empty diagnosis slot(s) from the portal snapshot.`,
    );
  }

  const primaryMatch = matchedDiagnoses.some((match) =>
    match.diagnosisType === "primary" &&
    !mismatchedDescriptions.some((mismatch) => mismatch.diagnosisType === "primary") &&
    !mismatchedCodes.some((mismatch) => mismatch.diagnosisType === "primary"),
  );

  if (missingInPortal.length > 0) {
    warnings.push(`${missingInPortal.length} structured diagnoses were not found on the portal.`);
  }
  if (extraInPortal.length > 0) {
    warnings.push(`${extraInPortal.length} portal diagnosis rows were not represented in oasis-ready-diagnosis.json.`);
  }

  return {
    schemaVersion: "1",
    generatedAt: new Date().toISOString(),
    mode: input.lockState?.verificationOnly ? "verification_only" : "input_capable",
    lockState: input.lockState?.oasisLockState ?? "unknown",
    primaryDiagnosisMatch: primaryMatch,
    matchedDiagnoses,
    missingInPortal,
    extraInPortal,
    mismatchedDescriptions,
    mismatchedCodes,
    warnings: [...new Set(warnings)],
  };
}

export async function writeOasisDiagnosisVerificationFile(input: {
  outputDirectory: string;
  patientId: string;
  report: OasisDiagnosisVerificationReport;
}): Promise<OasisDiagnosisVerificationExportResult> {
  const patientDirectory = path.join(input.outputDirectory, "patients", input.patientId);
  await mkdir(patientDirectory, { recursive: true });
  const filePath = path.join(patientDirectory, "oasis-diagnosis-verification.json");
  await writeFile(filePath, JSON.stringify(input.report, null, 2), "utf8");
  return {
    filePath,
    report: input.report,
  };
}
