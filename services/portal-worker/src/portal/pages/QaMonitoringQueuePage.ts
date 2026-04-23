import { createHash } from "node:crypto";
import {
  type QaQueueActionLabelSource,
  type QaQueueAvailableAction,
  type QaQueueDocumentType,
  type QaQueueItemSelectedRow,
  type QaQueueTargetType,
  type QaQueueSummary,
} from "@medical-ai-qa/shared-types";
import { type Locator, type Page } from "@playwright/test";
import { type QueueRowSnapshot } from "../../types/queueQaPipeline";
import { QA_QUEUE_SELECTORS } from "../selectors/qa-queue.selectors";
import { sanitizeStructuralLabel } from "../discovery/control-classification";
import { normalizeText, waitForPageSettled } from "../utils/page-helpers";

export interface QaQueueRowActionCandidate {
  tagName: string | null;
  extractedLabel: string | null;
  labelSource: QaQueueActionLabelSource;
  hrefPresent: boolean;
  visible: boolean;
  enabled: boolean;
}

export interface QaQueueRowAction {
  label: string;
  labelSource: QaQueueActionLabelSource;
  targetType: QaQueueTargetType;
  locator: Locator;
  metadata: QaQueueRowActionCandidate;
}

export interface ResolvedQaQueueRow {
  row: QaQueueItemSelectedRow;
  snapshot: QueueRowSnapshot;
  documentTypeReason: string;
  locator: Locator;
  patientAnchor: Locator | null;
  documentAnchor: Locator | null;
  actions: QaQueueRowAction[];
}

interface QueueRowCellSnapshot {
  index: number;
  text: string;
  header: string | null;
}

interface QaQueuePaginationTarget {
  pageNumber: number;
  locator: Locator;
  current: boolean;
  disabled: boolean;
}

interface QaQueueNextPageTarget {
  locator: Locator;
  disabled: boolean;
}

export class QaMonitoringQueuePage {
  constructor(private readonly page: Page) {}

  async isLoaded(): Promise<boolean> {
    const url = this.page.url();
    if (
      QA_QUEUE_SELECTORS.queueUrlPattern.test(url) &&
      QA_QUEUE_SELECTORS.queueQueryPattern.test(url)
    ) {
      return true;
    }

    for (const selector of QA_QUEUE_SELECTORS.queueMarkers) {
      const locator = this.page.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) {
        return true;
      }
    }

