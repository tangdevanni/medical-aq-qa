import type { Locator, Page } from "@playwright/test";
import type { Logger } from "pino";
import { oasisDiagnosisSelectors } from "../selectors/oasis-diagnosis.selectors";
import {
  getOasisDiagnosisRowRejectionReason,
  type OasisDiagnosisRowFieldSignal,
} from "./oasisDiagnosisRowHeuristics";
import {
  resolveFirstVisibleLocator,
  resolveVisibleLocatorList,
  selectorAttemptToEvidence,
  waitForPortalPageSettled,
  type PortalDebugConfig,
} from "./locatorResolution";

export interface OasisDiagnosisFieldSelectorEvidence {
  field:
    | "icd10Code"
    | "onsetDate"
    | "description"
    | "severity"
    | "timingFlags";
  selectorUsed: string | null;
  found: boolean;
  valueSource: "value" | "text" | "checked_label" | "derived" | "none";
  disabled: boolean | null;
  readOnly: boolean | null;
}

export interface OasisDiagnosisRowSnapshot {
  rowIndex: number;
  rowRole: "primary" | "other" | "unknown";
  rowKind: "existing_diagnosis" | "empty_editable_slot" | "empty_readonly_slot";
  hasVisibleDiagnosisControls: boolean;
  isInteractable: boolean;
  diagnosisType: string | null;
  sectionLabel: string | null;
  icd10Code: string | null;
  onsetDate: string | null;
  description: string | null;
  severity: string | null;
  timingFlags: string[];
  rawText: string;
  rawHtmlHints: string[];
  extractionWarnings: string[];
  selectorEvidence: OasisDiagnosisFieldSelectorEvidence[];
}

export interface OasisDiagnosisPageSnapshot {
  schemaVersion: "1";
  capturedAt: string;
  page: {
    url: string;
    diagnosisContainerFound: boolean;
    diagnosisContainerSelector: string | null;
    diagnosisFormSelector: string | null;
    sectionMarkers: string[];
    insertDiagnosisVisible: boolean;
    rowCount: number;
    existingDiagnosisRowCount: number;
    emptyEditableSlotCount: number;
    emptyReadonlySlotCount: number;
    visibleEditableSlotCount: number;
    visibleDiagnosisControlCount: number;
    primaryDiagnosisRowCount: number;
    otherDiagnosisRowCount: number;
    noVisibleDiagnosisControls: boolean;
  };
  rows: OasisDiagnosisRowSnapshot[];
  selectorEvidence: string[];
  mappingNotes: string[];
  extractionWarnings: string[];
}

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

async function readLocatorTextSamples(locators: Locator[], maxItems = 8): Promise<string[]> {
  const samples: string[] = [];
  const limit = Math.min(locators.length, maxItems);
  for (let index = 0; index < limit; index += 1) {
    const value = normalizeWhitespace(await locators[index]!.textContent().catch(() => null));
    if (value) {
      samples.push(value.slice(0, 280));
    }
  }
  return samples;
}

type BrowserInspectorResult = {
  rows: OasisDiagnosisRowSnapshot[];
  extractionWarnings: string[];
  visibleDiagnosisControlCount: number;
};

function summarizeDiagnosisSnapshotRows(rows: OasisDiagnosisRowSnapshot[]): {
  existingDiagnosisRowCount: number;
  emptyEditableSlotCount: number;
  emptyReadonlySlotCount: number;
  visibleEditableSlotCount: number;
  primaryDiagnosisRowCount: number;
  otherDiagnosisRowCount: number;
} {
  return rows.reduce(
    (summary, row) => {
      if (row.rowKind === "existing_diagnosis") {
        summary.existingDiagnosisRowCount += 1;
      } else if (row.rowKind === "empty_editable_slot") {
        summary.emptyEditableSlotCount += 1;
      } else if (row.rowKind === "empty_readonly_slot") {
        summary.emptyReadonlySlotCount += 1;
      }

      if (row.isInteractable) {
        summary.visibleEditableSlotCount += 1;
      }
      if (row.rowRole === "primary") {
        summary.primaryDiagnosisRowCount += 1;
      } else if (row.rowRole === "other") {
        summary.otherDiagnosisRowCount += 1;
      }
      return summary;
    },
    {
      existingDiagnosisRowCount: 0,
      emptyEditableSlotCount: 0,
      emptyReadonlySlotCount: 0,
      visibleEditableSlotCount: 0,
      primaryDiagnosisRowCount: 0,
      otherDiagnosisRowCount: 0,
    },
  );
}

