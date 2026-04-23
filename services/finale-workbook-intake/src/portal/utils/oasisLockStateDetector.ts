import type { Locator, Page } from "@playwright/test";
import type { Logger } from "pino";
import { oasisLockStateSelectors } from "../selectors/oasis-lock-state.selectors";
import {
  resolveFirstVisibleLocator,
  resolveVisibleLocatorList,
  selectorAttemptToEvidence,
  waitForPortalPageSettled,
  type PortalDebugConfig,
} from "./locatorResolution";
import type { OasisDiagnosisPageSnapshot } from "./oasisDiagnosisInspector";

export type OasisLockStateValue = "locked" | "unlocked" | "unknown";

export interface OasisLockStateSnapshot {
  schemaVersion: "1";
  capturedAt: string;
  pageUrl: string;
  oasisLockState: OasisLockStateValue;
  unlockControlVisible: boolean;
  unlockControlText: string | null;
  fieldsEditable: boolean;
  verificationOnly: boolean;
  inputEligible: boolean;
  notes: string[];
  selectorEvidence: string[];
}

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

async function readLocatorLabel(locator: Locator): Promise<string | null> {
  const label = normalizeWhitespace(
    (await locator.getAttribute("aria-label").catch(() => null)) ??
    (await locator.getAttribute("title").catch(() => null)) ??
    (await locator.textContent().catch(() => null)),
  );

  return label.length > 1 ? label.slice(0, 240) : null;
}

function deriveFinalState(input: {
  unlockControlVisible: boolean;
  editableSignalCount: number;
  readOnlySignalCount: number;
  priorNotes?: string[];
}): Omit<OasisLockStateSnapshot, "schemaVersion" | "capturedAt" | "pageUrl" | "unlockControlText" | "selectorEvidence"> {
  const notes = [...new Set(input.priorNotes ?? [])];

  if (input.unlockControlVisible) {
    notes.push("Unlock - Oasis control is visible in the top action bar; treat the note as locked.");
    notes.push("Diagnosis workflow must remain verification-only until the note is explicitly unlocked.");
    return {
      oasisLockState: "locked",
      unlockControlVisible: true,
      fieldsEditable: false,
      verificationOnly: true,
      inputEligible: false,
      notes,
    };
  }

  if (input.editableSignalCount > 0) {
    notes.push("Editable field signals are visible and Unlock - Oasis is not visible; treat the note as unlocked.");
    notes.push("The diagnosis workflow is input-capable, but live writes remain disabled unless separately feature-flagged.");
    return {
      oasisLockState: "unlocked",
      unlockControlVisible: false,
      fieldsEditable: true,
      verificationOnly: false,
      inputEligible: true,
      notes,
    };
  }

  if (input.readOnlySignalCount > 0) {
    notes.push("Read-only field signals were detected, but Unlock - Oasis was not visible.");
  } else {
    notes.push("Could not confirm lock state from the top action bar or visible field signals.");
  }
  notes.push("The workflow will stay verification-only until editability is confirmed.");

  return {
    oasisLockState: "unknown",
    unlockControlVisible: false,
    fieldsEditable: false,
    verificationOnly: true,
    inputEligible: false,
    notes,
  };
}