    return false;
  }

  async summarizeQueue(): Promise<QaQueueSummary> {
    return {
      url: this.page.url(),
      rowCount: await this.getRowCount(),
    };
  }

  async getRowCount(): Promise<number> {
    const rows = await this.getVisibleRows();
    return rows.length;
  }

  async waitUntilReady(timeoutMs = 10_000): Promise<boolean> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (await this.isLoaded()) {
        return true;
      }

      await this.page.waitForTimeout(250);
    }

    return false;
  }

  async getVisibleRows(): Promise<ResolvedQaQueueRow[]> {
    const columnHeaders = await this.getVisibleColumnHeaders();
    const currentPageNumber = await this.getCurrentPageNumber();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      for (const selector of QA_QUEUE_SELECTORS.rowSelectors) {
        const rows = this.page.locator(selector);
        const count = Math.min(await rows.count(), 25);
        const resolvedRows: ResolvedQaQueueRow[] = [];

        for (let index = 0; index < count; index += 1) {
          const rowLocator = rows.nth(index);
          if (!(await rowLocator.isVisible().catch(() => false))) {
            continue;
          }

          const resolved = await this.buildRow(index, rowLocator, columnHeaders, currentPageNumber);
          if (resolved) {
            resolvedRows.push(resolved);
          }
        }

        if (resolvedRows.length > 0) {
          return resolvedRows;
        }
      }

      if (attempt === 0) {
        await this.page.waitForTimeout(250);
      }
    }

    return [];
  }

  async getFirstVisibleRow(): Promise<ResolvedQaQueueRow | null> {
    const rows = await this.getVisibleRows();
    return rows[0] ?? null;
  }

  async getCurrentPageNumber(): Promise<number> {
    const targets = await this.getPaginationTargets();
    return targets.find((target) => target.current)?.pageNumber ?? 1;
  }

  async hasNextPage(): Promise<boolean> {
    const nextTarget = await this.getNextPageTarget();
    return Boolean(nextTarget && !nextTarget.disabled);
  }

  async goToNextPage(): Promise<boolean> {
    const nextTarget = await this.getNextPageTarget();
    if (!nextTarget || nextTarget.disabled) {
      return false;
    }

    const beforeSignature = await this.buildQueueSurfaceSignature();
    await nextTarget.locator.click();
    await this.waitForQueueSurfaceChange(beforeSignature);
    return true;
  }

  async goToPage(pageNumber: number): Promise<boolean> {
    const currentPageNumber = await this.getCurrentPageNumber();
    if (currentPageNumber === pageNumber) {
      return true;
    }

    const targets = await this.getPaginationTargets();
    const target = targets.find((entry) => entry.pageNumber === pageNumber);
    if (!target || target.disabled) {
      return false;
    }

    const beforeSignature = await this.buildQueueSurfaceSignature();
    await target.locator.click();
    await this.waitForQueueSurfaceChange(beforeSignature);
    return true;
  }

  async findVisibleRowByFingerprint(rowFingerprint: string): Promise<ResolvedQaQueueRow | null> {
    const rows = await this.getVisibleRows();

    return rows.find((row) => row.snapshot.rowFingerprint === rowFingerprint) ?? null;
  }

  selectPreferredRow(rows: ResolvedQaQueueRow[]): ResolvedQaQueueRow | null {
    if (rows.length === 0) {
      return null;
    }

    return [...rows].sort((left, right) => {
      const leftRank = getDocumentTypeRank(left.row.documentType);
      const rightRank = getDocumentTypeRank(right.row.documentType);

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return left.row.rowIndex - right.row.rowIndex;
    })[0] ?? null;
  }

  selectPreferredTarget(row: ResolvedQaQueueRow): QaQueueRowAction | null {
    const noteOpenAction = row.actions.find((action) => action.targetType === "NOTE_OPEN_ACTION");
    if (noteOpenAction) {
      return noteOpenAction;
    }

    const documentLink = row.actions.find((action) => action.targetType === "DOCUMENT_LINK");
    if (documentLink) {
      return documentLink;
    }

    const safeOtherAction = row.actions.find(
      (action) =>
        action.targetType === "OTHER_ACTION" &&
        isSafeViewOnlyOtherAction(action.label),
    );
    if (safeOtherAction) {
      return safeOtherAction;
    }

    return null;
  }

  private async buildRow(
    rowIndex: number,
    rowLocator: Locator,
    columnHeaders: string[],
    currentPageNumber: number,
  ): Promise<ResolvedQaQueueRow | null> {
    const patientAnchor = await this.findFirstVisible(rowLocator, QA_QUEUE_SELECTORS.patientLinkSelectors);
    const documentAnchor = await this.findFirstVisible(rowLocator, QA_QUEUE_SELECTORS.documentDescSelectors);
    const actions = await this.collectRowActions(rowLocator, patientAnchor, documentAnchor);
    const documentDescText = await this.readDocumentDescText(rowLocator, documentAnchor, actions);
    const cells = await this.readRowCells(rowLocator, columnHeaders);
    const documentTypeClassification = classifyQueueDocumentType(documentDescText, actions.map((action) => action.label));
    if (cells.length === 0 && actions.length === 0 && !documentDescText) {
      return null;
    }

    const snapshot = await this.buildQueueRowSnapshot({
      pageNumber: currentPageNumber,
      rowIndex,
      cells,
      patientAnchor,
      actions,
      documentDescText,
      documentType: documentTypeClassification.documentType,
    });

    return {
      row: {
        rowIndex,
        documentDescText: snapshot.documentDesc,
        documentType: snapshot.documentType,
        availableActionLabels: snapshot.availableActions,
      },
      snapshot,
      documentTypeReason: documentTypeClassification.reason,
      locator: rowLocator,
      patientAnchor,
      documentAnchor,
      actions,
    };
  }

  private async collectRowActions(
    rowLocator: Locator,
    patientAnchor: Locator | null,
    documentAnchor: Locator | null,
  ): Promise<QaQueueRowAction[]> {
    const actions: QaQueueRowAction[] = [];
    const seen = new Set<string>();
    const patientHref = await patientAnchor?.getAttribute("href").catch(() => null);
    const documentHref = await documentAnchor?.getAttribute("href").catch(() => null);
    const scopes = [
      ...await this.getActionScopes(rowLocator),
      rowLocator,
    ];
    const actionSelectors = [
      ...QA_QUEUE_SELECTORS.noteOpenActionSelectors,
      ...QA_QUEUE_SELECTORS.actionSelectors,
    ];

    for (const scope of scopes) {
      for (const selector of actionSelectors) {
        const candidates = scope.locator(selector);
        const count = Math.min(await candidates.count(), 20);

        for (let index = 0; index < count; index += 1) {
          const locator = candidates.nth(index);
          const metadata = await this.describeActionCandidate(locator);
          if (!metadata.visible) {
            continue;
          }

          const href = await locator.getAttribute("href").catch(() => null);
          const label = metadata.extractedLabel ?? inferLabelFromHref(href);
          if (!label) {
            continue;
          }

          const targetType = classifyRowAction({
            label,
            href,
            patientHref,
            documentHref,
          });
          const signature = await this.buildActionSignature(locator, label, targetType, href);
          if (seen.has(signature)) {
            continue;
          }

          seen.add(signature);
          actions.push({
            label,
            labelSource: metadata.labelSource,
            targetType,
            locator,
            metadata: {
              ...metadata,
              extractedLabel: label,
            },
          });
        }
      }
    }

    return actions;
  }

  private async getActionScopes(rowLocator: Locator): Promise<Locator[]> {
    const scopes: Locator[] = [];

    for (const selector of QA_QUEUE_SELECTORS.actionCellSelectors) {
      const scope = rowLocator.locator(selector).first();
      if (await scope.isVisible().catch(() => false)) {
        scopes.push(scope);
      }
    }

    return scopes;
  }

  async extractInteractiveLabel(locator: Locator): Promise<{
    label: string | null;
    labelSource: QaQueueActionLabelSource;
  }> {
    const textLabel =
      normalizeText(await locator.innerText().catch(() => null)) ??
      normalizeText(await locator.textContent().catch(() => null));
    if (textLabel) {
      return {
        label: textLabel,
        labelSource: "text",
      };
    }

    const ngbTooltip = normalizeText(await locator.getAttribute("ngbtooltip").catch(() => null));
    if (ngbTooltip) {
      return {
        label: ngbTooltip,
        labelSource: "ngbtooltip",
      };
    }

    const title = normalizeText(await locator.getAttribute("title").catch(() => null));
    if (title) {
      return {
        label: title,
        labelSource: "title",
      };
    }

    const ariaLabel = normalizeText(await locator.getAttribute("aria-label").catch(() => null));
    if (ariaLabel) {
      return {
        label: ariaLabel,
        labelSource: "aria-label",
      };
    }

    for (const attributeName of QA_QUEUE_SELECTORS.actionLabelAttributeNames) {
      if (attributeName === "ngbtooltip" || attributeName === "title" || attributeName === "aria-label") {
        continue;
      }

      const value = normalizeText(await locator.getAttribute(attributeName).catch(() => null));
      if (value) {
        return {
          label: value,
          labelSource: "data-attribute",
        };
      }
    }

    return {
      label: null,
      labelSource: "unknown",
    };
  }

  private async describeActionCandidate(locator: Locator): Promise<QaQueueRowActionCandidate> {
    const [tagName, href, visible, enabled, extracted] = await Promise.all([
      locator.evaluate((node) => node.tagName.toLowerCase()).catch(() => null),
      locator.getAttribute("href").catch(() => null),
      locator.isVisible().catch(() => false),
      locator.isEnabled().catch(() => true),
      this.extractInteractiveLabel(locator),
    ]);

    return {
      tagName,
      extractedLabel: extracted.label,
      labelSource: extracted.labelSource,
      hrefPresent: Boolean(href),
      visible,
      enabled,
    };
  }

  private async readDocumentDescText(
    rowLocator: Locator,
    documentAnchor: Locator | null,
    actions: QaQueueRowAction[],
  ): Promise<string | null> {
    const anchorText = sanitizeQueueDocumentLabel(await documentAnchor?.innerText().catch(() => null));
    if (anchorText) {
      return anchorText;
    }

    const actionLabels = new Set(actions.map((action) => action.label));
    const textLines = (await rowLocator.innerText().catch(() => ""))
      .split(/\r?\n/)
      .map((line) => sanitizeStructuralLabel(line))
      .filter((line): line is string => Boolean(line));

    return (
      textLines.find(
        (line) =>
          !actionLabels.has(line) &&
          /note|document|order|plan of care|oasis|qa/i.test(line),
      ) ?? null
    );
  }

  private async getVisibleColumnHeaders(): Promise<string[]> {
    const headers: string[] = [];

    for (const selector of QA_QUEUE_SELECTORS.headerCellSelectors) {
      const locator = this.page.locator(selector);
      const count = Math.min(await locator.count(), 12);

      for (let index = 0; index < count; index += 1) {
        const item = locator.nth(index);
        if (!(await item.isVisible().catch(() => false))) {
          continue;
        }

        const text = sanitizeStructuralLabel(await item.innerText().catch(() => null));
        headers.push(text ?? `column_${index + 1}`);
      }

      if (headers.length > 0) {
        return headers;
      }
    }

    return headers;
  }

  private async readRowCells(
    rowLocator: Locator,
    columnHeaders: string[],
  ): Promise<QueueRowCellSnapshot[]> {
    const cells = rowLocator.locator(QA_QUEUE_SELECTORS.cellSelectors.join(", "));
    const count = Math.min(await cells.count(), 12);
    const snapshots: QueueRowCellSnapshot[] = [];

    for (let index = 0; index < count; index += 1) {
      const cell = cells.nth(index);
      if (!(await cell.isVisible().catch(() => false))) {
        continue;
      }

      const text = normalizeText(await cell.innerText().catch(() => null));
      if (!text) {
        continue;
      }

      snapshots.push({
        index,
        text,
        header: columnHeaders[index] ?? null,
      });
    }

    return snapshots;
  }

  private async buildQueueRowSnapshot(input: {
    pageNumber: number;
    rowIndex: number;
    cells: QueueRowCellSnapshot[];
    patientAnchor: Locator | null;
    actions: QaQueueRowAction[];
    documentDescText: string | null;
    documentType: QaQueueDocumentType;
  }): Promise<QueueRowSnapshot> {
    const patientDisplayName = normalizeText(await input.patientAnchor?.innerText().catch(() => null));
    const actionAvailability = input.actions.map<QaQueueAvailableAction>((action) => ({
      label: action.label,
      labelSource: action.labelSource,
      classification: action.targetType,
    }));
    const type = this.deriveTypeFromCells(input.cells, input.documentDescText);
    const date = this.deriveDateFromCells(input.cells);
    const physician = this.derivePhysicianFromCells(input.cells, input.documentDescText, type, date);
    const fingerprint = buildQueueRowFingerprint({
      rowIndex: input.rowIndex,
      documentDesc: input.documentDescText,
      type,
      date,
      physician,
      documentType: input.documentType,
    });

    return {
      pageNumber: input.pageNumber,
      rowIndex: input.rowIndex,
      rowFingerprint: fingerprint,
      patientDisplayNameMasked: maskDisplayName(patientDisplayName),
      documentDesc: input.documentDescText,
      type,
      date,
      physician,
      documentType: input.documentType,
      availableActions: actionAvailability,
      queueUrl: this.page.url(),
    };
  }

  private async getPaginationTargets(): Promise<QaQueuePaginationTarget[]> {
    const targets: QaQueuePaginationTarget[] = [];
    const seen = new Set<number>();

    for (const scope of await this.getPaginationScopes()) {
      for (const selector of QA_QUEUE_SELECTORS.pageNumberSelectors) {
        const items = scope.locator(selector);
        const count = Math.min(await items.count(), 20);

        for (let index = 0; index < count; index += 1) {
          const locator = items.nth(index);
          if (!(await locator.isVisible().catch(() => false))) {
            continue;
          }

          const pageNumber = await this.extractPaginationPageNumber(locator);
          if (!pageNumber || seen.has(pageNumber)) {
            continue;
          }

          seen.add(pageNumber);
          targets.push({
            pageNumber,
            locator,
            current: await isCurrentPaginationTarget(locator),
            disabled: await isDisabledPaginationTarget(locator),
          });
        }
      }
    }

    return targets.sort((left, right) => left.pageNumber - right.pageNumber);
  }

  private async getNextPageTarget(): Promise<QaQueueNextPageTarget | null> {
    for (const scope of await this.getPaginationScopes()) {
      for (const selector of QA_QUEUE_SELECTORS.nextPageSelectors) {
        const locator = scope.locator(selector).first();
        if (!(await locator.isVisible().catch(() => false))) {
          continue;
        }

        return {
          locator,
          disabled: await isDisabledPaginationTarget(locator),
        };
      }
    }

    return null;
  }

  private async getPaginationScopes(): Promise<Array<{ locator(selector: string): Locator }>> {
    const scopes: Array<{ locator(selector: string): Locator }> = [];

    for (const selector of QA_QUEUE_SELECTORS.paginationSelectors) {
      const locator = this.page.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) {
        scopes.push(locator);
      }
    }

    if (scopes.length === 0) {
      scopes.push(this.page);
    }

    return scopes;
  }

  private async extractPaginationPageNumber(locator: Locator): Promise<number | null> {
    const [text, ariaLabel, title] = await Promise.all([
      locator.innerText().catch(() => null),
      locator.getAttribute("aria-label").catch(() => null),
      locator.getAttribute("title").catch(() => null),
    ]);

    return parsePaginationPageNumber(text) ??
      parsePaginationPageNumber(ariaLabel) ??
      parsePaginationPageNumber(title);
  }

  private async buildQueueSurfaceSignature(): Promise<string> {
    const currentPageNumber = await this.getCurrentPageNumber();
    const rowTexts: string[] = [];
    const rows = this.page.locator(QA_QUEUE_SELECTORS.rowSelectors.join(", "));
    const count = Math.min(await rows.count(), 3);

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      if (!(await row.isVisible().catch(() => false))) {
        continue;
      }

      rowTexts.push(normalizeText(await row.innerText().catch(() => null)) ?? "");
    }

    return [this.page.url(), currentPageNumber, ...rowTexts].join("|");
  }

  private async waitForQueueSurfaceChange(beforeSignature: string): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await waitForPageSettled(this.page, 150);
      const afterSignature = await this.buildQueueSurfaceSignature();
      if (afterSignature !== beforeSignature) {
        return;
      }
    }
  }

  private deriveTypeFromCells(
    cells: QueueRowCellSnapshot[],
    documentDescText: string | null,
  ): string | null {
    const headerMatch = cells.find((cell) => isHeaderMatch(cell.header, ["type", "document type", "note type"]));
    if (headerMatch) {
      return sanitizeShortCellValue(headerMatch.text);
    }

    const fallback = cells.find((cell) => {
      const value = cell.text.toLowerCase();
      return value !== documentDescText?.toLowerCase() &&
        /\b(therapy|nursing|visit note|pt|ot|st|rn|lvn|sn)\b/i.test(cell.text);
    });

    return sanitizeShortCellValue(fallback?.text ?? null);
  }

  private deriveDateFromCells(cells: QueueRowCellSnapshot[]): string | null {
    const headerMatch = cells.find((cell) => isHeaderMatch(cell.header, ["date", "visit date", "created"]));
    if (headerMatch && DATE_VALUE_PATTERN.test(headerMatch.text)) {
      return headerMatch.text;
    }

    const fallback = cells.find((cell) => DATE_VALUE_PATTERN.test(cell.text));
    return fallback?.text ?? null;
  }

  private derivePhysicianFromCells(
    cells: QueueRowCellSnapshot[],
    documentDescText: string | null,
    type: string | null,
    date: string | null,
  ): string | null {
    const headerMatch = cells.find((cell) =>
      isHeaderMatch(cell.header, ["physician", "provider", "clinician", "doctor"]),
    );
    if (headerMatch) {
      return sanitizeProviderLabel(headerMatch.text);
    }

    const fallback = cells.find((cell) => {
      if (cell.text === documentDescText || cell.text === type || cell.text === date) {
        return false;
      }

      return PROVIDER_VALUE_PATTERN.test(cell.text);
    });

    return sanitizeProviderLabel(fallback?.text ?? null);
  }

  private async findFirstVisible(rowLocator: Locator, selectors: readonly string[]): Promise<Locator | null> {
    for (const selector of selectors) {
      const locator = rowLocator.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) {
        return locator;
      }
    }

    return null;
  }

  private async buildActionSignature(
    locator: Locator,
    label: string,
    targetType: QaQueueTargetType,
    href: string | null,
  ): Promise<string> {
    const domSignature = await locator
      .evaluate((node) => {
        const element = node as {
          tagName: string;
          getAttribute(name: string): string | null;
        };
        return [
          element.tagName.toLowerCase(),
          element.getAttribute("href") ?? "",
          element.getAttribute("ngbtooltip") ?? "",
          element.getAttribute("title") ?? "",
          element.getAttribute("aria-label") ?? "",
          element.getAttribute("class") ?? "",
        ].join("|");
      })
      .catch(() => null);

    return `${domSignature ?? href ?? "action"}:${label}:${targetType}`;
  }
}

