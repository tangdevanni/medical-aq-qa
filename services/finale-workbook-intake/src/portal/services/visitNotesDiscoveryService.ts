import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import type {
  AutomationStepLog,
  VisitNoteDiscoveryRow,
  VisitNotesDiscoveryArtifact,
  VisitNoteServiceType,
} from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import { createAutomationStepLog } from "../utils/automationLog";
import {
  determineVisitNoteCaptureEligibility,
  normalizeVisitNoteStatus,
  normalizeVisitNoteText,
  normalizeVisitNoteType,
  VISIT_NOTE_SERVICE_TYPES,
} from "../../services/visitNoteNormalizationService";
import { isSafeVisitNoteAction, isUnsafeVisitNoteAction } from "./visitNoteCaptureService";

export const VISIT_NOTES_DISCOVERY_FILE_NAME = "visit-notes-discovery.json";
export const VISIT_NOTES_DISCOVERY_ROW_SELECTOR = [
  "section.visitview tr.fin-data-table__tr",
  "tr.fin-data-table__tr",
  "fin-datatable tr.fin-data-table__tr",
  "table tbody tr",
  "fin-datatable table tbody tr",
  ".datatable-body-row",
  "[role='row']",
].join(", ");
export const VISIT_NOTES_DISCOVERY_CELL_SELECTOR = "td.fin-data-table__td, td, [role='cell'], .datatable-body-cell";
export const VISIT_NOTES_DISCOVERY_LINK_SELECTOR = "a.tbl-link, a.tb-link, a[href]";
export const VISIT_NOTES_DISCOVERY_HREF_SELECTOR = "a.tbl-link[href], a.tb-link[href], a[href]";
export const VISIT_NOTES_PAGE_SELECTOR = "section.visitview";
export const VISIT_NOTES_VISIT_LINK_SELECTOR = [
  "section.visitview a.tbl-link:has-text('Visit Note')",
  "section.visitview a.tb-link:has-text('Visit Note')",
  "section.visitview tr.fin-data-table__tr a.tbl-link:has-text('Visit Note')",
  "section.visitview tr.fin-data-table__tr a.tb-link:has-text('Visit Note')",
  "a.tbl-link:has-text('Visit Note')",
  "a.tb-link:has-text('Visit Note')",
  "tr.fin-data-table__tr a.tbl-link:has-text('Visit Note')",
  "tr.fin-data-table__tr a.tb-link:has-text('Visit Note')",
].join(", ");
export const VISIT_NOTES_MENU_SELECTORS = [
  "li.notes-sub-menu #documents span:has-text(\"Visit Notes\")",
  "li.notes-sub-menu #documents:has-text(\"Visit Notes\")",
  "li.notes-sub-menu.active #documents span:has-text(\"Visit Notes\")",
  "li.notes-sub-menu.active #documents:has-text(\"Visit Notes\")",
  "li.note-sub-menu #documents span:has-text(\"Visit Notes\")",
  "li.note-sub-menu #documents:has-text(\"Visit Notes\")",
  "li.note-sub-menu.active #documents span:has-text(\"Visit Notes\")",
  "li.note-sub-menu.active #documents:has-text(\"Visit Notes\")",
  "fin-sidebar-menu.notes-sub-menu div.flex.gap-2#documents:has-text(\"Visit Notes\")",
  "fin-sidebar-menu.notes-sub-menu li.note-sub-menu div.flex.gap-2#documents:has-text(\"Visit Notes\")",
  "fin-sidebar-menu.notes-sub-menu li.note-sub-menu.active div.flex.gap-2#documents:has-text(\"Visit Notes\")",
  "fin-sidebar-menu.notes-sub-menu li.note-sub-menu:has(div.flex.gap-2#documents):has-text(\"Visit Notes\")",
  "fin-sidebar-menu.notes-sub-menu div.flex.gap-2#documents:has(span:text-is(\"Visit Notes\"))",
  "fin-sidebar-menu.notes-sub-menu li.note-sub-menu div.flex.gap-2#documents:has(span:text-is(\"Visit Notes\"))",
  "fin-sidebar-menu.notes-sub-menu li.note-sub-menu.active div.flex.gap-2#documents:has(span:text-is(\"Visit Notes\"))",
  "fin-sidebar-menu.notes-sub-menu div.flex.gap-2:has(span.feather.ft-plus-square):has(span:text-is(\"Visit Notes\"))",
  "fin-sidebar-menu[class*='notes-sub-menu'] div.flex.gap-2#documents:has-text(\"Visit Notes\")",
  "fin-sidebar-menu[class*='notes-sub-menu'] li[class*='note-sub-menu'] div.flex.gap-2#documents:has-text(\"Visit Notes\")",
  "fin-sidebar div.flex.gap-2#documents:has(span:text-is(\"Visit Notes\"))",
  "fin-sidebar div.flex.gap-2#documents:has-text(\"Visit Notes\")",
  "fin-sidebar div.flex.gap-2:has(span.feather.ft-plus-square):has(span:text-is(\"Visit Notes\"))",
  "div.flex.gap-2#documents:has(span:text-is(\"Visit Notes\"))",
  "div.flex.gap-2#documents:has-text(\"Visit Notes\")",
  "div.flex.gap-2:has(span.feather.ft-plus-square):has(span:text-is(\"Visit Notes\"))",
  "#documents:has(span:text-is(\"Visit Notes\"))",
  "#documents:has-text(\"Visit Notes\")",
  "li.note-sub-menu:has(div.flex.gap-2#documents):has-text('Visit Notes')",
  "li.notes-sub-menu:has-text('Visit Notes')",
  "[class*='notes-sub-menu']:has-text('Visit Notes')",
  "a:has-text('Visit Notes')",
  "button:has-text('Visit Notes')",
  "span:text-is(\"Visit Notes\")",
  "text=/^Visit Notes$/i",
];
export const VISIT_NOTES_TABLE_LOAD_SELECTOR = [
  "section.visitview",
  "section.visitview tr.fin-data-table__tr",
  "section.visitview a.tbl-link:has-text('Visit Note')",
  "section.visitview a.tb-link:has-text('Visit Note')",
  "tr.fin-data-table__tr",
  "fin-datatable tr.fin-data-table__tr",
  "a.tbl-link:has-text('Visit Note')",
  "a.tb-link:has-text('Visit Note')",
  "tr.fin-data-table__tr a.tbl-link:has-text('Visit Note')",
  "tr.fin-data-table__tr a.tb-link:has-text('Visit Note')",
].join(", ");
export const VISIT_NOTES_CHILD_NAV_SELECTORS = [
  "a[href*='visit-notes']",
  "a[href*='visit_notes']",
  "a[href*='visit-note']",
  "a:has-text('Visit Notes')",
  "button:has-text('Visit Notes')",
  "[role='menuitem']:has-text('Visit Notes')",
];
export const VISIT_NOTES_DOCUMENTATION_MENU_SELECTORS = [
  "fin-sidebar-menu-root span:text-is('Documentations')",
  "fin-sidebar-menu span:text-is('Documentations')",
  "fin-sidebar span:text-is('Documentations')",
  "fin-sidebar-menu-root span:has-text('Documentations')",
  "fin-sidebar-menu span:has-text('Documentations')",
  "fin-sidebar span:has-text('Documentations')",
];