export function createEmptyOasisDiagnosisPageSnapshot(input: {
  page: Page;
  selectorEvidence?: string[];
  mappingNotes?: string[];
  extractionWarnings?: string[];
  sectionMarkers?: string[];
  diagnosisContainerFound?: boolean;
  diagnosisContainerSelector?: string | null;
  diagnosisFormSelector?: string | null;
  insertDiagnosisVisible?: boolean;
}): OasisDiagnosisPageSnapshot {
  return {
    schemaVersion: "1",
    capturedAt: new Date().toISOString(),
    page: {
      url: input.page.url(),
      diagnosisContainerFound: input.diagnosisContainerFound ?? false,
      diagnosisContainerSelector: input.diagnosisContainerSelector ?? null,
      diagnosisFormSelector: input.diagnosisFormSelector ?? null,
      sectionMarkers: input.sectionMarkers ?? [],
      insertDiagnosisVisible: input.insertDiagnosisVisible ?? false,
      rowCount: 0,
      existingDiagnosisRowCount: 0,
      emptyEditableSlotCount: 0,
      emptyReadonlySlotCount: 0,
      visibleEditableSlotCount: 0,
      visibleDiagnosisControlCount: 0,
      primaryDiagnosisRowCount: 0,
      otherDiagnosisRowCount: 0,
      noVisibleDiagnosisControls: true,
    },
    rows: [],
    selectorEvidence: input.selectorEvidence ?? [],
    mappingNotes: input.mappingNotes ?? [],
    extractionWarnings: input.extractionWarnings ?? [],
  };
}

export function isComparableOasisDiagnosisRow(row: OasisDiagnosisRowSnapshot): boolean {
  return row.rowKind === "existing_diagnosis";
}