export function classifyQueueDocumentType(
  documentDescText: string | null,
  actionLabels: string[],
): {
  documentType: QaQueueDocumentType;
  reason: string;
} {
  const combinedText = [documentDescText, ...actionLabels]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  if (/\bvisit\b|\bvisit note\b|\bpt visit\b/.test(combinedText)) {
    return {
      documentType: "VISIT_NOTE",
      reason: 'Matched visit-note terms in the document description or action labels.',
    };
  }

  if (/\boasis\b|\bassessment\b/.test(combinedText)) {
    return {
      documentType: "OASIS",
      reason: 'Matched OASIS-related terms in the document description or action labels.',
    };
  }

  if (/plan of care/.test(combinedText)) {
    return {
      documentType: "PLAN_OF_CARE",
      reason: 'Matched "Plan of Care" in the document description or action labels.',
    };
  }

  if (/\border\b|phys\.\s*order|physician'?s order/.test(combinedText)) {
    return {
      documentType: "ORDER",
      reason: 'Matched order-related terms in the document description or action labels.',
    };
  }

  return {
    documentType: "UNKNOWN",
    reason: "No visit-note, plan-of-care, or order indicators were found before opening the row target.",
  };
}

function getDocumentTypeRank(documentType: QaQueueDocumentType): number {
  switch (documentType) {
    case "VISIT_NOTE":
      return 1;
    case "OASIS":
      return 2;
    case "PLAN_OF_CARE":
      return 3;
    case "ORDER":
      return 4;
    case "UNKNOWN":
    default:
      return 5;
  }
}

