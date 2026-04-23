import {
  type QaDecision,
  type WriteExecutionAttempt,
  writeExecutionAttemptSchema,
} from "@medical-ai-qa/shared-types";
import { sanitizeDocumentText } from "../extractors/shared/sanitizeText";
import { type WritePageLike } from "../types/writeTargets";
import { resolveFieldTarget, getTargetFieldMapping } from "./fieldSelectorRegistry";
import { runPostWriteVerification } from "./postWriteVerifier";
import { runPreWriteValidation } from "./preWriteValidator";
import { type WriteExecutionConfig } from "./writeExecutionConfig";
import { writeFieldValue } from "./interactions/writeFieldValue";
import { evaluateWriteGuards } from "./writeGuardEvaluator";
import { buildWriteWarning } from "./writeResultHelpers";
import { SAFE_READ_RETRY_POLICIES } from "../reliability/retryPolicy";
import { withRetry } from "../reliability/withRetry";
import { sanitizeObservabilityText } from "../observability/sanitizeObservability";
import { type RetryAttemptRecord } from "../types/runtimeDiagnostics";

export async function executeWriteDecision(input: {
  page: WritePageLike;
  decision: QaDecision;
  bundleConfidence: "LOW" | "MEDIUM" | "HIGH";
  currentDocumentKind: QaDecision["proposedAction"]["targetDocumentKind"] | null;
  config: WriteExecutionConfig;
  writesAttemptedSoFar: number;
  documentReader?: typeof import("../extractors/extractDocument").extractDocument;
  onRetryRecord?: (record: RetryAttemptRecord) => void;
}): Promise<WriteExecutionAttempt> {
  const executedAt = new Date().toISOString();
  if (input.config.safetyMode === "READ_ONLY") {
    return buildAttempt({
      status: "BLOCKED",
      mode: input.config.mode,
      eligibility: "INELIGIBLE",
      decision: input.decision,
      selectorUsed: null,
      previousValue: null,
      proposedValue: sanitizeDocumentText(input.decision.proposedAction.proposedValue, 48),
      finalValue: null,
      verificationPassed: false,
      guardFailures: ["READ_ONLY_MODE_ENFORCED"],
      warnings: [buildWriteWarning("READ_ONLY", "Write blocked because safetyMode=READ_ONLY.")],
      executedAt,
      bundleConfidence: input.bundleConfidence,
      decisionConfidence: input.decision.confidence,
    });
  }

  const guardEvaluation = evaluateWriteGuards({
    decision: input.decision,
    bundleConfidence: input.bundleConfidence,
    currentDocumentKind: input.currentDocumentKind,
    config: input.config,
    writesAttemptedSoFar: input.writesAttemptedSoFar,
  });

  if (!guardEvaluation.eligible || !guardEvaluation.allowlistEntry) {
    return buildAttempt({
      status: "BLOCKED",
      mode: input.config.mode,
      eligibility: guardEvaluation.eligibility,
      decision: input.decision,
      selectorUsed: null,
      previousValue: null,
      proposedValue: sanitizeDocumentText(input.decision.proposedAction.proposedValue, 48),
      finalValue: null,
      verificationPassed: false,
      guardFailures: guardEvaluation.reasons,
      warnings: guardEvaluation.reasons.map((reason) => buildWriteWarning(reason, `Write blocked by guard: ${reason}.`)),
      executedAt,
      bundleConfidence: input.bundleConfidence,
      decisionConfidence: input.decision.confidence,
    });
  }

  const preWriteValidation = await runPreWriteValidation({
    page: input.page,
    targetDocumentKind: input.decision.proposedAction.targetDocumentKind!,
    targetField: input.decision.proposedAction.targetField!,
    proposedValue: input.decision.proposedAction.proposedValue!,
    allowlistEntry: guardEvaluation.allowlistEntry,
    expectedTargetAnchor: input.decision.evidence.targetAnchors[0]?.summary ?? null,
    documentReader: input.documentReader,
  });

  if (preWriteValidation.alreadyMatches) {
    return buildAttempt({
      status: "SKIPPED",
      mode: input.config.mode,
      eligibility: "ELIGIBLE",
      decision: input.decision,
      selectorUsed: preWriteValidation.selectorUsed,
      previousValue: preWriteValidation.currentValue,
      proposedValue: sanitizeDocumentText(input.decision.proposedAction.proposedValue, 48),
      finalValue: preWriteValidation.currentValue,
      verificationPassed: true,
      guardFailures: [],
      warnings: preWriteValidation.warnings.map((warning) => buildWriteWarning("NO_OP", warning)),
      executedAt,
      bundleConfidence: input.bundleConfidence,
      decisionConfidence: input.decision.confidence,
    });
  }

  if (!preWriteValidation.canProceed) {
    return buildAttempt({
      status: "BLOCKED",
      mode: input.config.mode,
      eligibility: "REVIEW_REQUIRED",
      decision: input.decision,
      selectorUsed: preWriteValidation.selectorUsed,
      previousValue: preWriteValidation.currentValue,
      proposedValue: sanitizeDocumentText(input.decision.proposedAction.proposedValue, 48),
      finalValue: null,
      verificationPassed: false,
      guardFailures: preWriteValidation.guardFailures,
      warnings: preWriteValidation.warnings.map((warning) => buildWriteWarning("PREWRITE", warning)),
      executedAt,
      bundleConfidence: input.bundleConfidence,
      decisionConfidence: input.decision.confidence,
    });
  }

  const mapping = getTargetFieldMapping(
    input.decision.proposedAction.targetDocumentKind,
    input.decision.proposedAction.targetField,
  );
  const resolvedTarget = mapping
    ? (await withRetry({
      policy: SAFE_READ_RETRY_POLICIES.selectorResolution,
      operation: `resolve-write-target:${input.decision.proposedAction.targetField}`,
      execute: () => resolveFieldTarget(input.page, mapping),
      documentKind: input.decision.proposedAction.targetDocumentKind,
      targetField: input.decision.proposedAction.targetField,
      onRetryRecord: input.onRetryRecord,
    })).result
    : null;
  if (!resolvedTarget || resolvedTarget.status !== "FOUND" || !resolvedTarget.target) {
    return buildAttempt({
      status: "BLOCKED",
      mode: input.config.mode,
      eligibility: "REVIEW_REQUIRED",
      decision: input.decision,
      selectorUsed: preWriteValidation.selectorUsed,
      previousValue: preWriteValidation.currentValue,
      proposedValue: sanitizeDocumentText(input.decision.proposedAction.proposedValue, 48),
      finalValue: null,
      verificationPassed: false,
      guardFailures: resolvedTarget?.status === "AMBIGUOUS"
        ? ["TARGET_SELECTOR_AMBIGUOUS", "EXECUTABLE_CONTROL_AMBIGUOUS", "SELECTOR_CARDINALITY_UNEXPECTED"]
        : ["TARGET_SELECTOR_NOT_FOUND", "EXECUTABLE_CONTROL_MISSING", "RETRY_EXHAUSTED"],
      warnings: [buildWriteWarning("SELECTOR", "Target field could not be re-resolved before write.")],
      executedAt,
      bundleConfidence: input.bundleConfidence,
      decisionConfidence: input.decision.confidence,
    });
  }

  if (input.config.mode === "DRY_RUN") {
    return buildAttempt({
      status: "SKIPPED",
      mode: input.config.mode,
      eligibility: "ELIGIBLE",
      decision: input.decision,
      selectorUsed: preWriteValidation.selectorUsed,
      previousValue: preWriteValidation.currentValue,
      proposedValue: sanitizeDocumentText(input.decision.proposedAction.proposedValue, 48),
      finalValue: preWriteValidation.currentValue,
      verificationPassed: false,
      guardFailures: ["WRITE_MODE_DRY_RUN"],
      warnings: [buildWriteWarning("DRY_RUN", "Write was eligible but not executed because mode=DRY_RUN.")],
      executedAt,
      bundleConfidence: input.bundleConfidence,
      decisionConfidence: input.decision.confidence,
    });
  }

  try {
    await writeFieldValue(resolvedTarget.target, input.decision.proposedAction.proposedValue!);
  } catch (error: unknown) {
    return buildAttempt({
      status: "FAILED",
      mode: input.config.mode,
      eligibility: "ELIGIBLE",
      decision: input.decision,
      selectorUsed: preWriteValidation.selectorUsed,
      previousValue: preWriteValidation.currentValue,
      proposedValue: sanitizeDocumentText(input.decision.proposedAction.proposedValue, 48),
      finalValue: null,
      verificationPassed: false,
      guardFailures: [],
      warnings: [buildWriteWarning(
        "WRITE_FAILED",
        sanitizeObservabilityText(error instanceof Error ? error.message : "Field write failed.", 120),
      )],
      executedAt,
      bundleConfidence: input.bundleConfidence,
      decisionConfidence: input.decision.confidence,
    });
  }

  const postWriteVerification = await runPostWriteVerification({
    target: resolvedTarget.target,
    proposedValue: input.decision.proposedAction.proposedValue!,
  });

  if (!postWriteVerification.verificationPassed) {
    return buildAttempt({
      status: "VERIFICATION_FAILED",
      mode: input.config.mode,
      eligibility: "ELIGIBLE",
      decision: input.decision,
      selectorUsed: preWriteValidation.selectorUsed,
      previousValue: preWriteValidation.currentValue,
      proposedValue: sanitizeDocumentText(input.decision.proposedAction.proposedValue, 48),
      finalValue: postWriteVerification.finalValue,
      verificationPassed: false,
      guardFailures: postWriteVerification.guardFailures,
      warnings: postWriteVerification.warnings.map((warning) => buildWriteWarning("VERIFY", warning)),
      executedAt,
      bundleConfidence: input.bundleConfidence,
      decisionConfidence: input.decision.confidence,
    });
  }

  return buildAttempt({
    status: "VERIFIED",
    mode: input.config.mode,
    eligibility: "ELIGIBLE",
    decision: input.decision,
    selectorUsed: preWriteValidation.selectorUsed,
    previousValue: preWriteValidation.currentValue,
    proposedValue: sanitizeDocumentText(input.decision.proposedAction.proposedValue, 48),
    finalValue: postWriteVerification.finalValue,
    verificationPassed: true,
    guardFailures: [],
    warnings: [],
    executedAt,
    bundleConfidence: input.bundleConfidence,
    decisionConfidence: input.decision.confidence,
  });
}