export type RawVisitNoteDiscoveryRow = {
  portalDocumentId?: string;
  rawDocumentType?: string | null;
  visitDate?: string | null;
  visitTime?: string | null;
  assignedStaffRaw?: string | null;
  statusRaw?: string | null;
  createdBy?: string | null;
  rowText?: string | null;
  sourceUrl?: string | null;
  hasSafeOpenAction?: boolean;
  actionHints?: string[];
  rowIndex?: number;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizePageUrl(url: string): string {
  return url
    .replace(/\/client\/[^/?#]+/i, "/client/<client-id>")
    .replace(/\/provider\/[^/?#]+/i, "/provider/<provider-id>")
    .replace(/[?&](token|auth|signature|download|file)=[^&#]+/gi, "$1=<redacted>");
}

function createVisitNoteKey(row: RawVisitNoteDiscoveryRow): string {
  if (row.portalDocumentId?.trim()) {
    return `visit-note-${sha256(row.portalDocumentId.trim()).slice(0, 16)}`;
  }

  const identity = [
    row.rawDocumentType,
    row.visitDate,
    row.visitTime,
    row.assignedStaffRaw,
    row.statusRaw,
    row.rowText,
  ].map((value) => normalizeVisitNoteText(value)).join("|");
  return `visit-note-${sha256(identity).slice(0, 16)}`;
}

function inferAssignedStaffName(value: string | null | undefined): string | undefined {
  const normalized = normalizeVisitNoteText(value);
  if (!normalized) {
    return undefined;
  }
  return normalized.replace(/\b(RN|SN|PTA?|OT|ST|SLP|HHA|MSW|RD|RT)\b/gi, "").replace(/[,-]+$/g, "").trim() || normalized;
}

function inferAssignedStaffDiscipline(value: string | null | undefined, visitType: VisitNoteServiceType): string | undefined {
  const normalized = normalizeVisitNoteText(value);
  const explicit = normalized.match(/\b(RN|SN|PTA?|OT|ST|SLP|HHA|MSW|RD|RT)\b/i)?.[1];
  return explicit?.toUpperCase() ?? visitType;
}

export function buildVisitNotesDiscoveryArtifact(input: {
  patientKeyHash: string;
  episode?: VisitNotesDiscoveryArtifact["episode"];
  pageUrl?: string | null;
  rows: RawVisitNoteDiscoveryRow[];
  generatedAt?: string;
  warnings?: string[];
  diagnostics?: VisitNotesDiscoveryArtifact["diagnostics"];
}): VisitNotesDiscoveryArtifact {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const warnings = [...(input.warnings ?? [])];
  const deduped = new Map<string, VisitNoteDiscoveryRow>();
  const sourceRows = warnings.some((warning) => warning.includes("provider-wide"))
    ? []
    : input.rows;

  for (const [inputIndex, rawRow] of sourceRows.entries()) {
    const rawDocumentType = normalizeVisitNoteText(rawRow.rawDocumentType) || "Unknown visit note";
    const assignedStaffRaw = normalizeVisitNoteText(rawRow.assignedStaffRaw) || undefined;
    const normalization = normalizeVisitNoteType({ rawDocumentType, assignedStaffRaw });
    const rowText = normalizeVisitNoteText(rawRow.rowText) || [
      rawDocumentType,
      rawRow.visitDate,
      assignedStaffRaw,
      rawRow.statusRaw,
    ].map((value) => normalizeVisitNoteText(value)).filter(Boolean).join(" | ");
    const visitNoteKey = createVisitNoteKey({ ...rawRow, rawDocumentType, rowText });
    const sourceUrl = normalizeVisitNoteText(rawRow.sourceUrl);
    const normalizedStatus = normalizeVisitNoteStatus(rawRow.statusRaw);
    const hasSafeOpenAction = Boolean(rawRow.hasSafeOpenAction);
    const eligibility = determineVisitNoteCaptureEligibility({
      normalizedVisitType: normalization.normalizedVisitType,
      normalizedStatus,
      rawDocumentType,
    });
    const row: VisitNoteDiscoveryRow = {
      visitNoteKey,
      ...(rawRow.portalDocumentId?.trim() ? { portalDocumentId: rawRow.portalDocumentId.trim() } : {}),
      rawDocumentType,
      normalizedVisitType: normalization.normalizedVisitType,
      normalizedVisitTypeConfidence: normalization.normalizedVisitTypeConfidence,
      normalizationReason: normalization.normalizationReason,
      ...(normalizeVisitNoteText(rawRow.visitDate) ? { visitDate: normalizeVisitNoteText(rawRow.visitDate) } : {}),
      ...(normalizeVisitNoteText(rawRow.visitTime) ? { visitTime: normalizeVisitNoteText(rawRow.visitTime) } : {}),
      ...(assignedStaffRaw ? { assignedStaffRaw } : {}),
      ...(assignedStaffRaw ? { assignedStaffName: inferAssignedStaffName(assignedStaffRaw) } : {}),
      ...(assignedStaffRaw ? { assignedStaffDiscipline: inferAssignedStaffDiscipline(assignedStaffRaw, normalization.normalizedVisitType) } : {}),
      ...(normalizeVisitNoteText(rawRow.statusRaw) ? { statusRaw: normalizeVisitNoteText(rawRow.statusRaw) } : {}),
      normalizedStatus,
      ...(normalizeVisitNoteText(rawRow.createdBy) ? { createdBy: normalizeVisitNoteText(rawRow.createdBy) } : {}),
      rowTextHash: sha256(rowText),
      rowIndex: rawRow.rowIndex ?? inputIndex,
      ...(sourceUrl ? { sourceUrlHash: sha256(sourceUrl) } : {}),
      hasSafeOpenAction,
      canOpenSafely: hasSafeOpenAction,
      actionHints: [...(rawRow.actionHints ?? [])],
      lifecycleStatus: eligibility.lifecycleStatus,
      captureEligibility: eligibility.captureEligibility,
      captureStatus: "not_attempted",
      ...(eligibility.skipReason ? { skipReason: eligibility.skipReason } : {}),
    };
    const dedupeKey = row.portalDocumentId
      ? `portal:${row.portalDocumentId}`
      : `${row.rawDocumentType.toLowerCase()}|${row.visitDate ?? ""}|${row.assignedStaffRaw ?? ""}|${row.rowTextHash}`;
    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, row);
    }
  }

  const rows = Array.from(deduped.values()).map((row, rowIndex) => ({ ...row, rowIndex }));
  const byVisitType = Object.fromEntries(VISIT_NOTE_SERVICE_TYPES.map((type) => [type, 0])) as Record<VisitNoteServiceType, number>;
  const byStatus: Record<string, number> = {};
  const byVisitTypeAndStatus = Object.fromEntries(
    VISIT_NOTE_SERVICE_TYPES.map((type) => [type, {}]),
  ) as Record<VisitNoteServiceType, Record<string, number>>;

  for (const row of rows) {
    byVisitType[row.normalizedVisitType] += 1;
    const status = row.normalizedStatus ?? row.statusRaw ?? "unknown";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    byVisitTypeAndStatus[row.normalizedVisitType][status] =
      (byVisitTypeAndStatus[row.normalizedVisitType][status] ?? 0) + 1;
  }

  if (rows.length === 0 && !warnings.some((warning) =>
    /provider-wide|sidebar_menu_not_found|table_not_detected_after_navigation|visit_notes_page_not_loaded/i.test(warning),
  )) {
    warnings.push("no_eligible_notes: Visit Notes page loaded but no eligible visit-note rows were found.");
  }

  return {
    schemaVersion: "visit-notes-discovery.v1",
    generatedAt,
    patientKeyHash: input.patientKeyHash,
    episode: input.episode ?? {},
    ...(input.pageUrl ? { pageUrlSanitized: sanitizePageUrl(input.pageUrl) } : {}),
    rows,
    counts: {
      total: rows.length,
      byVisitType,
      byStatus,
      byVisitTypeAndStatus,
    },
    warnings: Array.from(new Set(warnings)),
    ...(input.diagnostics ? { diagnostics: input.diagnostics } : {}),
  };
}

async function clickFirstVisible(page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await page.locator(selector).count().catch(() => 0);
    if (count === 0) {
      continue;
    }
    await locator.scrollIntoViewIfNeeded({ timeout: 2_500 }).catch(() => undefined);
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }
    await locator.click({ timeout: 5_000 }).catch(async () => {
      await locator.evaluate((element) => (element as unknown as { click: () => void }).click()).catch(() => undefined);
    });
    return selector;
  }
  return null;
}

async function countVisitNotesPageSignals(page: Page): Promise<{
  sectionVisitviewCount: number;
  tableRowCount: number;
  visitNoteLinkCount: number;
}> {
  const sectionVisitviewCount = await page.locator(VISIT_NOTES_PAGE_SELECTOR).count().catch(() => 0);
  const tableRowCount = Math.min(await page.locator(VISIT_NOTES_DISCOVERY_ROW_SELECTOR).count().catch(() => 0), 500);
  const visitNoteLinkCount = Math.min(await page.locator(VISIT_NOTES_VISIT_LINK_SELECTOR).count().catch(() => 0), 500);
  return { sectionVisitviewCount, tableRowCount, visitNoteLinkCount };
}

function visitNotesPageDetected(signals: { sectionVisitviewCount: number; tableRowCount: number; visitNoteLinkCount: number }): boolean {
  return signals.sectionVisitviewCount > 0 || signals.tableRowCount > 0 || signals.visitNoteLinkCount > 0;
}

async function extractVisitNoteRowsFromPage(page: Page): Promise<RawVisitNoteDiscoveryRow[]> {
  const rowLocator = page.locator(VISIT_NOTES_DISCOVERY_ROW_SELECTOR);
  const count = Math.min(await rowLocator.count().catch(() => 0), 500);
  const rows: RawVisitNoteDiscoveryRow[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = rowLocator.nth(index);
    const text = normalizeVisitNoteText(await row.innerText({ timeout: 2_000 }).catch(() => ""));
    if (!/visit\s*note/i.test(text)) {
      continue;
    }
    const cells = await row.locator(VISIT_NOTES_DISCOVERY_CELL_SELECTOR).allInnerTexts().catch(() => [] as string[]);
    const normalizedCells = cells.map(normalizeVisitNoteText).filter(Boolean);
    const linkText = normalizeVisitNoteText(
      await row.locator(VISIT_NOTES_DISCOVERY_LINK_SELECTOR).first().innerText({ timeout: 1_000 }).catch(() => ""),
    );
    const rawDocumentType = linkText && /visit\s*note/i.test(linkText)
      ? linkText
      : normalizedCells.find((cell) => /visit\s*note/i.test(cell)) ?? text.match(/Visit\s*Note[^\n|]*/i)?.[0] ?? "Visit Note";
    const sourceUrl = await row.locator(VISIT_NOTES_DISCOVERY_HREF_SELECTOR).first().getAttribute("href").catch(() => null);
    const actionText = normalizedCells.filter((cell) => /open|view|print|download|preview|pdf|action|edit|sign/i.test(cell));
    const safeActionText = actionText.filter(isSafeVisitNoteAction);
    rows.push({
      rawDocumentType,
      visitDate: normalizedCells.find((cell) => /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(cell)),
      assignedStaffRaw: normalizedCells.find((cell) => /\b(RN|SN|PTA?|OT|ST|SLP|HHA|MSW|RD|RT)\b/i.test(cell)),
      statusRaw: normalizedCells.find((cell) => /QA Completed|E-?Signed|Signed|Not Started|Missed Visit|In Progress|Submitted/i.test(cell)),
      createdBy: normalizedCells.at(4),
      rowText: text,
      sourceUrl,
      rowIndex: index,
      hasSafeOpenAction: Boolean(linkText || (sourceUrl && !isUnsafeVisitNoteAction(sourceUrl)) || safeActionText.length > 0),
      actionHints: [
        ...(linkText ? [`link:${linkText}`] : []),
        ...safeActionText,
      ].slice(0, 4),
    });
  }
  return rows;
}

async function buildVisitNotesNavigationDiagnostics(input: {
  page: Page;
  urlBefore: string;
  urlAfter: string;
  selectorUsed: string | null;
  retrySelectorUsed: string | null;
  documentationSelectorUsed: string | null;
  childSelectorUsed: string | null;
}): Promise<NonNullable<VisitNotesDiscoveryArtifact["diagnostics"]>> {
  const visitviewCount = await input.page.locator(VISIT_NOTES_PAGE_SELECTOR).count().catch(() => 0);
  const tableRowCount = Math.min(await input.page.locator(VISIT_NOTES_DISCOVERY_ROW_SELECTOR).count().catch(() => 0), 500);
  const tblLinkCount = Math.min(await input.page.locator("a.tbl-link:has-text('Visit Note')").count().catch(() => 0), 500);
  const tbLinkCount = Math.min(await input.page.locator("a.tb-link:has-text('Visit Note')").count().catch(() => 0), 500);
  const rowTexts = await input.page
    .locator(VISIT_NOTES_DISCOVERY_ROW_SELECTOR)
    .evaluateAll((elements) => elements.slice(0, 5).map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 240)))
    .catch(() => [] as string[]);

  return {
    beforeUrl: sanitizePageUrl(input.urlBefore),
    afterUrl: sanitizePageUrl(input.urlAfter),
    sidebarSelectorUsed: input.selectorUsed ?? null,
    retrySelectorUsed: input.retrySelectorUsed ?? null,
    documentationSelectorUsed: input.documentationSelectorUsed ?? null,
    childSelectorUsed: input.childSelectorUsed ?? null,
    sidebarMenuFound: Boolean(input.selectorUsed),
    sidebarMenuClicked: Boolean(input.selectorUsed && input.selectorUsed !== "already_visible_visit_notes_table"),
    sectionVisitviewCount: visitviewCount,
    tableRowCount,
    tblLinkCount,
    tbLinkCount,
    firstRowTexts: rowTexts.filter(Boolean),
  };
}

export async function discoverVisitNotesFromPage(input: {
  page: Page;
  patientKeyHash: string;
  patientName?: string;
  patientArtifactsDirectory: string;
  episode?: VisitNotesDiscoveryArtifact["episode"];
  logger?: Logger;
}): Promise<{
  artifact: VisitNotesDiscoveryArtifact;
  discoveryPath: string;
  stepLogs: AutomationStepLog[];
}> {
  const stepLogs: AutomationStepLog[] = [];
  const warnings: string[] = [];
  const urlBefore = input.page.url();

  let selectorUsed: string | null = null;
  let documentationSelectorUsed: string | null = null;
  let childSelectorUsed: string | null = null;
  let retrySelectorUsed: string | null = null;

  const initiallyVisibleSignals = await countVisitNotesPageSignals(input.page);
  if (visitNotesPageDetected(initiallyVisibleSignals)) {
    selectorUsed = "already_visible_visit_notes_table";
  } else {
    selectorUsed = await clickFirstVisible(input.page, VISIT_NOTES_MENU_SELECTORS);
  }

  if (!selectorUsed) {
    documentationSelectorUsed = await clickFirstVisible(input.page, VISIT_NOTES_DOCUMENTATION_MENU_SELECTORS).catch(() => null);
    if (documentationSelectorUsed) {
      await input.page.waitForTimeout(750).catch(() => undefined);
      selectorUsed = await clickFirstVisible(input.page, VISIT_NOTES_MENU_SELECTORS);
    }
  }

  if (!selectorUsed) {
    warnings.push("sidebar_menu_not_found: Visit Notes sidebar/menu item was not found from the patient chart.");
  } else {
    await input.page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => undefined);
    await input.page.waitForSelector(VISIT_NOTES_TABLE_LOAD_SELECTOR, { timeout: 10_000 }).catch(() => undefined);
    await input.page.waitForTimeout(1_500).catch(() => undefined);
    const initialSignals = await countVisitNotesPageSignals(input.page);
    if (!visitNotesPageDetected(initialSignals)) {
      retrySelectorUsed = await clickFirstVisible(
        input.page,
        VISIT_NOTES_MENU_SELECTORS.filter((selector) => selector !== selectorUsed),
      ).catch(() => null);
      if (retrySelectorUsed) {
        await input.page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => undefined);
        await input.page.waitForSelector(VISIT_NOTES_TABLE_LOAD_SELECTOR, { timeout: 10_000 }).catch(() => undefined);
        await input.page.waitForTimeout(1_500).catch(() => undefined);
      }
    }
    const signalsAfterRetry = await countVisitNotesPageSignals(input.page);
    if (!visitNotesPageDetected(signalsAfterRetry)) {
      childSelectorUsed = await clickFirstVisible(input.page, VISIT_NOTES_CHILD_NAV_SELECTORS).catch(() => null);
      if (childSelectorUsed) {
        await input.page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => undefined);
        await input.page.waitForSelector(VISIT_NOTES_TABLE_LOAD_SELECTOR, { timeout: 10_000 }).catch(() => undefined);
        await input.page.waitForTimeout(1_500).catch(() => undefined);
      }
    }
  }

  const urlAfter = input.page.url();
  if (/\/provider\/[^/]+\/documents(?:[/?#]|$)/i.test(urlAfter) && !/\/client\//i.test(urlAfter)) {
    warnings.push("Rejected provider-wide Documents route; patient-level Visit Notes route was not confirmed.");
  }

  const sectionVisitviewCount = await input.page.locator(VISIT_NOTES_PAGE_SELECTOR).count().catch(() => 0);
  const tableRowCount = Math.min(await input.page.locator(VISIT_NOTES_DISCOVERY_ROW_SELECTOR).count().catch(() => 0), 500);
  const visitNoteLinkCount = Math.min(await input.page.locator(VISIT_NOTES_VISIT_LINK_SELECTOR).count().catch(() => 0), 500);
  const tblLinkCount = Math.min(await input.page.locator("a.tbl-link:has-text('Visit Note')").count().catch(() => 0), 500);
  const tbLinkCount = Math.min(await input.page.locator("a.tb-link:has-text('Visit Note')").count().catch(() => 0), 500);
  const tableDetected = sectionVisitviewCount > 0 || tableRowCount > 0 || visitNoteLinkCount > 0;
  if (selectorUsed && !tableDetected && !warnings.some((warning) => warning.includes("provider-wide"))) {
    warnings.push("table_not_detected_after_navigation: Visit Notes menu was clicked but no patient-level Visit Notes table was detected.");
  }

  const rawRows = warnings.some((warning) => warning.includes("provider-wide"))
    ? []
    : await extractVisitNoteRowsFromPage(input.page);
  const diagnostics = await buildVisitNotesNavigationDiagnostics({
    page: input.page,
    urlBefore,
    urlAfter,
    selectorUsed,
    retrySelectorUsed,
    documentationSelectorUsed,
    childSelectorUsed,
  });
  const artifact = buildVisitNotesDiscoveryArtifact({
    patientKeyHash: input.patientKeyHash,
    episode: input.episode,
    pageUrl: urlAfter,
    rows: rawRows,
    warnings,
    diagnostics,
  });
  const discoveryPath = path.join(input.patientArtifactsDirectory, VISIT_NOTES_DISCOVERY_FILE_NAME);
  await mkdir(path.dirname(discoveryPath), { recursive: true });
  await writeFile(discoveryPath, JSON.stringify(artifact, null, 2), "utf8");

  stepLogs.push(createAutomationStepLog({
    step: "visit_notes_discovery",
    message: "Discovered patient-level Visit Notes rows without opening or editing notes.",
    patientName: input.patientName ?? "Unknown patient",
    urlBefore,
    urlAfter,
    found: [
      `visitNotesDiscoveryPath=${discoveryPath}`,
      `rowCount=${artifact.counts.total}`,
      `sidebarSelectorUsed=${documentationSelectorUsed ?? "none"}`,
      `selectorUsed=${selectorUsed ?? "none"}`,
      `retrySelectorUsed=${retrySelectorUsed ?? "none"}`,
      `childSelectorUsed=${childSelectorUsed ?? "none"}`,
      `sidebarMenuFound=${selectorUsed ? "true" : "false"}`,
      `sidebarMenuClicked=${selectorUsed ? "true" : "false"}`,
      `submenuExpanded=${selectorUsed && childSelectorUsed ? "true" : "unknown"}`,
      `tableDetected=${tableDetected ? "true" : "false"}`,
      `sectionVisitviewCount=${sectionVisitviewCount}`,
      `tableRowCount=${tableRowCount}`,
      `visitNoteLinkCount=${visitNoteLinkCount}`,
      `tblLinkCount=${tblLinkCount}`,
      `tbLinkCount=${tbLinkCount}`,
    ],
    missing: artifact.counts.total > 0 ? [] : ["Visit Notes rows"],
    evidence: artifact.warnings.slice(0, 8),
    safeReadConfirmed: true,
  }));

  input.logger?.info(
    {
      visitNoteRowCount: artifact.counts.total,
      byVisitType: artifact.counts.byVisitType,
      byStatus: artifact.counts.byStatus,
      warningCount: artifact.warnings.length,
    },
    "visit notes discovery completed",
  );

  return { artifact, discoveryPath, stepLogs };
}

export function buildVisitNotesDiscoveryArtifactForTest(
  input: Omit<Parameters<typeof buildVisitNotesDiscoveryArtifact>[0], "patientKeyHash"> & {
    patientKeyHash?: string;
  },
): VisitNotesDiscoveryArtifact {
  return buildVisitNotesDiscoveryArtifact({
    ...input,
    patientKeyHash: input.patientKeyHash ?? "patient-key-hash",
  });
}