function classifyRowAction(input: {
  label: string;
  href: string | null;
  patientHref: string | null | undefined;
  documentHref: string | null | undefined;
}): QaQueueTargetType {
  const normalizedLabel = input.label.toLowerCase();

  if (
    normalizedLabel.includes("view / edit note") ||
    normalizedLabel.includes("view note") ||
    normalizedLabel.includes("edit note")
  ) {
    return "NOTE_OPEN_ACTION";
  }

  if (normalizedLabel.includes("fax delivery confirmation")) {
    return "OTHER_ACTION";
  }

  if (
    input.href &&
    input.patientHref &&
    input.href === input.patientHref
  ) {
    return "PATIENT_LINK";
  }

  if (
    input.href &&
    input.documentHref &&
    input.href === input.documentHref
  ) {
    return "DOCUMENT_LINK";
  }

  if (input.href?.includes("/documents/note/visitnote/")) {
    return "NOTE_OPEN_ACTION";
  }

  if (input.href?.includes("/client/") || input.href?.includes("/patient/") || /patient|client/i.test(normalizedLabel)) {
    return "PATIENT_LINK";
  }

  if (input.href?.includes("/documents/") || /document|note|order|oasis|plan of care/i.test(normalizedLabel)) {
    return "DOCUMENT_LINK";
  }

  return "OTHER_ACTION";
}