export function buildBlockedWriteAttempt(input: {
  decision: QaDecision;
  mode: WriteExecutionAttempt["mode"];
  eligibility: WriteExecutionAttempt["eligibility"];
  guardFailures: WriteExecutionAttempt["guardFailures"];
  bundleConfidence: WriteExecutionAttempt["audit"]["bundleConfidence"];
  warnings?: WriteExecutionAttempt["warnings"];
}): WriteExecutionAttempt {
  return buildAttempt({
    status: "BLOCKED",
    mode: input.mode,
    eligibility: input.eligibility,
    decision: input.decision,
    selectorUsed: null,
    previousValue: null,
    proposedValue: sanitizeDocumentText(input.decision.proposedAction.proposedValue, 48),
    finalValue: null,
    verificationPassed: false,
    guardFailures: input.guardFailures,
    warnings: input.warnings ?? input.guardFailures.map((reason) => buildWriteWarning(reason, `Write blocked by guard: ${reason}.`)),
    executedAt: new Date().toISOString(),
    bundleConfidence: input.bundleConfidence,
    decisionConfidence: input.decision.confidence,
  });
}

function buildAttempt(input: {
  status: WriteExecutionAttempt["status"];
  mode: WriteExecutionAttempt["mode"];
  eligibility: WriteExecutionAttempt["eligibility"];
  decision: QaDecision;
  selectorUsed: string | null;
  previousValue: string | null;
  proposedValue: string | null;
  finalValue: string | null;
  verificationPassed: boolean;
  guardFailures: WriteExecutionAttempt["guardFailures"];
  warnings: WriteExecutionAttempt["warnings"];
  executedAt: string;
  bundleConfidence: WriteExecutionAttempt["audit"]["bundleConfidence"];
  decisionConfidence: WriteExecutionAttempt["audit"]["decisionConfidence"];
}): WriteExecutionAttempt {
  return writeExecutionAttemptSchema.parse({
    status: input.status,
    mode: input.mode,
    eligibility: input.eligibility,
    decisionType: input.decision.decisionType,
    issueType: input.decision.issueType,
    targetDocumentKind: input.decision.proposedAction.targetDocumentKind ?? null,
    targetField: input.decision.proposedAction.targetField ?? null,
    selectorUsed: input.selectorUsed,
    previousValue: input.previousValue,
    proposedValue: input.proposedValue,
    finalValue: input.finalValue,
    verificationPassed: input.verificationPassed,
    guardFailures: input.guardFailures,
    warnings: input.warnings,
    audit: {
      executedAt: input.executedAt,
      bundleConfidence: input.bundleConfidence,
      decisionConfidence: input.decisionConfidence,
    },
  });
}
