import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OasisReadyDiagnosisDocument } from "./codingInputExportService";
import type { OasisDiagnosisPageSnapshot } from "../portal/utils/oasisDiagnosisInspector";
import type { OasisLockStateSnapshot } from "../portal/utils/oasisLockStateDetector";

type PlannedDiagnosisTarget = {
  code: string;
  description: string;
  severity: 0 | 1 | 2 | 3 | 4;
  onsetType: "onset" | "exacerbate";
};

export type OasisInputAction =
  | {
      type: "insert_slot";
      targetIndex: number;
    }
  | ({
      type: "fill_diagnosis";
      targetSlot: string;
    } & PlannedDiagnosisTarget);

export type OasisInputActionPlan = {
  schemaVersion: "1";
  generatedAt: string;
  mode: "verification_only" | "input_capable";
  lockState: OasisLockStateSnapshot["oasisLockState"];
  availableSlotCount: number;
  requiredDiagnosisCount: number;
  insertDiagnosisClicksNeeded: number;
  actions: OasisInputAction[];
  warnings: string[];
};

export type OasisInputActionPlanExportResult = {
  filePath: string;
  plan: OasisInputActionPlan;
};

type PlannedDiagnosis = {
  targetSlot: string;
  code: string;
  description: string;
  severity: 0 | 1 | 2 | 3 | 4;
  onsetType: "onset" | "exacerbate";
};

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function buildPlannedDiagnoses(document: OasisReadyDiagnosisDocument): PlannedDiagnosis[] {
  const diagnoses: PlannedDiagnosis[] = [];
  if (normalizeWhitespace(document.primaryDiagnosis.description)) {
    diagnoses.push({
      targetSlot: "primary",
      code: normalizeWhitespace(document.primaryDiagnosis.code),
      description: normalizeWhitespace(document.primaryDiagnosis.description),
      severity: document.suggestedSeverity,
      onsetType: document.suggestedOnsetType,
    });
  }

  document.otherDiagnoses.forEach((diagnosis, index) => {
    if (!normalizeWhitespace(diagnosis.description)) {
      return;
    }
    diagnoses.push({
      targetSlot: String(index + 1),
      code: normalizeWhitespace(diagnosis.code),
      description: normalizeWhitespace(diagnosis.description),
      severity: document.suggestedSeverity,
      onsetType: document.suggestedOnsetType,
    });
  });

  return diagnoses;
}

export function buildOasisInputActionPlan(input: {
  readyDiagnosis: OasisReadyDiagnosisDocument;
  snapshot: OasisDiagnosisPageSnapshot | null;
  lockState: OasisLockStateSnapshot | null;
}): OasisInputActionPlan {
  const plannedDiagnoses = buildPlannedDiagnoses(input.readyDiagnosis);
  const availableSlotCount =
    input.snapshot?.page.visibleEditableSlotCount ??
    input.snapshot?.page.emptyEditableSlotCount ??
    input.snapshot?.page.rowCount ??
    0;
  const requiredDiagnosisCount = plannedDiagnoses.length;
  const insertDiagnosisClicksNeeded = Math.max(0, requiredDiagnosisCount - availableSlotCount);
  const warnings = [...(input.snapshot?.extractionWarnings ?? [])];
  const actions: OasisInputAction[] = [];
  const mode = input.lockState?.inputEligible ? "input_capable" : "verification_only";

  if (!input.snapshot) {
    warnings.push("No OASIS diagnosis snapshot was available when the input action plan was built.");
  } else {
    warnings.push(
      `Diagnosis snapshot summary: existingRows=${input.snapshot.page.existingDiagnosisRowCount} emptyEditableSlots=${input.snapshot.page.emptyEditableSlotCount} visibleEditableSlots=${input.snapshot.page.visibleEditableSlotCount} insertDiagnosisVisible=${input.snapshot.page.insertDiagnosisVisible}.`,
    );
    if (input.snapshot.page.noVisibleDiagnosisControls) {
      warnings.push("No visible diagnosis controls were detected on the Active Diagnoses page.");
    }
  }

  if (mode === "verification_only") {
    warnings.push("The note is not input-capable for this run, so write actions remain planned-but-unexecuted.");
  }

  if (mode === "input_capable") {
    const insertVisible = input.snapshot?.page.insertDiagnosisVisible ?? false;
    if (insertDiagnosisClicksNeeded > 0 && !insertVisible) {
      warnings.push("Additional diagnosis slots are required, but Insert Diagnosis was not visible in the current snapshot.");
    }

    for (let offset = 0; offset < insertDiagnosisClicksNeeded; offset += 1) {
      actions.push({
        type: "insert_slot",
        targetIndex: availableSlotCount + offset + 1,
      });
    }

    for (const diagnosis of plannedDiagnoses) {
      actions.push({
        type: "fill_diagnosis",
        targetSlot: diagnosis.targetSlot,
        code: diagnosis.code,
        description: diagnosis.description,
        severity: diagnosis.severity,
        onsetType: diagnosis.onsetType,
      });
    }
  }

  if (availableSlotCount === 0) {
    warnings.push("No currently visible diagnosis slots were detected on the Active Diagnoses page.");
  }

  return {
    schemaVersion: "1",
    generatedAt: new Date().toISOString(),
    mode,
    lockState: input.lockState?.oasisLockState ?? "unknown",
    availableSlotCount,
    requiredDiagnosisCount,
    insertDiagnosisClicksNeeded,
    actions,
    warnings: [...new Set(warnings)],
  };
}

export async function writeOasisInputActionPlanFile(input: {
  outputDirectory: string;
  patientId: string;
  plan: OasisInputActionPlan;
}): Promise<OasisInputActionPlanExportResult> {
  const patientDirectory = path.join(input.outputDirectory, "patients", input.patientId);
  await mkdir(patientDirectory, { recursive: true });
  const filePath = path.join(patientDirectory, "oasis-input-actions.json");
  await writeFile(filePath, JSON.stringify(input.plan, null, 2), "utf8");
  return {
    filePath,
    plan: input.plan,
  };
}