function inferLabelFromHref(href: string | null): string | null {
  if (!href) {
    return null;
  }

  if (href.includes("/documents/note/visitnote/")) {
    return "View / Edit Note";
  }

  return null;
}

function isSafeViewOnlyOtherAction(label: string): boolean {
  return /\bview\b|\bpreview\b|\bread\b/i.test(label) &&
    !/\bsave\b|\bsubmit\b|\bapprove\b|\bcomplete\b|\bupdate\b|\bdelete\b|\barchive\b|\bsign\b|\bsend\b/i.test(label);
}

const DATE_VALUE_PATTERN = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/;
const PROVIDER_VALUE_PATTERN = /\b(dr\.?|md|do|np|pa-c|physician|provider)\b/i;

function sanitizeShortCellValue(value: string | null | undefined): string | null {
  const normalized = normalizeText(value);
  if (!normalized || normalized.length > 80) {
    return null;
  }

  return normalized;
}

function sanitizeProviderLabel(value: string | null | undefined): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  if (normalized.length > 80) {
    return null;
  }

  if (PROVIDER_VALUE_PATTERN.test(normalized)) {
    return normalized.replace(/\b([A-Z])[a-z]+/g, "$1***");
  }

  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/.test(normalized)) {
    return normalized.replace(/\b([A-Z])[a-z]+/g, "$1***");
  }

  return normalized;
}