export async function detectOasisLockState(input: {
  page: Page;
  logger?: Logger;
  debugConfig?: PortalDebugConfig;
}): Promise<OasisLockStateSnapshot> {
  await waitForPortalPageSettled(input.page, input.debugConfig);

  const selectorEvidence: string[] = [];
  const actionBarResolution = await resolveVisibleLocatorList({
    page: input.page,
    candidates: oasisLockStateSelectors.topActionBar,
    step: "oasis_action_bar",
    logger: input.logger,
    debugConfig: input.debugConfig,
    maxItems: 4,
  });
  selectorEvidence.push(...actionBarResolution.attempts.map(selectorAttemptToEvidence));

  const unlockResolution = await resolveFirstVisibleLocator({
    page: input.page,
    candidates: oasisLockStateSelectors.unlockControl,
    step: "oasis_unlock_control",
    logger: input.logger,
    debugConfig: input.debugConfig,
    settle: () => waitForPortalPageSettled(input.page, input.debugConfig),
  });
  selectorEvidence.push(...unlockResolution.attempts.map(selectorAttemptToEvidence));

  const editableResolution = await resolveVisibleLocatorList({
    page: input.page,
    candidates: oasisLockStateSelectors.editableFieldSignals,
    step: "oasis_editable_field_signals",
    logger: input.logger,
    debugConfig: input.debugConfig,
    maxItems: 12,
  });
  selectorEvidence.push(...editableResolution.attempts.map(selectorAttemptToEvidence));

  const readOnlyResolution = await resolveVisibleLocatorList({
    page: input.page,
    candidates: oasisLockStateSelectors.readOnlyFieldSignals,
    step: "oasis_readonly_field_signals",
    logger: input.logger,
    debugConfig: input.debugConfig,
    maxItems: 12,
  });
  selectorEvidence.push(...readOnlyResolution.attempts.map(selectorAttemptToEvidence));

  const unlockControlVisible = Boolean(unlockResolution.locator);
  const unlockControlText = unlockResolution.locator
    ? await readLocatorLabel(unlockResolution.locator)
    : null;
  const notes: string[] = [];
  if (actionBarResolution.items.length === 0) {
    notes.push("Top action bar was not confidently resolved while probing lock state.");
  }
  if (unlockControlVisible && editableResolution.items.length > 0) {
    notes.push("Unlock control and editable field signals were both visible; lock signal takes precedence.");
  }

  const derived = deriveFinalState({
    unlockControlVisible,
    editableSignalCount: editableResolution.items.length,
    readOnlySignalCount: readOnlyResolution.items.length,
    priorNotes: notes,
  });

  return {
    schemaVersion: "1",
    capturedAt: new Date().toISOString(),
    pageUrl: input.page.url(),
    oasisLockState: derived.oasisLockState,
    unlockControlVisible,
    unlockControlText,
    fieldsEditable: derived.fieldsEditable,
    verificationOnly: derived.verificationOnly,
    inputEligible: derived.inputEligible,
    notes: derived.notes,
    selectorEvidence,
  };
}

export function refineOasisLockStateWithDiagnosisSnapshot(input: {
  lockState: OasisLockStateSnapshot;
  diagnosisPageSnapshot: OasisDiagnosisPageSnapshot | null;
}): OasisLockStateSnapshot {
  if (!input.diagnosisPageSnapshot) {
    return input.lockState;
  }

  const editableFieldCount = input.diagnosisPageSnapshot.rows.flatMap((row) => row.selectorEvidence)
    .filter((field) =>
      ["icd10Code", "description", "onsetDate"].includes(field.field) &&
      field.found &&
      field.disabled === false &&
      field.readOnly === false,
    ).length;
  const readOnlyFieldCount = input.diagnosisPageSnapshot.rows.flatMap((row) => row.selectorEvidence)
    .filter((field) =>
      ["icd10Code", "description", "onsetDate"].includes(field.field) &&
      field.found &&
      (field.disabled === true || field.readOnly === true),
    ).length;

  const notes = [...input.lockState.notes];
  notes.push(
    `Diagnosis snapshot rowCount=${input.diagnosisPageSnapshot.rows.length} existingRows=${input.diagnosisPageSnapshot.page.existingDiagnosisRowCount} emptyEditableSlots=${input.diagnosisPageSnapshot.page.emptyEditableSlotCount} visibleEditableSlots=${input.diagnosisPageSnapshot.page.visibleEditableSlotCount} insertDiagnosisVisible=${input.diagnosisPageSnapshot.page.insertDiagnosisVisible}.`,
  );

  if (input.lockState.oasisLockState === "locked") {
    return {
      ...input.lockState,
      notes: [...new Set(notes)],
    };
  }

  const hasEditableSnapshotSignals =
    editableFieldCount > 0 || input.diagnosisPageSnapshot.page.insertDiagnosisVisible;

  if (hasEditableSnapshotSignals) {
    notes.push("Diagnosis snapshot confirmed editable signals on the Active Diagnoses section.");
    return {
      ...input.lockState,
      oasisLockState: "unlocked",
      fieldsEditable: true,
      verificationOnly: false,
      inputEligible: true,
      notes: [...new Set(notes)],
    };
  }

  if (readOnlyFieldCount > 0 && input.lockState.oasisLockState === "unknown") {
    notes.push("Diagnosis snapshot showed readonly/disabled diagnosis fields; staying verification-only.");
  }

  return {
    ...input.lockState,
    notes: [...new Set(notes)],
  };
}
