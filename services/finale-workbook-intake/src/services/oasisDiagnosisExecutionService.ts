import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OasisDiagnosisPageSnapshot } from "../portal/utils/oasisDiagnosisInspector";
import type { OasisLockStateSnapshot } from "../portal/utils/oasisLockStateDetector";
import type { OasisInputActionPlan } from "./oasisInputActionPlanService";
import type { OasisDiagnosisVerificationReport } from "./oasisDiagnosisVerificationService";

export type OasisExecutionActionPerformed = {
  type: "insert_slot" | "fill_diagnosis";
  targetIndex?: number;
  targetSlot?: string;
  code?: string;
  description?: string;
  simulated: boolean;
  status: "performed" | "skipped" | "failed";
  reason?: string;
};

export type OasisExecutionValidationSummary = {
  primaryDiagnosisMatch: boolean;
  matchedDiagnosisCount: number;
  missingDiagnosisCount: number;
  extraDiagnosisCount: number;
  mismatchedDescriptionCount: number;
  mismatchedCodeCount: number;
};

export type OasisDiagnosisExecutionGuardDecision = {
  shouldExecute: boolean;
  skipReasons: string[];
};

export type OasisDiagnosisExecutionResult = {
  executed: boolean;
  lockState: OasisLockStateSnapshot["oasisLockState"];
  mode: OasisInputActionPlan["mode"];
  actionsAttempted: OasisExecutionActionPerformed[];
  actionsSucceeded: OasisExecutionActionPerformed[];
  actionsFailed: OasisExecutionActionPerformed[];
  postWriteValidationPassed: boolean;
  warnings: string[];
};

export type OasisDiagnosisExecutionExportResult = {
  filePath: string;
  result: OasisDiagnosisExecutionResult;
};

export function summarizeOasisExecutionValidation(
  report: OasisDiagnosisVerificationReport | null,
): OasisExecutionValidationSummary | null {
  if (!report) {
    return null;
  }

  return {
    primaryDiagnosisMatch: report.primaryDiagnosisMatch,
    matchedDiagnosisCount: report.matchedDiagnoses.length,
    missingDiagnosisCount: report.missingInPortal.length,
    extraDiagnosisCount: report.extraInPortal.length,
    mismatchedDescriptionCount: report.mismatchedDescriptions.length,
    mismatchedCodeCount: report.mismatchedCodes.length,
  };
}

export function didOasisExecutionValidationPass(
  summary: OasisExecutionValidationSummary | null,
): boolean {
  if (!summary) {
    return false;
  }

  return (
    summary.primaryDiagnosisMatch &&
    summary.missingDiagnosisCount === 0 &&
    summary.extraDiagnosisCount === 0 &&
    summary.mismatchedDescriptionCount === 0 &&
    summary.mismatchedCodeCount === 0
  );
}

export function evaluateOasisDiagnosisExecutionGuard(input: {
  lockState: OasisLockStateSnapshot["oasisLockState"];
  mode: OasisInputActionPlan["mode"];
  writeEnabled: boolean;
}): OasisDiagnosisExecutionGuardDecision {
  const skipReasons: string[] = [];

  if (input.lockState !== "unlocked") {
    skipReasons.push(`lock_state_${input.lockState}`);
  }
  if (input.mode !== "input_capable") {
    skipReasons.push(`mode_${input.mode}`);
  }
  if (!input.writeEnabled) {
    skipReasons.push("write_disabled");
  }

  return {
    shouldExecute: skipReasons.length === 0,
    skipReasons,
  };
}

export function buildOasisDiagnosisExecutionResult(input: {
  actionPlan: OasisInputActionPlan;
  lockState: OasisLockStateSnapshot | null;
  writeEnabled: boolean;
  executed: boolean;
  actionsPerformed: OasisExecutionActionPerformed[];
  insertClicksPerformed: number;
  fieldsUpdatedCount: number;
  validationReport: OasisDiagnosisVerificationReport | null;
  warnings?: string[];
  preExecutionSnapshot?: OasisDiagnosisPageSnapshot | null;
  postExecutionSnapshot?: OasisDiagnosisPageSnapshot | null;
}): OasisDiagnosisExecutionResult {
  const validationSummary = summarizeOasisExecutionValidation(input.validationReport);
  const attemptedActions = input.actionsPerformed.filter((action) =>
    action.status === "performed" || action.status === "failed",
  );
  const succeededActions = input.actionsPerformed.filter((action) => action.status === "performed");
  const failedActions = input.actionsPerformed.filter((action) => action.status === "failed");
  const warnings = [...new Set(input.warnings ?? [])];

  if (!input.executed) {
    const guardDecision = evaluateOasisDiagnosisExecutionGuard({
      lockState: input.lockState?.oasisLockState ?? input.actionPlan.lockState,
      mode: input.actionPlan.mode,
      writeEnabled: input.writeEnabled,
    });
    if (!warnings.includes("executionSkipped")) {
      warnings.push("executionSkipped");
    }
    warnings.push(...guardDecision.skipReasons.map((reason) => `executionSkipReason:${reason}`));
  }

  return {
    executed: input.executed,
    lockState: input.lockState?.oasisLockState ?? input.actionPlan.lockState,
    mode: input.actionPlan.mode,
    actionsAttempted: attemptedActions,
    actionsSucceeded: succeededActions,
    actionsFailed: failedActions,
    postWriteValidationPassed: input.executed
      ? didOasisExecutionValidationPass(validationSummary)
      : false,
    warnings: [...new Set(warnings)],
  };
}

export async function writeOasisExecutionResultFile(input: {
  outputDirectory: string;
  patientId: string;
  result: OasisDiagnosisExecutionResult;
}): Promise<OasisDiagnosisExecutionExportResult> {
  const patientDirectory = path.join(input.outputDirectory, "patients", input.patientId);
  await mkdir(patientDirectory, { recursive: true });
  const filePath = path.join(patientDirectory, "oasis-execution-result.json");
  await writeFile(filePath, JSON.stringify(input.result, null, 2), "utf8");
  return {
    filePath,
    result: input.result,
  };
}