function isHeaderMatch(header: string | null, candidates: string[]): boolean {
  if (!header) {
    return false;
  }

  const normalizedHeader = header.toLowerCase();
  return candidates.some((candidate) => normalizedHeader.includes(candidate.toLowerCase()));
}

function maskDisplayName(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const segments = value
    .split(/\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .slice(0, 3);

  if (segments.length === 0) {
    return null;
  }

  return segments
    .map((segment) => `${segment[0]}***`)
    .join(" ");
}

function sanitizeQueueDocumentLabel(value: string | null | undefined): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  if (normalized.length > 120) {
    return normalized.slice(0, 120).trim();
  }

  return normalized;
}

function buildQueueRowFingerprint(input: {
  rowIndex: number;
  documentDesc: string | null;
  type: string | null;
  date: string | null;
  physician: string | null;
  documentType: QaQueueDocumentType;
}): string {
  const stableParts = [
    normalizeText(input.documentDesc) ?? "",
    normalizeText(input.type) ?? "",
    normalizeText(input.date) ?? "",
    normalizeText(input.physician) ?? "",
    input.documentType,
  ].filter((value) => value.length > 0);
  const raw = stableParts.length > 0
    ? stableParts.join("|")
    : `row-index:${input.rowIndex}|${input.documentType}`;

  return createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

async function isCurrentPaginationTarget(locator: Locator): Promise<boolean> {
  const [ariaCurrent, className] = await Promise.all([
    locator.getAttribute("aria-current").catch(() => null),
    locator.getAttribute("class").catch(() => null),
  ]);

  return ariaCurrent === "page" || /\b(active|current|selected)\b/i.test(className ?? "");
}

async function isDisabledPaginationTarget(locator: Locator): Promise<boolean> {
  const [enabled, ariaDisabled, disabled, className] = await Promise.all([
    locator.isEnabled().catch(() => true),
    locator.getAttribute("aria-disabled").catch(() => null),
    locator.getAttribute("disabled").catch(() => null),
    locator.getAttribute("class").catch(() => null),
  ]);

  return !enabled || ariaDisabled === "true" || disabled !== null || /\bdisabled\b/i.test(className ?? "");
}

function parsePaginationPageNumber(value: string | null | undefined): number | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/\bpage\s+(\d+)\b/i) ?? normalized.match(/\b(\d+)\b/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