async function inspectDiagnosisRowsInBrowser(rootLocator: Locator): Promise<BrowserInspectorResult> {
  return rootLocator.evaluate((rootElement) => {
    const normalize = (value: string | null | undefined): string =>
      (value ?? "").replace(/\s+/g, " ").trim();
    const readValue = (element: any): string => {
      if (!element) {
        return "";
      }
      if (typeof element.value === "string") {
        return normalize(element.value || element.getAttribute("value"));
      }
      return normalize(element.textContent);
    };
    const readLabelForInput = (input: any): string => {
      if (input.id) {
        const byFor = rootElement.querySelector(`label[for="${input.id}"]`);
        const byForText = normalize(byFor?.textContent);
        if (byForText) {
          return byForText;
        }
      }
      const closestLabel = input.closest("label");
      const closestLabelText = normalize(closestLabel?.textContent);
      if (closestLabelText) {
        return closestLabelText;
      }
      const parentLabel = normalize(input.parentElement?.textContent);
      return parentLabel;
    };
    const toArray = <T = any>(selector: string, parent: any = rootElement): T[] =>
      Array.from(parent.querySelectorAll(selector)) as T[];

    const rowSet = new Set<any>();
    const addRow = (element: any) => {
      if (!element) {
        return;
      }
      rowSet.add(element);
    };
    const resolveRow = (fieldElement: any): any => {
      if (!fieldElement) {
        return null;
      }
      return (
        fieldElement.closest("[formgroupname]") ||
        fieldElement.closest("tr") ||
        fieldElement.closest(".row") ||
        fieldElement.closest(".d-flex.flex-column") ||
        fieldElement.parentElement
      );
    };

    for (const row of toArray("[formarrayname='diagnosis'] [formgroupname]")) {
      addRow(row);
    }
    for (const row of toArray("app-m1021-diagnosis [formgroupname]")) {
      addRow(row);
    }
    for (const row of toArray("[formarrayname='diagnosis'] tr")) {
      addRow(row);
    }
    for (const icdField of toArray("[formcontrolname='icdcode']")) {
      addRow(resolveRow(icdField));
    }

    const fieldAnchorSelector = [
      "[formcontrolname='icdcode']",
      "[formcontrolname='onsetdate']",
      "[formcontrolname='onsetDate']",
      "[formcontrolname='description']",
      "[formcontrolname='diagnosisdescription']",
      "textarea",
      "input[type='radio']",
      "[aria-checked]",
    ].join(", ");
    const rowElements = Array.from(rowSet).filter((row) => {
      const rowText = normalize(row.textContent);
      if (rowText.length > 0) {
        return true;
      }
      return row.querySelector(fieldAnchorSelector) != null;
    });
    const extractionWarnings: string[] = [];
    const rows: OasisDiagnosisRowSnapshot[] = rowElements.map((rowElement, rowIndex) => {
      const rowText = normalize(rowElement.textContent);
      const upperRowText = rowText.toUpperCase();
      const sectionLabel = /PRIMARY DIAGNOSIS/.test(upperRowText)
        ? "PRIMARY DIAGNOSIS"
        : /OTHER DIAGNOSIS/.test(upperRowText)
          ? "OTHER DIAGNOSIS"
          : null;

      const readField = (selectors: readonly string[]): {
        value: string;
        selectorUsed: string | null;
        found: boolean;
        disabled: boolean | null;
        readOnly: boolean | null;
        source: "value" | "text" | "none";
      } => {
        for (const selector of selectors) {
          const field = rowElement.querySelector(selector);
          if (!field) {
            continue;
          }
          const value = readValue(field);
          const disabled = typeof field.disabled === "boolean"
            ? field.disabled
            : field.hasAttribute("disabled");
          const readOnly = typeof field.readOnly === "boolean"
            ? field.readOnly
            : field.hasAttribute("readonly");
          return {
            value,
            selectorUsed: selector,
            found: true,
            disabled,
            readOnly,
            source: (typeof field.value === "string") ? "value" : "text",
          };
        }
        return {
          value: "",
          selectorUsed: null,
          found: false,
          disabled: null,
          readOnly: null,
          source: "none",
        };
      };

      const icd = readField([
        "[formcontrolname='icdcode']",
        "input[formcontrolname='icdcode']",
        "input[placeholder*='ICD' i]",
      ]);
      const onset = readField([
        "[formcontrolname='onsetdate']",
        "[formcontrolname='onsetDate']",
        "input[type='date']",
        "input[placeholder*='Onset' i]",
      ]);
      const description = readField([
        "[formcontrolname='description']",
        "[formcontrolname='diagnosisdescription']",
        "textarea[formcontrolname]",
        "textarea",
        "input[placeholder*='Description' i]",
      ]);

      const severityControls = toArray(
        [
          "input[type='radio'][name*='severity' i]",
          "input[type='radio'][formcontrolname*='severity' i]",
          "input[type='radio'][id*='severity' i]",
        ].join(", "),
        rowElement,
      );
      const checkedSeverityRadio = rowElement.querySelector(
        "input[type='radio'][name*='severity' i]:checked, input[type='radio'][formcontrolname*='severity' i]:checked, input[type='radio'][id*='severity' i]:checked",
      ) as any;
      const severityLabel = checkedSeverityRadio ? readLabelForInput(checkedSeverityRadio) : "";
      const severity = severityLabel || normalize(
        (checkedSeverityRadio?.value ?? "") ||
          (rowElement.querySelector("[aria-checked='true'][class*='severity' i]")?.textContent ?? ""),
      );

      const timingFlags = new Set<string>();
      const timingControls = toArray(
        [
          "input[type='radio'][name*='onset' i]",
          "input[type='radio'][name*='exacer' i]",
          "input[type='radio'][formcontrolname*='timing' i]",
          "input[type='radio'][id*='onset' i]",
          "input[type='radio'][id*='exacer' i]",
        ].join(", "),
        rowElement,
      );
      const checkedRadios = toArray("input[type='radio']:checked", rowElement);
      for (const radio of checkedRadios) {
        const label = readLabelForInput(radio);
        if (/onset|exacerbate/i.test(label)) {
          timingFlags.add(label);
        }
      }
      for (const toggle of toArray(
        "[aria-checked='true'], .active, [class*='selected']",
        rowElement,
      )) {
        const label = normalize(toggle.textContent);
        if (label && /onset|exacerbate/i.test(label)) {
          timingFlags.add(label);
        }
      }

      const selectorEvidence: OasisDiagnosisFieldSelectorEvidence[] = [
        {
          field: "icd10Code",
          selectorUsed: icd.selectorUsed,
          found: icd.found,
          valueSource: icd.source,
          disabled: icd.disabled,
          readOnly: icd.readOnly,
        },
        {
          field: "onsetDate",
          selectorUsed: onset.selectorUsed,
          found: onset.found,
          valueSource: onset.source,
          disabled: onset.disabled,
          readOnly: onset.readOnly,
        },
        {
          field: "description",
          selectorUsed: description.selectorUsed,
          found: description.found,
          valueSource: description.source,
          disabled: description.disabled,
          readOnly: description.readOnly,
        },
        {
          field: "severity",
          selectorUsed: severityControls.length > 0
            ? "input[type='radio'][name*=severity], input[type='radio'][formcontrolname*=severity], input[type='radio'][id*=severity]"
            : null,
          found: severityControls.length > 0,
          valueSource: checkedSeverityRadio ? "checked_label" : "none",
          disabled: severityControls.length > 0
            ? severityControls.every((control) => control.disabled || control.hasAttribute("disabled"))
            : null,
          readOnly: null,
        },
        {
          field: "timingFlags",
          selectorUsed: timingControls.length > 0
            ? "input[type='radio'][name*=onset], input[type='radio'][name*=exacer], input[type='radio'][formcontrolname*=timing]"
            : null,
          found: timingControls.length > 0,
          valueSource: timingFlags.size > 0 ? "derived" : "none",
          disabled: timingControls.length > 0
            ? timingControls.every((control) => control.disabled || control.hasAttribute("disabled"))
            : null,
          readOnly: null,
        },
      ];

      const warnings: string[] = [];
      if (!icd.value && !description.value) {
        warnings.push("Row has no visible ICD code or description.");
      }

      const hasVisibleDiagnosisControls =
        icd.found ||
        onset.found ||
        description.found ||
        severityControls.length > 0 ||
        timingControls.length > 0;
      const hasEditableDiagnosisControls =
        (icd.found && icd.disabled === false && (icd.readOnly === false || icd.readOnly === null)) ||
        (onset.found && onset.disabled === false && (onset.readOnly === false || onset.readOnly === null)) ||
        (description.found && description.disabled === false && (description.readOnly === false || description.readOnly === null)) ||
        severityControls.some((control) => !(control.disabled || control.hasAttribute("disabled"))) ||
        timingControls.some((control) => !(control.disabled || control.hasAttribute("disabled")));
      const hasMeaningfulValue =
        Boolean(icd.value) ||
        Boolean(onset.value) ||
        Boolean(description.value) ||
        Boolean(severity) ||
        timingFlags.size > 0;
      const rowKind: OasisDiagnosisRowSnapshot["rowKind"] = hasMeaningfulValue
        ? "existing_diagnosis"
        : hasEditableDiagnosisControls
          ? "empty_editable_slot"
          : "empty_readonly_slot";

      const idHint = normalize(rowElement.getAttribute("id"));
      const classHint = normalize(rowElement.getAttribute("class"));
      const formGroupHint = normalize(rowElement.getAttribute("formgroupname"));
      const controlNames = toArray("[formcontrolname]", rowElement)
        .map((field) => normalize(field.getAttribute("formcontrolname")))
        .filter(Boolean);

      return {
        rowIndex,
        rowRole: "unknown",
        rowKind,
        hasVisibleDiagnosisControls,
        isInteractable: hasEditableDiagnosisControls,
        diagnosisType: sectionLabel,
        sectionLabel,
        icd10Code: icd.value || null,
        onsetDate: onset.value || null,
        description: description.value || null,
        severity: severity || null,
        timingFlags: Array.from(timingFlags),
        rawText: rowText.slice(0, 1200),
        rawHtmlHints: [
          `tag=${rowElement.tagName.toLowerCase()}`,
          idHint ? `id=${idHint}` : "",
          classHint ? `class=${classHint}` : "",
          formGroupHint ? `formgroupname=${formGroupHint}` : "",
          controlNames.length > 0 ? `formcontrolnames=${controlNames.join(",")}` : "",
        ].filter(Boolean),
        extractionWarnings: warnings,
        selectorEvidence,
      };
    });

    const filteredRows: OasisDiagnosisRowSnapshot[] = [];
    let filteredNoiseCount = 0;

    rows.forEach((row, index) => {
      const rejectionReason = getOasisDiagnosisRowRejectionReason({
        sectionLabel: row.sectionLabel,
        icd10Code: row.icd10Code,
        onsetDate: row.onsetDate,
        description: row.description,
        severity: row.severity,
        timingFlags: row.timingFlags,
        rawText: row.rawText,
        selectorEvidence: row.selectorEvidence as OasisDiagnosisRowFieldSignal[],
      });
      if (rejectionReason) {
        filteredNoiseCount += 1;
        return;
      }

      const nextRowIndex = index - filteredNoiseCount;
      const inferredRole = row.sectionLabel === "PRIMARY DIAGNOSIS"
        ? "primary"
        : row.sectionLabel === "OTHER DIAGNOSIS"
          ? "other"
          : nextRowIndex === 0
            ? "primary"
            : "other";
      filteredRows.push({
        ...row,
        rowIndex: nextRowIndex,
        rowRole: inferredRole,
      });
    });

    if (filteredNoiseCount > 0) {
      extractionWarnings.push(
        `Filtered ${filteredNoiseCount} diagnosis snapshot row(s) as header/UI noise before comparison and execution planning.`,
      );
    }

    if (filteredRows.length === 0) {
      extractionWarnings.push("No diagnosis rows were resolved from Active Diagnoses DOM.");
    }

    const visibleDiagnosisControlCount = filteredRows.filter((row) => row.hasVisibleDiagnosisControls).length;
    if (visibleDiagnosisControlCount === 0) {
      extractionWarnings.push("No visible diagnosis controls were detected on the Active Diagnoses page.");
    }

    return {
      rows: filteredRows,
      extractionWarnings,
      visibleDiagnosisControlCount,
    };
  });
}

