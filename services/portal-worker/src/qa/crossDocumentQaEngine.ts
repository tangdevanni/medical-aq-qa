import {
  type CrossDocumentQaResult,
  crossDocumentQaResultSchema,
} from "@medical-ai-qa/shared-types";
import { compareDiagnosis } from "./compareDiagnosis";
import { compareFrequency } from "./compareFrequency";
import { compareHomebound } from "./compareHomebound";
import { compareOrders } from "./compareOrders";
import {
  buildWarning,
  emptyCrossDocumentQaResult,
  mergeComparisonResults,
  type CrossDocumentQaEngineInput,
} from "./compareShared";

export function runCrossDocumentQaEngine(
  input: CrossDocumentQaEngineInput,
): CrossDocumentQaResult {
  const bundleConfidence = input.bundleConfidence ?? inferBundleConfidence(input);
  const bundleReason = input.bundleReason ?? inferBundleReason(input, bundleConfidence);
  const documentWarnings = buildDocumentPresenceWarnings(input);
  const result = mergeComparisonResults(
    {
      ...emptyCrossDocumentQaResult(),
      bundleConfidence,
      bundleReason,
      warnings: documentWarnings,
    },
    compareDiagnosis(input),
    compareFrequency(input),
    compareHomebound(input),
    compareOrders(input),
  );

  return crossDocumentQaResultSchema.parse(result);
}

function inferBundleConfidence(
  input: CrossDocumentQaEngineInput,
): CrossDocumentQaResult["bundleConfidence"] {
  const supportingDocumentCount = [
    input.visitNote,
    input.oasis,
    input.planOfCare,
    ...input.orders,
  ].filter(Boolean).length;

  if (supportingDocumentCount >= 3) {
    return "HIGH";
  }

  if (supportingDocumentCount >= 2) {
    return "MEDIUM";
  }

  return "LOW";
}

function inferBundleReason(
  input: CrossDocumentQaEngineInput,
  bundleConfidence: CrossDocumentQaResult["bundleConfidence"],
): string {
  switch (bundleConfidence) {
    case "HIGH":
      return "Bundle confidence was inferred from multiple supporting documents in the comparison input.";
    case "MEDIUM":
      return "Bundle confidence was inferred from a limited but usable comparison set.";
    case "LOW":
    default:
      return input.visitNote || input.oasis || input.planOfCare || input.orders.length > 0
        ? "Bundle confidence was low because only sparse comparison context was available."
        : "Bundle confidence was low because no comparable documents were available.";
  }
}

function buildDocumentPresenceWarnings(
  input: CrossDocumentQaEngineInput,
) {
  const warnings = [];

  if (!input.visitNote) {
    warnings.push(buildWarning({
      code: "MISSING_VISIT_NOTE",
      message: "No visit note was available for cross-document comparison.",
    }));
  }

  if (!input.oasis) {
    warnings.push(buildWarning({
      code: "MISSING_OASIS",
      message: "No OASIS document was available for cross-document comparison.",
    }));
  }

  if (!input.planOfCare) {
    warnings.push(buildWarning({
      code: "MISSING_PLAN_OF_CARE",
      message: "No plan-of-care document was available for cross-document comparison.",
    }));
  }

  if (input.orders.length === 0) {
    warnings.push(buildWarning({
      code: "MISSING_ORDER_DOCUMENTS",
      message: "No order documents were available for cross-document comparison.",
    }));
  }

  return warnings;
}
