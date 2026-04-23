import { describe, expect, it } from "vitest";
import {
  buildOasisDiagnosisExecutionResult,
  evaluateOasisDiagnosisExecutionGuard,
} from "../services/oasisDiagnosisExecutionService";
import type { OasisDiagnosisVerificationReport } from "../services/oasisDiagnosisVerificationService";
import type { OasisInputActionPlan } from "../services/oasisInputActionPlanService";

const baseActionPlan: OasisInputActionPlan = {
  schemaVersion: "1",
  generatedAt: "2026-04-05T00:00:00.000Z",
  mode: "input_capable",
  lockState: "unlocked",
  availableSlotCount: 2,
  requiredDiagnosisCount: 3,
  insertDiagnosisClicksNeeded: 1,
  actions: [],
  warnings: [],
};

const passingValidationReport: OasisDiagnosisVerificationReport = {
  schemaVersion: "1",
  generatedAt: "2026-04-05T00:00:00.000Z",
  mode: "input_capable",
  lockState: "unlocked",
  primaryDiagnosisMatch: true,
  matchedDiagnoses: [],
  missingInPortal: [],
  extraInPortal: [],
  mismatchedDescriptions: [],
  mismatchedCodes: [],
  warnings: [],
};

describe("evaluateOasisDiagnosisExecutionGuard", () => {
  it("requires unlocked, input-capable, and write-enabled together", () => {
    expect(evaluateOasisDiagnosisExecutionGuard({
      lockState: "locked",
      mode: "input_capable",
      writeEnabled: true,
    })).toEqual({
      shouldExecute: false,
      skipReasons: ["lock_state_locked"],
    });

    expect(evaluateOasisDiagnosisExecutionGuard({
      lockState: "unlocked",
      mode: "verification_only",
      writeEnabled: true,
    })).toEqual({
      shouldExecute: false,
      skipReasons: ["mode_verification_only"],
    });

    expect(evaluateOasisDiagnosisExecutionGuard({
      lockState: "unlocked",
      mode: "input_capable",
      writeEnabled: false,
    })).toEqual({
      shouldExecute: false,
      skipReasons: ["write_disabled"],
    });
  });
});

describe("buildOasisDiagnosisExecutionResult", () => {
  it("emits the requested execution artifact shape for skipped runs", () => {
    const result = buildOasisDiagnosisExecutionResult({
      actionPlan: {
        ...baseActionPlan,
        mode: "verification_only",
        lockState: "locked",
      },
      lockState: {
        schemaVersion: "1",
        capturedAt: "2026-04-05T00:00:00.000Z",
        pageUrl: "https://example.test/oasis",
        oasisLockState: "locked",
        unlockControlVisible: true,
        unlockControlText: "Unlock - Oasis",
        fieldsEditable: false,
        verificationOnly: true,
        inputEligible: false,
        notes: [],
        selectorEvidence: [],
      },
      writeEnabled: false,
      executed: false,
      actionsPerformed: [],
      insertClicksPerformed: 0,
      fieldsUpdatedCount: 0,
      validationReport: passingValidationReport,
      warnings: [],
    });

    expect(result).toEqual({
      executed: false,
      lockState: "locked",
      mode: "verification_only",
      actionsAttempted: [],
      actionsSucceeded: [],
      actionsFailed: [],
      postWriteValidationPassed: false,
      warnings: expect.arrayContaining([
        "executionSkipped",
        "executionSkipReason:lock_state_locked",
        "executionSkipReason:mode_verification_only",
        "executionSkipReason:write_disabled",
      ]),
    });
  });

  it("marks post-write validation only when a live execution run passes verification", () => {
    const result = buildOasisDiagnosisExecutionResult({
      actionPlan: baseActionPlan,
      lockState: null,
      writeEnabled: true,
      executed: true,
      actionsPerformed: [
        {
          type: "insert_slot",
          targetIndex: 3,
          simulated: false,
          status: "performed",
        },
        {
          type: "fill_diagnosis",
          targetSlot: "primary",
          code: "R13.10",
          description: "Dysphagia, unspecified",
          simulated: false,
          status: "failed",
          reason: "target_row_not_found",
        },
      ],
      insertClicksPerformed: 1,
      fieldsUpdatedCount: 2,
      validationReport: passingValidationReport,
      warnings: [],
    });

    expect(result.executed).toBe(true);
    expect(result.actionsAttempted).toHaveLength(2);
    expect(result.actionsSucceeded).toHaveLength(1);
    expect(result.actionsFailed).toHaveLength(1);
    expect(result.postWriteValidationPassed).toBe(true);
  });
});