export async function inspectOasisDiagnosisPage(input: {
  page: Page;
  logger?: Logger;
  debugConfig?: PortalDebugConfig;
}): Promise<OasisDiagnosisPageSnapshot> {
  await waitForPortalPageSettled(input.page, input.debugConfig);

  const selectorEvidence: string[] = [];
  const extractionWarnings: string[] = [];
  const mappingNotes: string[] = [
    "Prefer formcontrolname selectors for stable row/field mapping in Angular forms.",
    "Fallback to row text heuristics only when direct control selectors are absent.",
    "Snapshot is read-only and intended for QA comparison/autofill planning.",
    "Rows are classified as existing diagnoses vs empty editable slots vs empty readonly slots before action planning.",
  ];

  const rootResolution = await resolveFirstVisibleLocator({
    page: input.page,
    candidates: oasisDiagnosisSelectors.rootContainers,
    step: "oasis_diagnosis_root",
    logger: input.logger,
    debugConfig: input.debugConfig,
    settle: () => waitForPortalPageSettled(input.page, input.debugConfig),
  });
  selectorEvidence.push(...rootResolution.attempts.map(selectorAttemptToEvidence));

  const sectionMarkersResolution = await resolveVisibleLocatorList({
    page: input.page,
    candidates: oasisDiagnosisSelectors.sectionMarkers,
    step: "oasis_diagnosis_section_markers",
    logger: input.logger,
    debugConfig: input.debugConfig,
    maxItems: 12,
  });
  selectorEvidence.push(...sectionMarkersResolution.attempts.map(selectorAttemptToEvidence));
  const sectionMarkers = await readLocatorTextSamples(
    sectionMarkersResolution.items.map((item) => item.locator),
    10,
  );

  const insertDiagnosisResolution = await resolveVisibleLocatorList({
    page: input.page,
    candidates: oasisDiagnosisSelectors.insertDiagnosisButton,
    step: "oasis_insert_diagnosis_button",
    logger: input.logger,
    debugConfig: input.debugConfig,
    maxItems: 6,
  });
  selectorEvidence.push(...insertDiagnosisResolution.attempts.map(selectorAttemptToEvidence));
  const primaryRowResolution = await resolveVisibleLocatorList({
    page: input.page,
    candidates: oasisDiagnosisSelectors.primaryDiagnosisRows,
    step: "oasis_primary_diagnosis_rows",
    logger: input.logger,
    debugConfig: input.debugConfig,
    maxItems: 8,
  });
  selectorEvidence.push(...primaryRowResolution.attempts.map(selectorAttemptToEvidence));

  const otherRowResolution = await resolveVisibleLocatorList({
    page: input.page,
    candidates: oasisDiagnosisSelectors.otherDiagnosisRows,
    step: "oasis_other_diagnosis_rows",
    logger: input.logger,
    debugConfig: input.debugConfig,
    maxItems: 20,
  });
  selectorEvidence.push(...otherRowResolution.attempts.map(selectorAttemptToEvidence));

  const rootLocator = rootResolution.locator;
  if (!rootLocator || !rootResolution.matchedCandidate) {
    extractionWarnings.push("Diagnosis root container could not be resolved.");
    selectorEvidence.push(`primaryDiagnosisRowVisible:${primaryRowResolution.items.length > 0}`);
    selectorEvidence.push(`otherDiagnosisRowCount:${otherRowResolution.items.length}`);
    selectorEvidence.push(`emptyEditableSlotCount:0`);
    selectorEvidence.push(`insertDiagnosisButtonVisible:${insertDiagnosisResolution.items.length > 0}`);
    return createEmptyOasisDiagnosisPageSnapshot({
      page: input.page,
      selectorEvidence,
      mappingNotes,
      extractionWarnings,
      sectionMarkers,
      diagnosisContainerFound: false,
      diagnosisContainerSelector: null,
      diagnosisFormSelector: null,
      insertDiagnosisVisible: insertDiagnosisResolution.items.length > 0,
    });
  }

  const rowResolution = await resolveVisibleLocatorList({
    page: rootLocator,
    candidates: oasisDiagnosisSelectors.diagnosisRows,
    step: "oasis_diagnosis_rows",
    logger: input.logger,
    debugConfig: input.debugConfig,
    maxItems: 80,
  });
  selectorEvidence.push(...rowResolution.attempts.map(selectorAttemptToEvidence));
  const editableSlotResolution = await resolveVisibleLocatorList({
    page: rootLocator,
    candidates: oasisDiagnosisSelectors.editableSlotSignals,
    step: "oasis_editable_slot_signals",
    logger: input.logger,
    debugConfig: input.debugConfig,
    maxItems: 40,
  });
  selectorEvidence.push(...editableSlotResolution.attempts.map(selectorAttemptToEvidence));

  let browserInspection: BrowserInspectorResult;
  try {
    browserInspection = await inspectDiagnosisRowsInBrowser(rootLocator);
  } catch (error) {
    extractionWarnings.push(
      `Diagnosis row browser inspection failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    selectorEvidence.push(`primaryDiagnosisRowVisible:${primaryRowResolution.items.length > 0}`);
    selectorEvidence.push(`otherDiagnosisRowCount:${otherRowResolution.items.length}`);
    selectorEvidence.push(`emptyEditableSlotCount:0`);
    selectorEvidence.push(`insertDiagnosisButtonVisible:${insertDiagnosisResolution.items.length > 0}`);
    return createEmptyOasisDiagnosisPageSnapshot({
      page: input.page,
      selectorEvidence,
      mappingNotes,
      extractionWarnings,
      sectionMarkers,
      diagnosisContainerFound: true,
      diagnosisContainerSelector: rootResolution.matchedCandidate.description,
      diagnosisFormSelector:
        rowResolution.items[0]?.candidate.description ??
        rootResolution.matchedCandidate.description,
      insertDiagnosisVisible: insertDiagnosisResolution.items.length > 0,
    });
  }
  extractionWarnings.push(...browserInspection.extractionWarnings);

  const summary = summarizeDiagnosisSnapshotRows(browserInspection.rows);
  const rowCount = browserInspection.rows.length;
  if (rowCount === 0 && rowResolution.items.length > 0) {
    extractionWarnings.push(
      "Diagnosis row selectors matched, but no field-level row payload could be derived.",
    );
  }
  selectorEvidence.push(`primaryDiagnosisRowVisible:${summary.primaryDiagnosisRowCount > 0 || primaryRowResolution.items.length > 0}`);
  selectorEvidence.push(`otherDiagnosisRowCount:${Math.max(summary.otherDiagnosisRowCount, otherRowResolution.items.length)}`);
  selectorEvidence.push(`emptyEditableSlotCount:${summary.emptyEditableSlotCount}`);
  selectorEvidence.push(`insertDiagnosisButtonVisible:${insertDiagnosisResolution.items.length > 0}`);
  selectorEvidence.push(`visibleDiagnosisControlCount:${browserInspection.visibleDiagnosisControlCount}`);
  selectorEvidence.push(`visibleEditableSlotCount:${summary.visibleEditableSlotCount}`);

  return {
    schemaVersion: "1",
    capturedAt: new Date().toISOString(),
    page: {
      url: input.page.url(),
      diagnosisContainerFound: true,
      diagnosisContainerSelector: rootResolution.matchedCandidate.description,
      diagnosisFormSelector:
        rowResolution.items[0]?.candidate.description ??
        rootResolution.matchedCandidate.description,
      sectionMarkers,
      insertDiagnosisVisible: insertDiagnosisResolution.items.length > 0,
      rowCount,
      existingDiagnosisRowCount: summary.existingDiagnosisRowCount,
      emptyEditableSlotCount: summary.emptyEditableSlotCount,
      emptyReadonlySlotCount: summary.emptyReadonlySlotCount,
      visibleEditableSlotCount: summary.visibleEditableSlotCount,
      visibleDiagnosisControlCount: browserInspection.visibleDiagnosisControlCount,
      primaryDiagnosisRowCount: summary.primaryDiagnosisRowCount,
      otherDiagnosisRowCount: summary.otherDiagnosisRowCount,
      noVisibleDiagnosisControls: browserInspection.visibleDiagnosisControlCount === 0,
    },
    rows: browserInspection.rows,
    selectorEvidence,
    mappingNotes,
    extractionWarnings,
  };
}
