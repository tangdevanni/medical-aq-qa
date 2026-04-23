import {
  type DocumentKind,
  type PreWriteValidationResult,
  preWriteValidationResultSchema,
} from "@medical-ai-qa/shared-types";
import { extractDocument } from "../extractors/extractDocument";
import { type WriteAllowlistEntry } from "../types/writeTargets";
import { type WritePageLike } from "../types/writeTargets";
import { getTargetFieldMapping, resolveFieldTarget } from "./fieldSelectorRegistry";
import { normalizeWriteComparisonValue, readFieldValue } from "./interactions/readFieldValue";

export async function runPreWriteValidation(input: {
  page: WritePageLike;
  targetDocumentKind: DocumentKind;
  targetField: string;
  proposedValue: string;
  allowlistEntry: WriteAllowlistEntry;
  expectedTargetAnchor: string | null;
  documentReader?: typeof extractDocument;
}): Promise<PreWriteValidationResult> {
  const documentReader = input.documentReader ?? extractDocument;
  const pageDocument = await documentReader(input.page as Parameters<typeof extractDocument>[0], {
    expectedDocumentKinds: [input.targetDocumentKind],
  });

  if (pageDocument.documentKind !== input.targetDocumentKind) {
    return buildValidationResult({
      canProceed: false,
      selectorUsed: null,
      currentValue: null,
      normalizedCurrentValue: null,
      normalizedProposedValue: normalizeWriteComparisonValue(input.proposedValue),
      alreadyMatches: false,
      warnings: ["Opened page did not match the target document kind."],
      guardFailures: ["UNSUPPORTED_DOCUMENT_KIND"],
    });
  }

  const mapping = getTargetFieldMapping(input.targetDocumentKind, input.targetField);
  if (!mapping) {
    return buildValidationResult({
      canProceed: false,
      selectorUsed: null,
      currentValue: null,
      normalizedCurrentValue: null,
      normalizedProposedValue: normalizeWriteComparisonValue(input.proposedValue),
      alreadyMatches: false,
      warnings: ["No selector mapping was registered for the target field."],
      guardFailures: ["TARGET_FIELD_NOT_ALLOWLISTED"],
    });
  }

  const resolvedTarget = await resolveFieldTarget(input.page, mapping);
  if (resolvedTarget.status === "AMBIGUOUS") {
    return buildValidationResult({
      canProceed: false,
      selectorUsed: resolvedTarget.selectorUsed,
      currentValue: null,
      normalizedCurrentValue: null,
      normalizedProposedValue: normalizeWriteComparisonValue(input.proposedValue),
      alreadyMatches: false,
      warnings: ["Field selector resolved to more than one visible target."],
      guardFailures: ["TARGET_SELECTOR_AMBIGUOUS"],
    });
  }

  if (resolvedTarget.status === "NOT_FOUND" || !resolvedTarget.target) {
    return buildValidationResult({
      canProceed: false,
      selectorUsed: resolvedTarget.selectorUsed,
      currentValue: null,
      normalizedCurrentValue: null,
      normalizedProposedValue: normalizeWriteComparisonValue(input.proposedValue),
      alreadyMatches: false,
      warnings: ["No visible target selector matched the allowlisted field."],
      guardFailures: ["TARGET_SELECTOR_NOT_FOUND"],
    });
  }

  const currentValue = await readFieldValue(resolvedTarget.target);
  const normalizedProposedValue = normalizeWriteComparisonValue(input.proposedValue);
  if (!normalizedProposedValue) {
    return buildValidationResult({
      canProceed: false,
      selectorUsed: resolvedTarget.selectorUsed,
      currentValue: currentValue.sanitizedValue,
      normalizedCurrentValue: currentValue.normalizedValue,
      normalizedProposedValue,
      alreadyMatches: false,
      warnings: ["Proposed value normalized to empty text."],
      guardFailures: ["PROPOSED_VALUE_EMPTY"],
    });
  }

  if (currentValue.normalizedValue === null && currentValue.rawValue === null) {
    return buildValidationResult({
      canProceed: false,
      selectorUsed: resolvedTarget.selectorUsed,
      currentValue: null,
      normalizedCurrentValue: null,
      normalizedProposedValue,
      alreadyMatches: false,
      warnings: ["Current field value could not be verified before write."],
      guardFailures: ["CURRENT_VALUE_UNVERIFIED"],
    });
  }

  if (currentValue.normalizedValue === normalizedProposedValue) {
    return buildValidationResult({
      canProceed: false,
      selectorUsed: resolvedTarget.selectorUsed,
      currentValue: currentValue.sanitizedValue,
      normalizedCurrentValue: currentValue.normalizedValue,
      normalizedProposedValue,
      alreadyMatches: true,
      warnings: ["Current field value already matched the proposed value."],
      guardFailures: [],
    });
  }

  const fieldIsEditable = await resolvedTarget.target.locator.isEnabled().catch(() => false);
  if (!fieldIsEditable) {
    return buildValidationResult({
      canProceed: false,
      selectorUsed: resolvedTarget.selectorUsed,
      currentValue: currentValue.sanitizedValue,
      normalizedCurrentValue: currentValue.normalizedValue,
      normalizedProposedValue,
      alreadyMatches: false,
      warnings: ["Resolved field target was not editable at execution time."],
      guardFailures: ["FIELD_NOT_EDITABLE"],
    });
  }

  if (!input.allowlistEntry.allowReplaceNonEmptyCurrentValue && currentValue.normalizedValue) {
    return buildValidationResult({
      canProceed: false,
      selectorUsed: resolvedTarget.selectorUsed,
      currentValue: currentValue.sanitizedValue,
      normalizedCurrentValue: currentValue.normalizedValue,
      normalizedProposedValue,
      alreadyMatches: false,
      warnings: ["Allowlist does not permit replacing a populated current value."],
      guardFailures: ["FIELD_STATE_MISMATCH"],
    });
  }

  if (!input.allowlistEntry.allowEmptyCurrentValue && !currentValue.normalizedValue) {
    return buildValidationResult({
      canProceed: false,
      selectorUsed: resolvedTarget.selectorUsed,
      currentValue: currentValue.sanitizedValue,
      normalizedCurrentValue: currentValue.normalizedValue,
      normalizedProposedValue,
      alreadyMatches: false,
      warnings: ["Allowlist requires a non-empty current value before replacement."],
      guardFailures: ["FIELD_STATE_MISMATCH"],
    });
  }

  if (input.allowlistEntry.requiresTargetAnchorMatch) {
    const normalizedTargetAnchor = normalizeWriteComparisonValue(input.expectedTargetAnchor);
    if (!normalizedTargetAnchor) {
      return buildValidationResult({
        canProceed: false,
        selectorUsed: resolvedTarget.selectorUsed,
        currentValue: currentValue.sanitizedValue,
        normalizedCurrentValue: currentValue.normalizedValue,
        normalizedProposedValue,
        alreadyMatches: false,
        warnings: ["Decision did not carry a deterministic target anchor for exact pre-write matching."],
        guardFailures: ["CURRENT_VALUE_UNVERIFIED"],
      });
    }

    if (normalizedTargetAnchor && currentValue.normalizedValue !== normalizedTargetAnchor) {
      return buildValidationResult({
        canProceed: false,
        selectorUsed: resolvedTarget.selectorUsed,
        currentValue: currentValue.sanitizedValue,
        normalizedCurrentValue: currentValue.normalizedValue,
        normalizedProposedValue,
        alreadyMatches: false,
        warnings: ["Current field value no longer matched the decision-time target anchor."],
        guardFailures: ["FIELD_STATE_MISMATCH"],
      });
    }
  }

  return buildValidationResult({
    canProceed: true,
    selectorUsed: resolvedTarget.selectorUsed,
    currentValue: currentValue.sanitizedValue,
    normalizedCurrentValue: currentValue.normalizedValue,
    normalizedProposedValue,
    alreadyMatches: false,
    warnings: [],
    guardFailures: [],
  });
}

function buildValidationResult(
  value: PreWriteValidationResult,
): PreWriteValidationResult {
  return preWriteValidationResultSchema.parse(value);
}
