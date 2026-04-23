import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page, Response } from "@playwright/test";
import type {
  ArtifactRecord,
  ArtifactType,
  AutomationStepLog,
  DocumentInventoryItem,
  PortalSafetyConfig,
} from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import { extractOasisCalendarScope } from "../../qa/oasis/calendar/extractOasisCalendarScope";
import type {
  OasisCalendarScopeResult,
  RawOasisCalendarDayCellInput,
  RawOasisCalendarTileInput,
} from "../../qa/oasis/calendar/oasisCalendarTypes";
import {
  buildAllTileLogPayload,
  buildDateCountPayload,
  buildDateCellLogPayloads,
  buildOasisDateLogPayloads,
  buildOasisSegmentLogPayloads,
  buildSegmentLogPayloads,
} from "../../qa/oasis/calendar/oasisCalendarLogging";
import { selectorRegistry } from "../selectorRegistry";
import { chartCalendarSelectors } from "../selectors/chart-calendar.selectors";
import { chartDocumentSelectors } from "../selectors/chart-document.selectors";
import { oasisDiagnosisSelectors } from "../selectors/oasis-diagnosis.selectors";
import type { PortalSelectorCandidate } from "../selectors/types";
import {
  assertReadOnlyActionAllowed,
  detectDangerousControls,
  resolvePortalSafetyConfig,
} from "../safety/readOnlySafety";
import { createAutomationStepLog } from "../utils/automationLog";
import {
  resolveFirstVisibleLocator,
  resolveVisibleLocatorList,
  selectorAttemptToEvidence,
  waitForPortalPageSettled,
  type PortalDebugConfig,
} from "../utils/locatorResolution";
import {
  createEmptyOasisDiagnosisPageSnapshot,
  inspectOasisDiagnosisPage,
  type OasisDiagnosisPageSnapshot,
} from "../utils/oasisDiagnosisInspector";
import {
  isOasisDiagnosisRowActionable,
  isOasisDiagnosisRowInteractable,
  type OasisDiagnosisRowCandidate,
  type OasisDiagnosisRowFieldSignal,
} from "../utils/oasisDiagnosisRowHeuristics";
import {
  detectOasisLockState,
  refineOasisLockStateWithDiagnosisSnapshot,
  type OasisLockStateSnapshot,
} from "../utils/oasisLockStateDetector";
import {
  capturePageDebugArtifacts,
  dumpTopVisibleText,
  pauseOnFailureIfRequested,
  summarizeButtons,
  summarizeInteractiveElements,
  summarizeTables,
} from "../utils/pageDiagnostics";
import {
  evaluateDocumentInventoryCandidate,
  dedupeDocumentInventory,
  type DocumentInventoryCandidate,
} from "../../services/documentInventoryService";
import {
  analyzeDocumentText,
  extractPossibleIcd10Codes,
} from "../../services/documentTextAnalysis";
import { decideDocumentExtractionPolicy } from "../../services/documentExtractionPolicyService";
import { captureChartDocument } from "../services/chartDocumentCaptureService";
import type { OasisReadyDiagnosisDocument } from "../../services/codingInputExportService";
import type {
  OasisAssessmentNoteOpenResult,
  OasisPrintedNoteCaptureOpenResult,
  OasisMenuOpenResult,
} from "../../oasis/types/oasisQaResult";
import { deriveOasisAssessmentProcessingSummary } from "../../oasis/status/oasisAssessmentProcessingStatus";

const MIN_OASIS_PRINT_CAPTURE_TIMEOUT_MS = 30_000;
import {
  DEFAULT_OASIS_PRINT_SECTION_PROFILE_KEY,
  findMatchingOasisPrintSectionLabels,
  getOasisPrintSectionProfile,
  type OasisPrintSectionProfile,
  type OasisPrintSectionProfileKey,
} from "../../oasis/print/oasisPrintedNoteProfiles";
import { extractDocumentsFromArtifacts } from "../../services/documentExtractionService";
import type {
  OasisExecutionActionPerformed,
  OasisDiagnosisExecutionGuardDecision,
} from "../../services/oasisDiagnosisExecutionService";
import { evaluateOasisDiagnosisExecutionGuard } from "../../services/oasisDiagnosisExecutionService";
import type {
  OasisInputAction,
  OasisInputActionPlan,
} from "../../services/oasisInputActionPlanService";

const artifactTypes = Object.keys(selectorRegistry.chartArtifacts) as ArtifactType[];
const MINIMUM_QA_DOCUMENT_TYPES: ReadonlyArray<DocumentInventoryItem["normalizedType"]> = [
  "OASIS",
  "POC",
  "VISIT_NOTE",
  "ORDER",
];
const OASIS_SIDEBAR_ROOT_SELECTORS: Array<{
  selector: string;
  description: string;
}> = [
  {
    selector: 'fin-sidebar-menu-root:has(li.notes-sub-menu #documents)',
    description: "patient left sidebar root by fin-sidebar-menu-root containing #documents",
  },
  {
    selector: 'fin-sidebar-menu:has(li.notes-sub-menu #documents)',
    description: "patient left sidebar root by fin-sidebar-menu containing #documents",
  },
  {
    selector: 'aside:has(fin-sidebar-menu-root li.notes-sub-menu #documents), [class*="sidebar"]:has(fin-sidebar-menu-root li.notes-sub-menu #documents), [class*="left-menu"]:has(fin-sidebar-menu-root li.notes-sub-menu #documents), [class*="side-menu"]:has(fin-sidebar-menu-root li.notes-sub-menu #documents)',
    description: "patient left sidebar container with nested fin-sidebar-menu-root and #documents",
  },
  {
    selector: 'li.notes-sub-menu:has(#documents), [class*="notes-sub-menu"]:has(#documents)',
    description: "patient sidebar submenu item containing #documents",
  },
];
const OASIS_POST_CLICK_MARKERS: PortalSelectorCandidate[] = [
  {
    strategy: "css",
    selector: 'app-private-documents, fin-datatable, section.listview, [class*="listview"]',
    description: "OASIS documents page wrappers",
  },
  {
    strategy: "css",
    selector: 'li.notes-sub-menu.active:has-text("OASIS"), [class*="notes-sub-menu"][class*="active"]:has-text("OASIS")',
    description: "OASIS sidebar active-state marker",
  },
  {
    strategy: "css",
    selector: "main section.listview",
    description: "OASIS documents listview section",
  },
];
const OASIS_DOCUMENT_LIST_SELECTORS: PortalSelectorCandidate[] = [
  {
    strategy: "css",
    selector: "app-private-documents table tbody tr, fin-datatable table tbody tr, table tbody tr",
    description: "OASIS document table rows by app-private-documents/fin-datatable/table tbody tr",
  },
  {
    strategy: "css",
    selector: 'tr:has(a.tbl-link), tr:has(a[href])',
    description: "OASIS document rows containing anchors",
  },
  {
    strategy: "css",
    selector: 'a.tbl-link, table tbody tr a, [class*="table"] a',
    description: "OASIS document anchors by tbl-link/table fallback",
  },
];
const SOC_DOCUMENT_OPEN_MARKERS: PortalSelectorCandidate[] = [
  {
    strategy: "css",
    selector: "app-oasis",
    description: "SOC document page app-oasis wrapper",
  },
  {
    strategy: "css",
    selector: "app-document-note",
    description: "SOC document page document-note wrapper",
  },
  {
    strategy: "css",
    selector: "app-document-sent-details",
    description: "SOC document page sent-details wrapper",
  },
  {
    strategy: "css",
    selector: "fin-slideover, fin-modal",
    description: "SOC document slideover/modal wrapper",
  },
];
const OASIS_SECTION_DROPDOWN_SELECTORS: PortalSelectorCandidate[] = [
  {
    strategy: "css",
    selector: "fin-select.select-oasis-pages ng-select, fin-select[class*='select-oasis-pages'] ng-select",
    description: "OASIS section dropdown ng-select under fin-select.select-oasis-pages",
  },
  {
    strategy: "css",
    selector: "fin-select.select-oasis-pages, fin-select[class*='select-oasis-pages']",
    description: "OASIS section fin-select container",
  },
  {
    strategy: "css",
    selector: "ng-select:has(.ng-arrow-wrapper)",
    description: "generic ng-select with arrow wrapper",
  },
];
const OASIS_SECTION_DROPDOWN_TRIGGER_SELECTORS: PortalSelectorCandidate[] = [
  {
    strategy: "css",
    selector: ".ng-arrow-wrapper, .ng-select-container, input[role='combobox']",
    description: "OASIS section dropdown trigger",
  },
];
const OASIS_ACTIVE_DIAGNOSES_OPTION_SELECTORS: PortalSelectorCandidate[] = [
  {
    strategy: "css",
    selector: "ng-dropdown-panel .ng-option:has-text('Active Diagnoses'), ng-dropdown-panel .ng-option-label:has-text('Active Diagnoses')",
    description: "Active Diagnoses option in ng-dropdown-panel",
  },
  {
    strategy: "text",
    value: /^Active Diagnoses$/i,
    description: "Active Diagnoses text option",
  },
];
const OASIS_ACTIVE_DIAGNOSES_SELECTED_MARKERS: PortalSelectorCandidate[] = [
  {
    strategy: "css",
    selector: "fin-select.select-oasis-pages .ng-value:has-text('Active Diagnoses'), fin-select.select-oasis-pages .ng-select-container:has-text('Active Diagnoses')",
    description: "Active Diagnoses currently selected in section dropdown",
  },
  {
    strategy: "text",
    value: /^Active Diagnoses$/i,
    description: "Active Diagnoses visible text marker",
  },
];
const OASIS_DIAGNOSIS_SECTION_MARKERS: PortalSelectorCandidate[] = [
  {
    strategy: "text",
    value: /Active Diagnoses/i,
    description: "Active Diagnoses section marker",
  },
  {
    strategy: "text",
    value: /Diagnosis/i,
    description: "Diagnosis section marker",
  },
  {
    strategy: "css",
    selector: "[class*='diagnos'], [id*='diagnos']",
    description: "diagnosis-related wrapper by class/id contains diagnos",
  },
];
const OASIS_DIAGNOSIS_LIST_SELECTORS: PortalSelectorCandidate[] = [
  {
    strategy: "text",
    value: /Diagnosis List/i,
    description: "Diagnosis List heading/label",
  },
  {
    strategy: "css",
    selector: "table:has-text('Diagnosis'), [class*='diagnosis-list'], [id*='diagnosis-list'], [class*='diagnosis'] table",
    description: "Diagnosis list/table wrappers",
  },
];
const OASIS_SECTION_CHEVRON_RIGHT_SELECTORS: PortalSelectorCandidate[] = [
  {
    strategy: "css",
    selector: "fin-button[icon='ft-chevrons-right'] button, fin-button[icon='ft-chevrons-right'], [icon='ft-chevrons-right']",
    description: "OASIS next section chevron button",
  },
];
const FILE_UPLOADS_SIDEBAR_LABEL_SELECTORS: PortalSelectorCandidate[] = [
  {
    strategy: "css",
    selector: 'a[href*="/file-uploads"]:has(.fin-sidebar__label), fin-sidebar-menu-root a[href*="/file-uploads"]',
    description: "patient File Uploads sidebar anchor by /file-uploads href",
  },
  {
    strategy: "css",
    selector: 'a[href*="/file-uploads"] .fin-sidebar__label:has-text("File Uploads"), span.fin-sidebar__label:has-text("File Uploads")',
    description: "patient File Uploads sidebar label by fin-sidebar__label",
  },
  {
    strategy: "css",
    selector: 'fin-sidebar-menu-root a:has(.fin-sidebar__label:has-text("File Uploads"))',
    description: "patient File Uploads fin-sidebar-menu-root anchor containing File Uploads label",
  },
  {
    strategy: "css",
    selector: "li.notes-sub-menu #documents span:has-text('File Uploads')",
    description: "File Uploads sidebar label in notes-sub-menu #documents",
  },
  {
    strategy: "css",
    selector: "li.notes-sub-menu span:has-text('File Uploads')",
    description: "File Uploads sidebar label in notes-sub-menu",
  },
  {
    strategy: "text",
    value: /^File Uploads$/i,
    description: "File Uploads exact label text",
  },
];
const FILE_UPLOADS_PAGE_MARKERS: PortalSelectorCandidate[] = [
  {
    strategy: "css",
    selector: "app-client-file-upload",
    description: "File Uploads page root component app-client-file-upload",
  },
  {
    strategy: "css",
    selector: "app-client-file-upload app-tree-view, app-tree-view.tree-view, app-tree-view",
    description: "File Uploads tree/list component app-tree-view",
  },
  {
    strategy: "css",
    selector: ".cdk-drag.example-box.folder-item, .folder-item, .folder-label",
    description: "File Uploads folder rows and folder labels",
  },
  {
    strategy: "css",
    selector: ".cdk-drag.example-box.file-item, .file-item, .file-label",
    description: "File Uploads file rows and file labels",
  },
  {
    strategy: "css",
    selector: "table tbody tr:has(a.tbl-link), table tbody tr:has(a), table tbody tr:has(button)",
    description: "File Uploads/admission table rows in main content",
  },
  {
    strategy: "css",
    selector: "a:has-text('root/Referral'), a:has-text('Referral'), [role='treeitem']:has-text('Referral')",
    description: "File Uploads referral folder markers",
  },
  {
    strategy: "text",
    value: /Admission\s+Order|Admission\s+Info|Admission\s+Packets|Doc Uploads|root\s*\/\s*Referral|Referral/i,
    description: "File Uploads/admission content markers",
  },
  {
    strategy: "css",
    selector: "app-document-note [class*='upload'], app-document-note [id*='upload'], app-oasis [class*='upload'], app-oasis [id*='upload']",
    description: "File Uploads/upload-related wrappers in OASIS document view",
  },
];
const FILE_UPLOADS_DOCUMENT_ANCHOR_SELECTORS: PortalSelectorCandidate[] = [
  {
    strategy: "css",
    selector: ".cdk-drag.example-box.file-item:has(.file-label), .file-item:has(.file-label)",
    description: "File Uploads downloadable file rows by .file-item",
  },
  {
    strategy: "css",
    selector: ".file-label",
    description: "File Uploads downloadable file labels by .file-label",
  },
  {
    strategy: "css",
    selector: "table tbody tr a.tbl-link, table tbody tr a, table tbody tr button, table tbody tr [role='button']",
    description: "File Uploads document row click targets",
  },
  {
    strategy: "css",
    selector: "a:has-text('root/Referral'), a:has-text('Referral'), [role='button']:has-text('Referral'), [role='treeitem']:has-text('Referral')",
    description: "File Uploads referral click targets outside table rows",
  },
  {
    strategy: "css",
    selector: "a:has-text('Admission'), button:has-text('Admission'), [role='button']:has-text('Admission')",
    description: "Admission-related click targets",
  },
];
const REFERRAL_FOLDER_SELECTORS: PortalSelectorCandidate[] = [
  {
    strategy: "css",
    selector: ".cdk-drag.example-box.folder-item:has(.folder-label), .folder-item:has(.folder-label)",
    description: "File Uploads Referral folder row by .folder-item",
  },
  {
    strategy: "css",
    selector: ".folder-label",
    description: "File Uploads Referral folder label by .folder-label",
  },
  {
    strategy: "css",
    selector: "a:has-text('root/Referral'), button:has-text('root/Referral'), [role='button']:has-text('root/Referral')",
    description: "File Uploads root/Referral folder target",
  },
  {
    strategy: "css",
    selector: "a:has-text('Referral'), button:has-text('Referral'), [role='button']:has-text('Referral')",
    description: "File Uploads Referral folder target",
  },
  {
    strategy: "text",
    value: /root\s*\/\s*referral/i,
    description: "File Uploads root/Referral folder text marker",
  },
  {
    strategy: "text",
    value: /^Referral$/i,
    description: "File Uploads Referral folder exact label",
  },
];
const SOC_DOC_UPLOADS_TRIGGER_SELECTORS: PortalSelectorCandidate[] = [
  {
    strategy: "css",
    selector: "button:has-text('Doc Uploads'), a:has-text('Doc Uploads'), [role='button']:has-text('Doc Uploads')",
    description: "SOC document header Doc Uploads trigger",
  },
  {
    strategy: "text",
    value: /^Doc Uploads$/i,
    description: "SOC document Doc Uploads exact label",
  },
];
const ADMISSION_ORDER_OPEN_MARKERS: PortalSelectorCandidate[] = [
  {
    strategy: "text",
    value: /Admission Order/i,
    description: "Admission Order text marker",
  },
  {
    strategy: "text",
    value: /Reason for Admission|Admitting Diagnosis|Primary Diagnosis/i,
    description: "Admission clinical reason/diagnosis text markers",
  },
  {
    strategy: "css",
    selector: "[class*='admission'][class*='order'], [id*='admission'][id*='order']",
    description: "Admission order wrapper by class/id",
  },
];
const FILE_UPLOADS_VIEWER_MARKERS: PortalSelectorCandidate[] = [
  {
    strategy: "css",
    selector: "pdf-toolbar, pdf-print, #toolbarViewer, #toolbarViewerRight, #printButton",
    description: "embedded PDF viewer toolbar and print controls",
  },
  {
    strategy: "css",
    selector: "ngx-extended-pdf-viewer, .ng2-pdf-viewer-container, .pdfViewer, .textLayer",
    description: "embedded PDF viewer container or text layer",
  },
];

interface ChartDiscoveryCandidate {
  item: DocumentInventoryItem;
  locator: Locator | null;
  selectorUsed: string | null;
  rawLabel: string;
  href: string | null;
  contextText: string;
  openBehaviorGuess: DocumentInventoryItem["openBehavior"];
}

interface RejectedChartDiscoveryCandidate {
  rawLabel: string;
  href: string | null;
  contextText: string;
  selectorUsed: string | null;
  rejectionReason: string;
}

interface OpenCaptureResult {
  openBehavior: DocumentInventoryItem["openBehavior"];
  sourcePath: string | null;
  openedUrl: string | null;
  textEvidence: string[];
}

const INVENTORY_TO_ARTIFACT_TYPE: Partial<Record<DocumentInventoryItem["normalizedType"], ArtifactType>> = {
  OASIS: "OASIS",
  POC: "PLAN_OF_CARE",
  VISIT_NOTE: "VISIT_NOTES",
  ORDER: "PHYSICIAN_ORDERS",
  COMMUNICATION: "COMMUNICATION_NOTES",
  MISSED_VISIT: "MISSED_VISITS",
  SUMMARY_30: "THIRTY_SIXTY_DAY_SUMMARIES",
  SUMMARY_60: "THIRTY_SIXTY_DAY_SUMMARIES",
  DC_SUMMARY: "DISCHARGE_SUMMARY",
  SUPERVISORY: "SUPERVISORY_VISITS",
  INFECTION_REPORT: "INFECTION_AND_FALL_REPORTS",
  FALL_REPORT: "INFECTION_AND_FALL_REPORTS",
};

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function formatPrimaryDiagnosisSelected(document: OasisReadyDiagnosisDocument | null | undefined): string {
  if (!document?.primaryDiagnosis.description) {
    return "none";
  }
  return [
    document.primaryDiagnosis.code,
    document.primaryDiagnosis.description,
  ].filter(Boolean).join(" ");
}

function summarizeCodeConfidence(document: OasisReadyDiagnosisDocument | null | undefined): string {
  if (!document) {
    return "high:0 medium:0 low:0";
  }

  const counts = {
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const diagnosis of [document.primaryDiagnosis, ...document.otherDiagnoses]) {
    if (!diagnosis.description) {
      continue;
    }
    counts[diagnosis.confidence] += 1;
  }

  return `high:${counts.high} medium:${counts.medium} low:${counts.low}`;
}

function splitIntoEvidenceSentences(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
}

function extractAdmissionReasonSnippets(inputText: string): string[] {
  const normalized = normalizeWhitespace(inputText);
  if (!normalized) {
    return [];
  }

  const patterns = [
    /reason for admission[^.]{0,260}/i,
    /admit(?:ted|sion)\s+(?:for|due to)\s+[^.]{0,260}/i,
    /chief complaint[^.]{0,260}/i,
    /primary diagnosis[^.]{0,260}/i,
    /hospitalization[^.]{0,260}/i,
  ];

  const snippets = new Set<string>();
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[0]) {
      snippets.add(normalizeWhitespace(match[0]));
    }
  }

  if (snippets.size === 0) {
    const fallbackSentences = splitIntoEvidenceSentences(normalized)
      .filter((sentence) =>
        /(admission|admit|diagnosis|dx|reason|condition|hospital|home health)/i.test(sentence),
      )
      .slice(0, 8);
    fallbackSentences.forEach((sentence) => snippets.add(sentence));
  }

  return [...snippets].slice(0, 8);
}

function normalizeUploadFileNameForMatch(value: string | null | undefined): string {
  return normalizeWhitespace(value)
    .replace(/[^\x20-\x7E]+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*\.\s*/g, ".")
    .trim();
}

function normalizeUploadFileLabelForDisplay(value: string | null | undefined): string {
  const asciiOnly = normalizeWhitespace(value)
    .replace(/[^\x20-\x7E]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cleaned = asciiOnly
    .replace(/[^\w.\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || normalizeWhitespace(value);
}

function scoreReferralOrAdmissionUploadLabel(value: string | null | undefined): number {
  const normalized = normalizeUploadFileNameForMatch(value);
  if (!normalized) {
    return 0;
  }

  let score = 0;
  if (/\breferral\b/.test(normalized)) {
    score += 130;
  }
  if (/\badmission\b/.test(normalized)) {
    score += 120;
  }
  if (/\badmit\b/.test(normalized)) {
    score += 110;
  }
  if (/\border\b/.test(normalized)) {
    score += 100;
  }
  if (/\bsoc\b/.test(normalized)) {
    score += 70;
  }
  if (/\boasis\b/.test(normalized)) {
    score += 50;
  }
  if (/\bpdf\b/.test(normalized)) {
    score += 20;
  }
  if (/\bjpg\b|\bjpeg\b/.test(normalized)) {
    score += 10;
  }
  return score;
}

function isPatientSpecificFileUploadsUrl(value: string | null | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? "");
  return /\/provider\/[^/]+\/client\/[^/]+\/file-uploads(?:$|[?#/])/i.test(normalized);
}

function isGenericProviderDocumentsUrl(value: string | null | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? "");
  return /\/provider\/[^/]+\/documents(?:$|[?#/])/i.test(normalized) &&
    !/\/client\/[^/]+\//i.test(normalized);
}

function slugify(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function resolvePatientDocumentsDirectory(outputDirectory: string): string {
  const patientId = path.basename(outputDirectory);
  const runDirectory = path.resolve(outputDirectory, "..", "..");
  return path.join(runDirectory, "patients", patientId, "documents");
}

function isLikelyPdfResponse(input: {
  url: string;
  contentType: string;
}): boolean {
  const normalizedUrl = normalizeWhitespace(input.url).toLowerCase();
  const normalizedContentType = normalizeWhitespace(input.contentType).toLowerCase();
  return normalizedContentType.includes("application/pdf") ||
    /\.pdf(?:$|[?#])/i.test(normalizedUrl) ||
    (/pdf/.test(normalizedUrl) && /octet-stream|application\/pdf|binary/.test(normalizedContentType));
}

async function readLocatorLabel(locator: Locator): Promise<string | null> {
  const label = normalizeWhitespace(
    (await locator.getAttribute("aria-label").catch(() => null)) ??
    (await locator.getAttribute("title").catch(() => null)) ??
    (await locator.textContent().catch(() => null)),
  );

  return label.length > 1 ? label.slice(0, 240) : null;
}

async function readOasisAssessmentProcessingSummary(input: {
  page: Page;
  logger?: Logger;
  debugConfig?: PortalDebugConfig;
}): Promise<{
  summary: ReturnType<typeof deriveOasisAssessmentProcessingSummary>;
  stepLogs: AutomationStepLog[];
}> {
  const actionBarResolution = await resolveVisibleLocatorList({
    page: input.page,
    candidates: [
      {
        strategy: "css",
        selector: "app-oasis .btn-toolbar, app-oasis [class*='action-bar'], app-oasis [class*='top-bar'], app-document-note .btn-toolbar, fin-slideover .btn-toolbar, fin-modal .btn-toolbar",
        description: "OASIS assessment action/status bar",
      },
    ],
    step: "oasis_assessment_status_bar",
    logger: input.logger,
    debugConfig: input.debugConfig,
    maxItems: 4,
  });

  const actionBarTexts = (
    await Promise.all(
      actionBarResolution.items.map(async (item) =>
        normalizeWhitespace(await item.locator.textContent().catch(() => null)),
      ),
    )
  ).filter(Boolean);
  const buttonLabels = await summarizeButtons(input.page);
  const topVisibleText = (await dumpTopVisibleText(input.page, 1800))
    .split(/\r?\n+/)
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean);
  const summary = deriveOasisAssessmentProcessingSummary([
    ...actionBarTexts,
    ...buttonLabels,
    ...topVisibleText,
  ]);

  return {
    summary,
    stepLogs: [
      createAutomationStepLog({
        step: "oasis_assessment_status_detected",
        message:
          summary.detectedStatuses.length > 0
            ? `Detected OASIS assessment statuses ${summary.detectedStatuses.join(", ")} with decision ${summary.decision}.`
            : `No explicit OASIS assessment status was detected; defaulting decision to ${summary.decision}.`,
        urlBefore: input.page.url(),
        urlAfter: input.page.url(),
        selectorUsed: actionBarResolution.items[0]?.candidate.description ?? null,
        found: summary.detectedStatuses,
        missing: summary.detectedStatuses.length > 0 ? [] : ["oasis assessment status"],
        evidence: [
          ...summary.matchedSignals,
          `primaryStatus=${summary.primaryStatus}`,
          `decision=${summary.decision}`,
          `processingEligible=${summary.processingEligible}`,
        ],
        safeReadConfirmed: true,
      }),
    ],
  };
}

async function readOuterHtmlSnippet(locator: Locator): Promise<string | null> {
  return normalizeWhitespace(
    await locator.evaluate((el) => (el as any).outerHTML.slice(0, 1000)).catch(() => null),
  ) || null;
}

async function readTooltipTitles(locator: Locator): Promise<string[]> {
  const titles = new Set<string>();
  const titledNodes = locator.locator("[title]");
  const count = Math.min(await titledNodes.count().catch(() => 0), 20);

  for (let index = 0; index < count; index += 1) {
    const title = normalizeWhitespace(await titledNodes.nth(index).getAttribute("title").catch(() => null));
    if (title) {
      titles.add(title);
    }
  }

  return [...titles];
}

async function readCalendarTileTitle(locator: Locator): Promise<string | undefined> {
  const candidates = [
    normalizeWhitespace(await locator.locator("ngb-highlight, ngb-highlight span").first().textContent().catch(() => null)),
    normalizeWhitespace(await locator.locator('[class*="service-rate-label"]').first().textContent().catch(() => null)),
    normalizeWhitespace(await locator.locator('[title*="OASIS" i], [title*="Start of Care" i], [title*="Recert" i], [title*="Discharge" i]').first().textContent().catch(() => null)),
  ].filter(Boolean);

  return candidates[0] || undefined;
}

async function readCalendarTileAttributeSummary(locator: Locator): Promise<string[]> {
  const attributes: string[] = [];
  const attributePairs: Array<[string, string | null]> = [
    ["class", await locator.getAttribute("class").catch(() => null)],
    ["popoverclass", await locator.getAttribute("popoverclass").catch(() => null)],
    ["role", await locator.getAttribute("role").catch(() => null)],
    ["aria-label", await locator.getAttribute("aria-label").catch(() => null)],
    ["data-testid", await locator.getAttribute("data-testid").catch(() => null)],
    ["title", await locator.getAttribute("title").catch(() => null)],
  ];

  for (const [key, value] of attributePairs) {
    const normalized = normalizeWhitespace(value);
    if (normalized) {
      attributes.push(`${key}=${normalized}`);
    }
  }

  return attributes;
}

async function readCalendarTileTitleAttributes(locator: Locator): Promise<string[]> {
  const titles = new Set<string>();
  const candidateLocators = [
    locator,
    locator.locator("[title]"),
    locator.locator("ngb-highlight"),
    locator.locator("span[title], div[title], i[title]"),
  ];

  for (const candidate of candidateLocators) {
    const count = Math.min(await candidate.count().catch(() => 0), 12);
    for (let index = 0; index < count; index += 1) {
      const title = normalizeWhitespace(await candidate.nth(index).getAttribute("title").catch(() => null));
      if (title) {
        titles.add(title);
      }
    }
  }

  return [...titles];
}

function inferSelectorFamily(description: string | undefined): string | undefined {
  const normalized = normalizeWhitespace(description);
  if (!normalized) {
    return undefined;
  }

  if (/card-wrap/i.test(normalized)) {
    return "card-wrap";
  }
  if (/slot-event-card/i.test(normalized)) {
    return "slot-event-card";
  }
  if (/plot-container/i.test(normalized)) {
    return "plot-container";
  }
  if (/client_calendar/i.test(normalized)) {
    return "client_calendar";
  }
  if (/cdk/i.test(normalized)) {
    return "cdk-drag";
  }

  return normalized;
}

async function readTileClassNames(locator: Locator): Promise<string[]> {
  const classValue = normalizeWhitespace(await locator.getAttribute("class").catch(() => null));
  return classValue ? classValue.split(/\s+/).filter(Boolean) : [];
}

function looksLikeWeekday(value: string): boolean {
  return /\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(value);
}

function looksLikeDateLabel(value: string): boolean {
  return /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b\.?\s+\d{1,2}\b/i.test(value) ||
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(value);
}

async function inferCalendarDateLabel(locator: Locator): Promise<string | undefined> {
  const candidates = [
    normalizeWhitespace(await locator.locator('[class*="date"], [class*="day-number"], [class*="cell-date"], [class*="calendar-date"]').first().textContent().catch(() => null)),
    normalizeWhitespace(await locator.locator("time").first().textContent().catch(() => null)),
    normalizeWhitespace(await locator.locator("xpath=ancestor-or-self::*[@data-date][1]").first().getAttribute("data-date").catch(() => null)),
    normalizeWhitespace(await locator.locator("xpath=ancestor-or-self::*[@aria-label][1]").first().getAttribute("aria-label").catch(() => null)),
    normalizeWhitespace(await locator.locator("xpath=ancestor::*[contains(@class, 'day') or contains(@class, 'date')][1]").first().textContent().catch(() => null)),
    normalizeWhitespace(await locator.locator("xpath=ancestor::*[self::th or self::td][1]").first().textContent().catch(() => null)),
  ].filter(Boolean).filter(looksLikeDateLabel);

  return candidates[0] || undefined;
}

async function inferCalendarNormalizedDate(locator: Locator): Promise<string | undefined> {
  const candidates = [
    normalizeWhitespace(await locator.getAttribute("data-date").catch(() => null)),
    normalizeWhitespace(await locator.locator("time").first().getAttribute("datetime").catch(() => null)),
    normalizeWhitespace(await locator.locator("time").first().getAttribute("data-date").catch(() => null)),
    normalizeWhitespace(await locator.locator("xpath=ancestor-or-self::*[@data-date][1]").first().getAttribute("data-date").catch(() => null)),
    normalizeWhitespace(await locator.locator("xpath=ancestor-or-self::*[@datetime][1]").first().getAttribute("datetime").catch(() => null)),
    normalizeWhitespace(await locator.locator("xpath=ancestor-or-self::*[@aria-label][1]").first().getAttribute("aria-label").catch(() => null)),
  ].filter(Boolean);

  return candidates.find((value) => /\b(?:20\d{2}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/.test(value)) || undefined;
}

function inferCalendarTileCategory(rawText: string, titleText: string | undefined, tooltipTitles: string[]): string | undefined {
  const haystack = normalizeWhitespace([titleText ?? "", rawText, ...tooltipTitles].join(" "));
  const categoryMatchers: Array<[RegExp, string]> = [
    [/\bphys\.?\s*order\b/i, "PHYSICIAN_ORDER"],
    [/\bcomm\s*note\b/i, "COMMUNICATION_NOTE"],
    [/\b(?:sn|rn)\s+visit\b/i, "SN_VISIT"],
    [/\bpt\s+visit\b/i, "PT_VISIT"],
    [/\bot\s+visit\b/i, "OT_VISIT"],
    [/\bslp?\s+visit\b/i, "SLP_VISIT"],
    [/\bvisit note\b/i, "VISIT_NOTE"],
    [/\bstart of care\b/i, "START_OF_CARE"],
    [/\btransfer\b/i, "TRANSFER"],
    [/\bdischarge\b/i, "DISCHARGE"],
    [/\brecert(?:ification)?\b/i, "RECERTIFICATION"],
    [/\boasis\b/i, "OASIS"],
  ];

  return categoryMatchers.find(([pattern]) => pattern.test(haystack))?.[1];
}

function inferCalendarTileMarkerClues(tooltipTitles: string[], titleAttributes: string[], rawText: string): string[] {
  const haystack = normalizeWhitespace([rawText, ...tooltipTitles, ...titleAttributes].join(" "));
  const markers: Array<[RegExp, string]> = [
    [/\bvalidated\b/i, "VALIDATED"],
    [/\bexported\b/i, "EXPORTED"],
    [/\blocked\b/i, "LOCKED"],
    [/\bsigned\b/i, "SIGNED"],
    [/\besigned\b/i, "ESIGNED"],
    [/\bmissed\b/i, "MISSED"],
    [/\bclaim billed\b/i, "CLAIM_BILLED"],
    [/\bclaim generated\b/i, "CLAIM_GENERATED"],
    [/\bpayroll paid\b/i, "PAYROLL_PAID"],
    [/\belectronic visit verified\b/i, "EVV"],
    [/\bin progress\b/i, "IN_PROGRESS"],
  ];

  return markers
    .filter(([pattern]) => pattern.test(haystack))
    .map(([, label]) => label);
}

async function inferWeekdayFromCell(locator: Locator, weekdayHeaders: string[], columnIndex: number): Promise<string | undefined> {
  const candidates = [
    weekdayHeaders[columnIndex],
    normalizeWhitespace(await locator.getAttribute("aria-label").catch(() => null)),
    normalizeWhitespace(await locator.locator('[class*="weekday"], [class*="day-header"], [data-weekday]').first().textContent().catch(() => null)),
  ].filter(Boolean);

  return candidates.find((entry) => looksLikeWeekday(entry)) || undefined;
}

async function resolveWeekdayHeaders(page: Page): Promise<string[]> {
  const resolution = await resolveVisibleLocatorList({
    page,
    candidates: chartCalendarSelectors.weekdayHeaderSelectors,
    step: "oasis_calendar_weekday_headers",
    logger: undefined,
    debugConfig: undefined,
    maxItems: 7,
  });

  const headers = (
    await Promise.all(
      resolution.items.map(async (item) => normalizeWhitespace(await item.locator.textContent().catch(() => null))),
    )
  ).filter((entry): entry is string => Boolean(entry && looksLikeWeekday(entry)));

  return headers.slice(0, 7);
}

async function inferWeekLabel(rowLocator: Locator, rowIndex: number): Promise<string> {
  const rowText = normalizeWhitespace(await rowLocator.textContent().catch(() => null));
  const explicitWeek = rowText.match(/\bWeek\s*\d+\b/i)?.[0];
  return explicitWeek ? normalizeWhitespace(explicitWeek) : `Week ${rowIndex + 1}`;
}

async function resolveTileLocatorsForCell(cellLocator: Locator): Promise<Array<{
  locator: Locator;
  selectorUsed: string;
}>> {
  const items: Array<{
    locator: Locator;
    selectorUsed: string;
  }> = [];

  for (const candidate of chartCalendarSelectors.tileSelectors) {
    if (candidate.strategy !== "css") {
      continue;
    }

    const locator = cellLocator.locator(candidate.selector);
    const count = Math.min(await locator.count().catch(() => 0), 20);
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      if (await item.isVisible().catch(() => false)) {
        items.push({
          locator: item,
          selectorUsed: candidate.description,
        });
      }
    }

    if (items.length > 0) {
      return items;
    }
  }

  return items;
}

async function resolveClickableTarget(locator: Locator): Promise<Locator> {
  const candidates = [
    locator,
    locator.locator("xpath=ancestor-or-self::*[self::a or self::button or @role='button' or @role='link' or @tabindex='0'][1]").first(),
    locator.locator("xpath=ancestor::*[self::a or self::button or @role='button' or @role='link' or @tabindex='0'][1]").first(),
  ];

  for (const candidate of candidates) {
    if (await candidate.count().catch(() => 0) > 0) {
      return candidate;
    }
  }

  return locator;
}

async function clickReadOnlyTarget(input: {
  locator: Locator;
  page: Page;
  debugConfig?: PortalDebugConfig;
}): Promise<void> {
  await clickPortalTarget(input);
}

async function clickPortalTarget(input: {
  locator: Locator;
  page: Page;
  debugConfig?: PortalDebugConfig;
}): Promise<void> {
  const target = await resolveClickableTarget(input.locator);
  await target.scrollIntoViewIfNeeded().catch(() => undefined);
  await target.click().catch(async () => {
    await target.click({ force: true }).catch(async () => {
      await target.focus().catch(() => undefined);
      await input.page.keyboard.press("Enter").catch(() => undefined);
    });
  });
  await waitForPortalPageSettled(input.page, input.debugConfig);
}

interface OasisPrintModalCheckboxEntry {
  checkboxIndex: number;
  label: string;
  checked: boolean;
}

async function resolveVisibleModalLocator(page: Page): Promise<{
  locator: Locator | null;
  selectorUsed: string | null;
}> {
  const selectors = [
    "ngb-modal-window[role='dialog']",
    "ngb-modal-window",
    ".modal.show .modal-dialog",
    ".modal-dialog",
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).last();
    if (await locator.count().catch(() => 0) > 0 && await locator.isVisible().catch(() => false)) {
      return {
        locator,
        selectorUsed: selector,
      };
    }
  }

  return {
    locator: null,
    selectorUsed: null,
  };
}

async function readOasisPrintModalCheckboxEntries(modal: Locator): Promise<OasisPrintModalCheckboxEntry[]> {
  return modal.evaluate((element) => {
    const listGroup =
      element.querySelector(".modal-body .list-group") ??
      element.querySelector(".list-group");
    if (!listGroup) {
      return [];
    }

    const children = Array.from(listGroup.children);
    const entries: Array<{ checkboxIndex: number; label: string; checked: boolean }> = [];
    let checkboxIndex = 0;

    for (const child of children) {
      const candidate = child as any;
      if (candidate.tagName?.toLowerCase() !== "li") {
        continue;
      }
      const checkbox = candidate.querySelector("input[type='checkbox']") as any;
      if (checkbox) {
        const labelFromTextNode = Array.from(candidate.childNodes)
          .filter((node: any) => node?.nodeType === 3)
          .map((node: any) => node?.textContent ?? "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        const label = labelFromTextNode || ((candidate.textContent?.replace(/\s+/g, " ").trim()) ?? "");
        entries.push({
          checkboxIndex,
          label,
          checked: checkbox.checked === true,
        });
        checkboxIndex += 1;
      }
    }

    return entries;
  });
}

async function applyOasisPrintSectionProfile(input: {
  modal: Locator;
  page: Page;
  profile: OasisPrintSectionProfile;
  debugConfig?: PortalDebugConfig;
}): Promise<{
  selectedSectionLabels: string[];
  warnings: string[];
}> {
  let entries = await readOasisPrintModalCheckboxEntries(input.modal);
  const checkboxLocator = input.modal.locator(".list-group input[type='checkbox']");
  const selectedSectionLabels = findMatchingOasisPrintSectionLabels({
    profile: input.profile,
    labels: entries.map((entry) => entry.label),
  });
  const warnings: string[] = [];

  if (entries.length === 0) {
    warnings.push("OASIS print modal opened without recognizable checkbox entries.");
    return {
      selectedSectionLabels: [],
      warnings,
    };
  }

  if (selectedSectionLabels.length === 0) {
    warnings.push(`No OASIS print modal sections matched profile '${input.profile.key}'.`);
  }

  const selectAllToggle = input.modal.locator("#printAll, input[type='checkbox'][name='printAll']").first();
  const selectAllVisible = await selectAllToggle.count().catch(() => 0) > 0
    && await selectAllToggle.isVisible().catch(() => false);
  if (selectAllVisible) {
    const selectAllChecked = await selectAllToggle.isChecked().catch(() => false);
    const shouldResetSelections = selectAllChecked && selectedSectionLabels.length < entries.length;
    if (shouldResetSelections) {
      await clickReadOnlyTarget({
        locator: selectAllToggle,
        page: input.page,
        debugConfig: input.debugConfig,
      }).catch(() => undefined);
      await input.page.waitForTimeout(150).catch(() => undefined);
      entries = await readOasisPrintModalCheckboxEntries(input.modal);
    }
  }

  for (const entry of entries) {
    if (!entry.label) {
      continue;
    }
    const shouldBeChecked = selectedSectionLabels.includes(entry.label);
    if (entry.checked === shouldBeChecked) {
      continue;
    }
    await clickReadOnlyTarget({
      locator: checkboxLocator.nth(entry.checkboxIndex),
      page: input.page,
      debugConfig: input.debugConfig,
    }).catch(() => undefined);
  }

  return {
    selectedSectionLabels,
    warnings,
  };
}

async function summarizeClickTarget(locator: Locator): Promise<string> {
  const id = normalizeWhitespace(await locator.getAttribute("id").catch(() => null));
  const role = normalizeWhitespace(await locator.getAttribute("role").catch(() => null));
  const classValue = normalizeWhitespace(await locator.getAttribute("class").catch(() => null));
  const label = await readLocatorLabel(locator);
  return [
    id ? `id=${id}` : "",
    role ? `role=${role}` : "",
    classValue ? `class=${classValue}` : "",
    label ? `label=${label}` : "",
  ].filter(Boolean).join(" | ") || "unlabeled clickable target";
}

function resolveOasisPrintCaptureTimeoutMs(debugConfig?: PortalDebugConfig): number {
  return Math.max(debugConfig?.stepTimeoutMs ?? 8_000, MIN_OASIS_PRINT_CAPTURE_TIMEOUT_MS);
}

function normalizeDiagnosisMatchText(value: string | null | undefined): string {
  return normalizeWhitespace(value)
    .toUpperCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDiagnosisMatchCode(value: string | null | undefined): string {
  return normalizeWhitespace(value)
    .toUpperCase()
    .replace(/[^A-Z0-9.]/g, "")
    .trim();
}

function targetSlotToRowIndex(targetSlot: string): number | null {
  if (targetSlot === "primary") {
    return 0;
  }
  const parsed = Number.parseInt(targetSlot, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
}

function diagnosisRowMatchesAction(
  row: OasisDiagnosisPageSnapshot["rows"][number] | null | undefined,
  action: Extract<OasisInputAction, { type: "fill_diagnosis" }>,
): boolean {
  if (!row) {
    return false;
  }
  const expectedDescription = normalizeDiagnosisMatchText(action.description);
  const actualDescription = normalizeDiagnosisMatchText(row.description ?? row.rawText);
  if (!expectedDescription || expectedDescription !== actualDescription) {
    return false;
  }
  const expectedCode = normalizeDiagnosisMatchCode(action.code);
  const actualCode = normalizeDiagnosisMatchCode(row.icd10Code);
  return expectedCode === actualCode;
}

function findMatchingDiagnosisRowIndex(
  snapshot: OasisDiagnosisPageSnapshot | null,
  action: Extract<OasisInputAction, { type: "fill_diagnosis" }>,
): number {
  if (!snapshot) {
    return -1;
  }
  return snapshot.rows.findIndex((row) => diagnosisRowMatchesAction(row, action));
}

async function resolveOasisDiagnosisRootLocator(input: {
  page: Page;
  logger?: Logger;
  debugConfig?: PortalDebugConfig;
}): Promise<Locator | null> {
  const resolution = await resolveFirstVisibleLocator({
    page: input.page,
    candidates: oasisDiagnosisSelectors.rootContainers,
    step: "oasis_diagnosis_execution_root",
    logger: input.logger,
    debugConfig: input.debugConfig,
    settle: () => waitForPortalPageSettled(input.page, input.debugConfig),
  });
  return resolution.locator ?? null;
}

async function resolveDiagnosisRowLocators(root: Locator): Promise<Locator[]> {
  const directRows = root.locator(oasisDiagnosisSelectors.diagnosisRowSelector);
  const directCount = await directRows.count().catch(() => 0);
  if (directCount > 0) {
    return filterActionableDiagnosisRowLocators(
      Array.from({ length: directCount }, (_, index) => directRows.nth(index)),
    );
  }

  const anchors = root.locator(oasisDiagnosisSelectors.diagnosisRowFallbackFieldAnchors);
  const anchorCount = await anchors.count().catch(() => 0);
  const rows: Locator[] = [];
  for (let index = 0; index < anchorCount; index += 1) {
    const anchor = anchors.nth(index);
    const candidates = [
      anchor.locator("xpath=ancestor::*[@formgroupname][1]").first(),
      anchor.locator("xpath=ancestor::tr[1]").first(),
      anchor.locator("xpath=ancestor::*[contains(@class,'row')][1]").first(),
    ];
    for (const candidate of candidates) {
      if (await candidate.count().catch(() => 0) > 0) {
        rows.push(candidate);
        break;
      }
    }
  }
  return filterActionableDiagnosisRowLocators(rows);
}

async function inspectDiagnosisRowLocator(row: Locator): Promise<OasisDiagnosisRowCandidate | null> {
  if (await row.count().catch(() => 0) === 0) {
    return null;
  }

  return row.evaluate((rowElement, selectors) => {
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
        const byFor = rowElement.querySelector(`label[for="${input.id}"]`);
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
      return normalize(input.parentElement?.textContent);
    };
    const readField = (candidateSelectors: string[]) => {
      for (const selector of candidateSelectors) {
        const field = rowElement.querySelector(selector);
        if (!field) {
          continue;
        }
        const disabled = typeof field.disabled === "boolean"
          ? field.disabled
          : field.hasAttribute("disabled");
        const readOnly = typeof field.readOnly === "boolean"
          ? field.readOnly
          : field.hasAttribute("readonly");
        return {
          value: readValue(field),
          found: true,
          disabled,
          readOnly,
        };
      }
      return {
        value: "",
        found: false,
        disabled: null,
        readOnly: null,
      };
    };

    const rowText = normalize(rowElement.textContent);
    const upperRowText = rowText.toUpperCase();
    const sectionLabel = /PRIMARY DIAGNOSIS/.test(upperRowText)
      ? "PRIMARY DIAGNOSIS"
      : /OTHER DIAGNOSIS/.test(upperRowText)
        ? "OTHER DIAGNOSIS"
        : null;
    const icd = readField([...selectors.icdCodeField]);
    const onset = readField([...selectors.onsetDateField]);
    const description = readField([...selectors.descriptionField]);
    const severityControls = Array.from(
      rowElement.querySelectorAll(selectors.severityRadioField.join(", ")),
    ) as any[];
    const timingControls = Array.from(
      rowElement.querySelectorAll(selectors.timingRadioField.join(", ")),
    ) as any[];
    const checkedSeverityRadio = rowElement.querySelector(
      "input[type='radio'][name*='severity' i]:checked, input[type='radio'][formcontrolname*='severity' i]:checked, input[type='radio'][id*='severity' i]:checked",
    ) as any;
    const severity = normalize(
      readLabelForInput(checkedSeverityRadio) ||
      checkedSeverityRadio?.value ||
      rowElement.querySelector("[aria-checked='true'][class*='severity' i]")?.textContent,
    );
    const timingFlags = new Set<string>();
    const checkedRadios = Array.from(rowElement.querySelectorAll("input[type='radio']:checked")) as any[];
    for (const radio of checkedRadios) {
      const label = readLabelForInput(radio);
      if (/onset|exacerbate/i.test(label)) {
        timingFlags.add(label);
      }
    }

    const selectorEvidence: OasisDiagnosisRowFieldSignal[] = [
      {
        field: "icd10Code",
        found: icd.found,
        disabled: icd.disabled,
        readOnly: icd.readOnly,
      },
      {
        field: "onsetDate",
        found: onset.found,
        disabled: onset.disabled,
        readOnly: onset.readOnly,
      },
      {
        field: "description",
        found: description.found,
        disabled: description.disabled,
        readOnly: description.readOnly,
      },
      {
        field: "severity",
        found: severityControls.length > 0,
        disabled: severityControls.length > 0
          ? severityControls.every((control) => control.disabled || control.hasAttribute("disabled"))
          : null,
        readOnly: null,
      },
      {
        field: "timingFlags",
        found: timingControls.length > 0,
        disabled: timingControls.length > 0
          ? timingControls.every((control) => control.disabled || control.hasAttribute("disabled"))
          : null,
        readOnly: null,
      },
    ];

    return {
      sectionLabel,
      icd10Code: icd.value || null,
      onsetDate: onset.value || null,
      description: description.value || null,
      severity: severity || null,
      timingFlags: Array.from(timingFlags),
      rawText: rowText.slice(0, 1200),
      selectorEvidence,
    };
  }, {
    icdCodeField: [...oasisDiagnosisSelectors.icdCodeField],
    onsetDateField: [...oasisDiagnosisSelectors.onsetDateField],
    descriptionField: [...oasisDiagnosisSelectors.descriptionField],
    severityRadioField: [...oasisDiagnosisSelectors.severityRadioField],
    timingRadioField: [...oasisDiagnosisSelectors.timingRadioField],
  });
}

async function filterActionableDiagnosisRowLocators(rows: Locator[]): Promise<Locator[]> {
  const filtered: Locator[] = [];
  for (const row of rows) {
    const candidate = await inspectDiagnosisRowLocator(row);
    if (candidate && isOasisDiagnosisRowActionable(candidate)) {
      filtered.push(row);
    }
  }
  return filtered;
}

function buildDiagnosisRowEvidence(
  row: OasisDiagnosisPageSnapshot["rows"][number] | null | undefined,
): string[] {
  if (!row) {
    return ["row:none"];
  }

  return [
    `rowIndex:${row.rowIndex}`,
    `sectionLabel:${row.sectionLabel ?? "none"}`,
    `code:${row.icd10Code ?? "none"}`,
    `description:${row.description ?? "none"}`,
    `severity:${row.severity ?? "none"}`,
    `timingFlags:${row.timingFlags.join(" | ") || "none"}`,
    `rawText:${row.rawText || "none"}`,
  ];
}

function toDiagnosisRowCandidate(
  row: OasisDiagnosisPageSnapshot["rows"][number],
): OasisDiagnosisRowCandidate {
  return {
    sectionLabel: row.sectionLabel,
    icd10Code: row.icd10Code,
    onsetDate: row.onsetDate,
    description: row.description,
    severity: row.severity,
    timingFlags: row.timingFlags,
    rawText: row.rawText,
    selectorEvidence: row.selectorEvidence as OasisDiagnosisRowFieldSignal[],
  };
}

async function resolveFirstFieldLocator(
  row: Locator,
  selectors: readonly string[],
): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = row.locator(selector).first();
    if (await locator.count().catch(() => 0) > 0) {
      return locator;
    }
  }
  return null;
}

async function isLocatorEditable(locator: Locator | null): Promise<boolean> {
  if (!locator) {
    return false;
  }
  if (await locator.count().catch(() => 0) === 0) {
    return false;
  }
  const disabled = await locator.isDisabled().catch(() => false);
  const readOnly = await locator.evaluate((element) =>
    (element as any).readOnly === true || (element as any).hasAttribute?.("readonly") === true).catch(() => false);
  return !disabled && !readOnly;
}

async function fillEditableField(locator: Locator, value: string): Promise<void> {
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  await locator.click({ clickCount: 3 }).catch(() => undefined);
  await locator.fill(value);
  await locator.dispatchEvent("change").catch(() => undefined);
  await locator.press("Tab").catch(() => undefined);
}

async function clickRadioChoiceWithinRow(input: {
  row: Locator;
  kind: "severity" | "timing";
  target: string;
}): Promise<boolean> {
  return input.row.evaluate((rowElement, params) => {
    const normalize = (value: string | null | undefined): string =>
      (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const matchesSeverity = (value: string): boolean => {
      const targetDigit = params.target.trim();
      return new RegExp(`(^|\\D)${targetDigit}(\\D|$)`).test(value);
    };
    const matchesTiming = (value: string): boolean => value.includes(params.target.trim().toLowerCase());
    const matches = (value: string): boolean =>
      params.kind === "severity" ? matchesSeverity(value) : matchesTiming(value);
    const clickInput = (input: any): boolean => {
      if (!input || typeof input.click !== "function") {
        return false;
      }
      input.click();
      return true;
    };
    const readLabel = (input: any): string => {
      const byFor = input.id ? rowElement.querySelector(`label[for="${input.id}"]`) : null;
      const closestLabel = input.closest("label");
      return normalize(
        byFor?.textContent ??
        closestLabel?.textContent ??
        input.parentElement?.textContent ??
        input.getAttribute("aria-label") ??
        input.value,
      );
    };

    const radios = Array.from(rowElement.querySelectorAll("input[type='radio']")) as any[];
    for (const radio of radios) {
      const candidateText = normalize(
        [readLabel(radio), radio.value, radio.id, radio.name, radio.getAttribute("aria-label")]
          .filter(Boolean)
          .join(" "),
      );
      if (candidateText && matches(candidateText) && clickInput(radio)) {
        return true;
      }
    }

    const clickables = Array.from(
      rowElement.querySelectorAll("label, button, [role='button'], span, div"),
    ) as any[];
    for (const candidate of clickables) {
      const candidateText = normalize(candidate.textContent);
      if (!candidateText || !matches(candidateText)) {
        continue;
      }
      const nestedRadio = candidate.querySelector("input[type='radio']");
      if (nestedRadio && clickInput(nestedRadio)) {
        return true;
      }
      if (typeof candidate.click === "function") {
        candidate.click();
        return true;
      }
    }

    return false;
  }, input);
}

function toArtifactRecords(
  inventory: DocumentInventoryItem[],
  outputDirectory: string,
): ArtifactRecord[] {
  return artifactTypes.map((artifactType) => {
    const matches = inventory.filter((item) => INVENTORY_TO_ARTIFACT_TYPE[item.normalizedType] === artifactType);
    const topMatch = matches.sort((left, right) => right.confidence - left.confidence)[0] ?? null;

    return {
      artifactType,
      status: topMatch ? (topMatch.sourcePath ? "DOWNLOADED" : "FOUND") : "MISSING",
      portalLabel: topMatch?.sourceLabel ?? null,
      locatorUsed: topMatch ? topMatch.evidence[0] ?? topMatch.sourceUrl ?? null : null,
      discoveredAt: new Date().toISOString(),
      downloadPath: topMatch?.sourcePath ?? null,
      extractedFields: {
        topLabel: topMatch?.sourceLabel ?? null,
        confidence: topMatch ? String(topMatch.confidence) : null,
        openBehavior: topMatch?.openBehavior ?? null,
        sourceUrl: topMatch?.sourceUrl ?? null,
        sourcePath: topMatch?.sourcePath ?? null,
        artifactDirectory: path.resolve(outputDirectory),
        evidence: topMatch?.evidence.join(" | ") ?? null,
      },
      notes: topMatch ? [] : ["Artifact inventory did not produce a matching document candidate."],
    };
  });
}

export class PatientChartPage {
  private readonly safety: PortalSafetyConfig;

  constructor(
    private readonly page: Page,
    private readonly options: {
      logger?: Logger;
      debugConfig?: PortalDebugConfig;
      debugDir?: string;
      safety?: PortalSafetyConfig;
    } = {},
  ) {
    this.safety = resolvePortalSafetyConfig(this.options.safety);
  }

  async readPatientAdmissionStatus(): Promise<{
    statusLabel: string | null;
    stepLogs: AutomationStepLog[];
  }> {
    await waitForPortalPageSettled(this.page, this.options.debugConfig);

    const statusResolution = await resolveFirstVisibleLocator({
      page: this.page,
      candidates: selectorRegistry.patientChartStatus.admissionStatusBadge,
      step: "patient_admission_status_badge",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      settle: async () => waitForPortalPageSettled(this.page, this.options.debugConfig, 200),
    });

    const statusLabel = statusResolution.locator
      ? normalizeWhitespace(
          (await statusResolution.locator.getAttribute("aria-label").catch(() => null)) ??
          (await statusResolution.locator.getAttribute("title").catch(() => null)) ??
          (await statusResolution.locator.textContent().catch(() => null)),
        )
      : null;

    return {
      statusLabel: statusLabel || null,
      stepLogs: [
        createAutomationStepLog({
          step: "patient_admission_status",
          message: statusLabel
            ? `Captured patient admission status from chart header: ${statusLabel}.`
            : "Patient admission status badge was not detected in the chart header.",
          urlBefore: this.page.url(),
          urlAfter: this.page.url(),
          selectorUsed: statusResolution.matchedCandidate?.description ?? null,
          found: statusLabel ? [statusLabel] : [],
          missing: statusLabel ? [] : ["patient admission status badge"],
          evidence: statusResolution.attempts.map(selectorAttemptToEvidence),
          safeReadConfirmed: true,
        }),
      ],
    };
  }

  async discoverArtifacts(
    outputDirectory: string,
    options: {
      workflowPhase?: "full_discovery" | "file_uploads_only" | "oasis_diagnosis_only";
      patientChartUrl?: string | null;
      oasisReadyDiagnosis?: OasisReadyDiagnosisDocument | null;
      oasisReadyDiagnosisPath?: string | null;
    } = {},
  ): Promise<{
    artifacts: ArtifactRecord[];
    documentInventory: DocumentInventoryItem[];
    stepLogs: AutomationStepLog[];
    oasisLockState?: OasisLockStateSnapshot | null;
    diagnosisPageSnapshot?: OasisDiagnosisPageSnapshot | null;
    calendarScope?: OasisCalendarScopeResult | null;
    calendarScopePath?: string | null;
  }> {
    await mkdir(outputDirectory, { recursive: true });
    await waitForPortalPageSettled(this.page, this.options.debugConfig);
    const workflowPhase = options.workflowPhase ?? "full_discovery";
    const urlBefore = options.patientChartUrl ?? this.page.url();
    const stepLogs: AutomationStepLog[] = [];
    const primaryDiagnosisSelected = formatPrimaryDiagnosisSelected(options.oasisReadyDiagnosis);
    const otherDiagnosisCount = options.oasisReadyDiagnosis?.otherDiagnoses.length ?? 0;
    const codeConfidenceSummary = summarizeCodeConfidence(options.oasisReadyDiagnosis);
    const dangerousControls = await detectDangerousControls(this.page);
    this.options.logger?.info(
      {
        chartUrl: urlBefore,
        currentUrl: this.page.url(),
        workflowPhase,
        primaryDiagnosisSelected,
        otherDiagnosisCount,
        codeConfidenceSummary,
        oasisReadyDiagnosisPath: options.oasisReadyDiagnosisPath ?? null,
        dangerousControlsDetected: dangerousControls.map((entry) => entry.label),
      },
      workflowPhase === "file_uploads_only"
        ? "entering File Uploads referral extraction workflow"
        : "entering active OASIS workflow",
    );
    if (options.oasisReadyDiagnosis) {
      stepLogs.push(createAutomationStepLog({
        step: "oasis_ready_diagnosis_prep",
        message: "Loaded structured OASIS-ready diagnoses for the read-only SOC interaction stage; live writes remain disabled.",
        urlBefore: urlBefore,
        urlAfter: this.page.url(),
        found: [
          `primaryDiagnosisSelected:${primaryDiagnosisSelected}`,
          `otherDiagnosisCount:${otherDiagnosisCount}`,
          `codeConfidenceSummary:${codeConfidenceSummary}`,
        ],
        evidence: [
          `oasisReadyDiagnosisPath:${options.oasisReadyDiagnosisPath ?? "in-memory-only"}`,
          `primaryDiagnosisCode:${options.oasisReadyDiagnosis.primaryDiagnosis.code || "none"}`,
          `suggestedOnsetType:${options.oasisReadyDiagnosis.suggestedOnsetType}`,
          `suggestedSeverity:${options.oasisReadyDiagnosis.suggestedSeverity}`,
          "liveWritesDisabled:true",
        ],
        safeReadConfirmed: true,
      }));
    }
    const shouldRunFileUploads = workflowPhase !== "oasis_diagnosis_only";
    const shouldRunOasisDiagnosis = workflowPhase !== "file_uploads_only";
    const fileUploadsResult = shouldRunFileUploads
      ? await this.openFileUploadsAndAdmissionOrderFromSidebar({
          chartUrl: urlBefore,
          outputDirectory,
          socSelectorUsed: null,
          matchedSocAnchorText: null,
          includeOasisSignals: false,
        })
      : {
          fileUploadsAccessible: false,
          fileUploadsUrl: null,
          visibleUploadedDocuments: [] as string[],
          admissionOrderAccessible: false,
          admissionOrderTitle: null,
          admissionReasonSnippets: [] as string[],
          admissionReasonPrimary: null,
          possibleIcd10Codes: [] as string[],
          rawExtractedTextSource: null,
          domExtractionRejectedReasons: [] as string[],
          admissionOrderTextExcerpt: null,
          sourcePdfPath: null,
          printedPdfPath: null,
          sourceMetaPath: null,
          extractedTextPath: null,
          extractionResultPath: null,
          fileUploadsSelectorUsed: null,
          admissionOrderSelectorUsed: null,
          stepLogs: [] as AutomationStepLog[],
        };
    stepLogs.push(...fileUploadsResult.stepLogs);
    if (shouldRunOasisDiagnosis) {
      const chartRouteRestoreLog = await this.restorePatientChartRouteIfNeeded({
        expectedChartUrl: urlBefore,
        reason: workflowPhase === "oasis_diagnosis_only"
          ? "restore_patient_chart_for_post_coding_oasis_verification"
          : "restore_patient_chart_before_oasis_sidebar",
      });
      if (chartRouteRestoreLog) {
        stepLogs.push(chartRouteRestoreLog);
      }
    }
    const oasisDocumentsPage = shouldRunOasisDiagnosis
      ? await this.openOasisDocumentsPageFromSidebar()
      : {
          opened: false,
          oasisMenuClicked: false,
          oasisDocumentListDetected: false,
          socDocumentFound: false,
          socDocumentClicked: false,
          oasisSelectorUsed: null,
          socSelectorUsed: null,
          matchedSocRowText: null,
          matchedSocAnchorText: null,
          stepLogs: [] as AutomationStepLog[],
        };
    stepLogs.push(...oasisDocumentsPage.stepLogs);
    const socDocumentResult = shouldRunOasisDiagnosis && oasisDocumentsPage.oasisDocumentListDetected
      ? await this.openSocDocumentFromOasisTable({
          chartUrl: urlBefore,
          oasisSelectorUsed: oasisDocumentsPage.oasisSelectorUsed,
        })
      : {
          opened: false,
          socDocumentFound: false,
          socDocumentClicked: false,
          socSelectorUsed: null,
          matchedSocRowText: null,
          matchedSocAnchorText: null,
          stepLogs: [] as AutomationStepLog[],
        };
    stepLogs.push(...socDocumentResult.stepLogs);
    const initialOasisLockState = shouldRunOasisDiagnosis && socDocumentResult.socDocumentClicked
      ? await this.detectOasisSocLockState({
          chartUrl: urlBefore,
          socSelectorUsed: socDocumentResult.socSelectorUsed,
          matchedSocAnchorText: socDocumentResult.matchedSocAnchorText,
        })
      : {
          lockState: null as OasisLockStateSnapshot | null,
          stepLogs: [] as AutomationStepLog[],
        };
    stepLogs.push(...initialOasisLockState.stepLogs);
    const diagnosisNavigationResult = shouldRunOasisDiagnosis && socDocumentResult.socDocumentClicked
      ? await this.openActiveDiagnosesSectionFromSocForm({
          chartUrl: urlBefore,
          socSelectorUsed: socDocumentResult.socSelectorUsed,
          matchedSocAnchorText: socDocumentResult.matchedSocAnchorText,
          lockState: initialOasisLockState.lockState,
        })
      : {
          diagnosisSectionOpened: false,
          diagnosisListFound: false,
          diagnosisNavigationMethod: null as string | null,
          diagnosisListSamples: [] as string[],
          diagnosisPageSnapshot: null as OasisDiagnosisPageSnapshot | null,
          lockState: initialOasisLockState.lockState,
          stepLogs: [] as AutomationStepLog[],
        };
    stepLogs.push(...diagnosisNavigationResult.stepLogs);
    const oasisLockState = diagnosisNavigationResult.lockState ?? initialOasisLockState.lockState ?? null;

    const discoveredAt = new Date().toISOString();
    const workflowEvidence = [
      `Workflow phase: ${workflowPhase}`,
      `oasisReadyDiagnosisPath:${options.oasisReadyDiagnosisPath ?? "none"}`,
      `primaryDiagnosisSelected:${primaryDiagnosisSelected}`,
      `otherDiagnosisCount:${otherDiagnosisCount}`,
      `codeConfidenceSummary:${codeConfidenceSummary}`,
      `oasisLockState:${oasisLockState?.oasisLockState ?? "none"}`,
      `unlockControlVisible:${oasisLockState?.unlockControlVisible ?? false}`,
      `unlockControlText:${oasisLockState?.unlockControlText ?? "none"}`,
      `fieldsEditable:${oasisLockState?.fieldsEditable ?? false}`,
      `verificationOnly:${oasisLockState?.verificationOnly ?? true}`,
      `inputEligible:${oasisLockState?.inputEligible ?? false}`,
      "Active OASIS workflow path: chart -> File Uploads/referral -> OASIS sidebar -> OASIS document table -> SOC document -> Active Diagnoses",
      `Dangerous controls detected: ${dangerousControls.map((entry) => entry.label).join(" | ") || "none"}`,
      `oasisMenuClicked:${oasisDocumentsPage.oasisMenuClicked}`,
      `oasisDocumentListDetected:${oasisDocumentsPage.oasisDocumentListDetected}`,
      `socDocumentFound:${socDocumentResult.socDocumentFound}`,
      `socDocumentClicked:${socDocumentResult.socDocumentClicked}`,
      `matchedSocRowText:${socDocumentResult.matchedSocRowText ?? "none"}`,
      `matchedSocAnchorText:${socDocumentResult.matchedSocAnchorText ?? "none"}`,
      `diagnosisSectionOpened:${diagnosisNavigationResult.diagnosisSectionOpened}`,
      `diagnosisListFound:${diagnosisNavigationResult.diagnosisListFound}`,
      `diagnosisNavigationMethod:${diagnosisNavigationResult.diagnosisNavigationMethod ?? "none"}`,
      `diagnosisListSamples:${diagnosisNavigationResult.diagnosisListSamples.join(" | ") || "none"}`,
      `diagnosisSnapshotRowCount:${diagnosisNavigationResult.diagnosisPageSnapshot?.rows.length ?? 0}`,
      `fileUploadsAccessible:${fileUploadsResult.fileUploadsAccessible}`,
      `fileUploadsUrl:${fileUploadsResult.fileUploadsUrl ?? "none"}`,
      `visibleUploadedDocuments:${fileUploadsResult.visibleUploadedDocuments.join(" | ") || "none"}`,
      `admissionOrderAccessible:${fileUploadsResult.admissionOrderAccessible}`,
      `admissionOrderTitle:${fileUploadsResult.admissionOrderTitle ?? "none"}`,
      `admissionReasonPrimary:${fileUploadsResult.admissionReasonPrimary ?? "none"}`,
      `admissionReasonSnippets:${fileUploadsResult.admissionReasonSnippets.join(" | ") || "none"}`,
      `rawExtractedTextSource:${fileUploadsResult.rawExtractedTextSource ?? "none"}`,
      `domExtractionRejectedReasons:${fileUploadsResult.domExtractionRejectedReasons.join(" | ") || "none"}`,
      `possibleIcd10Codes:${fileUploadsResult.possibleIcd10Codes.join(" | ") || "none"}`,
    ];
    const documentInventory: DocumentInventoryItem[] = [];
    if (fileUploadsResult.admissionOrderAccessible && fileUploadsResult.admissionOrderTitle) {
      documentInventory.push({
        sourceLabel: normalizeUploadFileLabelForDisplay(fileUploadsResult.admissionOrderTitle),
        normalizedType: "ORDER",
        discipline: "UNKNOWN",
        confidence: 0.92,
        evidence: [
          ...workflowEvidence,
          `sourceMetaPath:${fileUploadsResult.sourceMetaPath ?? "none"}`,
          `sourcePdfPath:${fileUploadsResult.sourcePdfPath ?? "none"}`,
          `extractedTextPath:${fileUploadsResult.extractedTextPath ?? "none"}`,
          `printedPdfPath:${fileUploadsResult.printedPdfPath ?? "none"}`,
        ],
        sourceUrl: fileUploadsResult.fileUploadsUrl ?? this.page.url(),
        sourcePath: fileUploadsResult.sourcePdfPath ??
          fileUploadsResult.printedPdfPath ??
          fileUploadsResult.extractedTextPath ??
          null,
        discoveredAt,
        openBehavior: "SAME_PAGE",
      });
    }
    if (oasisDocumentsPage.oasisDocumentListDetected) {
      documentInventory.push({
        sourceLabel: socDocumentResult.matchedSocAnchorText ?? "OASIS documents page",
        normalizedType: "OASIS",
        discipline: "UNKNOWN",
        confidence: 0.9,
        evidence: workflowEvidence,
        sourceUrl: this.page.url(),
        sourcePath: null,
        discoveredAt,
        openBehavior: "SAME_PAGE",
      });
    }
    const artifacts: ArtifactRecord[] = [{
      artifactType: "OASIS",
      status: oasisDocumentsPage.oasisDocumentListDetected ? "FOUND" : "MISSING",
      portalLabel: socDocumentResult.matchedSocAnchorText ?? "OASIS documents page",
      locatorUsed: socDocumentResult.socSelectorUsed ?? oasisDocumentsPage.oasisSelectorUsed,
      discoveredAt,
      downloadPath: null,
      extractedFields: {
        oasisMenuClicked: String(oasisDocumentsPage.oasisMenuClicked),
        oasisDocumentListDetected: String(oasisDocumentsPage.oasisDocumentListDetected),
        socDocumentFound: String(socDocumentResult.socDocumentFound),
        socDocumentClicked: String(socDocumentResult.socDocumentClicked),
        matchedSocRowText: socDocumentResult.matchedSocRowText,
        matchedSocAnchorText: socDocumentResult.matchedSocAnchorText,
        diagnosisSectionOpened: String(diagnosisNavigationResult.diagnosisSectionOpened),
        diagnosisListFound: String(diagnosisNavigationResult.diagnosisListFound),
        diagnosisNavigationMethod: diagnosisNavigationResult.diagnosisNavigationMethod,
        diagnosisListSamples: diagnosisNavigationResult.diagnosisListSamples.join(" | "),
        diagnosisSnapshotRowCount: String(diagnosisNavigationResult.diagnosisPageSnapshot?.rows.length ?? 0),
        oasisReadyDiagnosisPath: options.oasisReadyDiagnosisPath ?? null,
        primaryDiagnosisSelected,
        otherDiagnosisCount: String(otherDiagnosisCount),
        codeConfidenceSummary,
        oasisLockState: oasisLockState?.oasisLockState ?? null,
        unlockControlVisible: String(oasisLockState?.unlockControlVisible ?? false),
        unlockControlText: oasisLockState?.unlockControlText ?? null,
        fieldsEditable: String(oasisLockState?.fieldsEditable ?? false),
        verificationOnly: String(oasisLockState?.verificationOnly ?? true),
        inputEligible: String(oasisLockState?.inputEligible ?? false),
        fileUploadsAccessible: String(fileUploadsResult.fileUploadsAccessible),
        fileUploadsUrl: fileUploadsResult.fileUploadsUrl,
        visibleUploadedDocuments: fileUploadsResult.visibleUploadedDocuments.join(" | "),
        admissionOrderAccessible: String(fileUploadsResult.admissionOrderAccessible),
        admissionOrderTitle: fileUploadsResult.admissionOrderTitle,
        admissionReasonPrimary: fileUploadsResult.admissionReasonPrimary,
        admissionReasonSnippets: fileUploadsResult.admissionReasonSnippets.join(" | "),
        rawExtractedTextSource: fileUploadsResult.rawExtractedTextSource,
        domExtractionRejectedReasons: fileUploadsResult.domExtractionRejectedReasons.join(" | "),
        possibleIcd10Codes: fileUploadsResult.possibleIcd10Codes.join(" | "),
        admissionOrderTextExcerpt: fileUploadsResult.admissionOrderTextExcerpt,
        admissionOrderSourcePdfPath: fileUploadsResult.sourcePdfPath,
        admissionOrderPrintedPdfPath: fileUploadsResult.printedPdfPath,
        admissionOrderSourceMetaPath: fileUploadsResult.sourceMetaPath,
        admissionOrderExtractedTextPath: fileUploadsResult.extractedTextPath,
        admissionOrderExtractionResultPath: fileUploadsResult.extractionResultPath,
      },
      notes: socDocumentResult.socDocumentFound
        ? []
        : oasisDocumentsPage.oasisDocumentListDetected
        ? []
        : ["Active OASIS workflow did not open the OASIS documents page."],
    }];

    this.options.logger?.info(
      {
        chartUrl: this.page.url(),
        workflowPhase,
        oasisMenuClicked: oasisDocumentsPage.oasisMenuClicked,
        oasisDocumentListDetected: oasisDocumentsPage.oasisDocumentListDetected,
        socDocumentFound: socDocumentResult.socDocumentFound,
        socDocumentClicked: socDocumentResult.socDocumentClicked,
        matchedSocRowText: socDocumentResult.matchedSocRowText,
        matchedSocAnchorText: socDocumentResult.matchedSocAnchorText,
        diagnosisSectionOpened: diagnosisNavigationResult.diagnosisSectionOpened,
        diagnosisListFound: diagnosisNavigationResult.diagnosisListFound,
        diagnosisNavigationMethod: diagnosisNavigationResult.diagnosisNavigationMethod,
        diagnosisListSamples: diagnosisNavigationResult.diagnosisListSamples,
        diagnosisSnapshotRowCount: diagnosisNavigationResult.diagnosisPageSnapshot?.rows.length ?? 0,
        oasisReadyDiagnosisPath: options.oasisReadyDiagnosisPath ?? null,
        primaryDiagnosisSelected,
        otherDiagnosisCount,
        codeConfidenceSummary,
        oasisLockState: oasisLockState?.oasisLockState ?? null,
        unlockControlVisible: oasisLockState?.unlockControlVisible ?? false,
        unlockControlText: oasisLockState?.unlockControlText ?? null,
        fieldsEditable: oasisLockState?.fieldsEditable ?? false,
        verificationOnly: oasisLockState?.verificationOnly ?? true,
        inputEligible: oasisLockState?.inputEligible ?? false,
        fileUploadsAccessible: fileUploadsResult.fileUploadsAccessible,
        fileUploadsUrl: fileUploadsResult.fileUploadsUrl,
        visibleUploadedDocuments: fileUploadsResult.visibleUploadedDocuments,
        admissionOrderAccessible: fileUploadsResult.admissionOrderAccessible,
        admissionOrderTitle: fileUploadsResult.admissionOrderTitle,
        admissionReasonPrimary: fileUploadsResult.admissionReasonPrimary,
        admissionReasonSnippets: fileUploadsResult.admissionReasonSnippets,
        rawExtractedTextSource: fileUploadsResult.rawExtractedTextSource,
        domExtractionRejectedReasons: fileUploadsResult.domExtractionRejectedReasons,
        possibleIcd10Codes: fileUploadsResult.possibleIcd10Codes,
      },
      socDocumentResult.socDocumentClicked
        ? "active OASIS workflow opened SOC document"
        : oasisDocumentsPage.oasisDocumentListDetected
        ? "pipeline restored to baseline path"
        : workflowPhase === "file_uploads_only"
        ? "File Uploads referral extraction workflow completed"
        : "active OASIS workflow failed",
    );

    return {
      artifacts,
      documentInventory,
      stepLogs,
      oasisLockState,
      diagnosisPageSnapshot: diagnosisNavigationResult.diagnosisPageSnapshot,
      calendarScope: null,
      calendarScopePath: null,
    };
  }

  async openOasisMenuForReview(input: {
    chartUrl: string;
  }): Promise<{
    result: OasisMenuOpenResult;
    stepLogs: AutomationStepLog[];
  }> {
    const menuResult = await this.openOasisDocumentsPageFromSidebar();
    const availableAssessmentTypes = menuResult.opened
      ? await this.collectVisibleOasisAssessmentTypes()
      : [];

    return {
      result: {
        opened: menuResult.opened,
        currentUrl: this.page.url(),
        selectorUsed: menuResult.oasisSelectorUsed,
        availableAssessmentTypes,
        warnings: menuResult.opened
          ? []
          : ["OASIS documents page could not be verified from the patient chart sidebar."],
      },
      stepLogs: menuResult.stepLogs,
    };
  }

  async openOasisAssessmentNoteForReview(input: {
    chartUrl: string;
    assessmentType: string;
  }): Promise<{
    result: OasisAssessmentNoteOpenResult;
    stepLogs: AutomationStepLog[];
  }> {
    const warnings: string[] = [];
    const normalizedAssessmentType = input.assessmentType.toUpperCase();
    if (normalizedAssessmentType !== "SOC") {
      warnings.push(
        `Assessment type ${normalizedAssessmentType} is not explicitly automated yet; attempting the current SOC-oriented note open path.`,
      );
    }

    const socDocumentResult = await this.openSocDocumentFromOasisTable({
      chartUrl: input.chartUrl,
      oasisSelectorUsed: "oasis_menu_for_review",
    });
    const initialOasisLockState = socDocumentResult.opened
      ? await this.detectOasisSocLockState({
          chartUrl: input.chartUrl,
          socSelectorUsed: socDocumentResult.socSelectorUsed,
          matchedSocAnchorText: socDocumentResult.matchedSocAnchorText,
        })
      : { lockState: null, stepLogs: [] };
    const diagnosisNavigationResult = socDocumentResult.opened
      ? await this.openActiveDiagnosesSectionFromSocForm({
          chartUrl: input.chartUrl,
          socSelectorUsed: socDocumentResult.socSelectorUsed,
          matchedSocAnchorText: socDocumentResult.matchedSocAnchorText,
          lockState: initialOasisLockState.lockState ?? null,
        })
      : {
          diagnosisSectionOpened: false,
          diagnosisListFound: false,
          diagnosisNavigationMethod: null,
          diagnosisListSamples: [],
          diagnosisPageSnapshot: null,
          lockState: initialOasisLockState.lockState ?? null,
          stepLogs: [] as AutomationStepLog[],
        };
    const assessmentProcessingStatus = socDocumentResult.opened
      ? await readOasisAssessmentProcessingSummary({
          page: this.page,
          logger: this.options.logger,
          debugConfig: this.options.debugConfig,
        })
      : {
          summary: deriveOasisAssessmentProcessingSummary([]),
          stepLogs: [] as AutomationStepLog[],
        };

    const visibleDiagnoses = (diagnosisNavigationResult.diagnosisPageSnapshot?.rows ?? [])
      .map((row) => {
        const description = normalizeWhitespace(row.description ?? null);
        const code = normalizeWhitespace(row.icd10Code ?? null);
        if (!description && !code) {
          return null;
        }
        return {
          text: [code, description].filter(Boolean).join(" ").trim(),
          code: code || null,
          description: description || null,
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .slice(0, 12);

    return {
      result: {
        assessmentOpened: socDocumentResult.opened,
        matchedAssessmentLabel: socDocumentResult.matchedSocAnchorText,
        matchedRequestedAssessment: normalizedAssessmentType === "SOC"
          ? Boolean(socDocumentResult.opened)
          : false,
        currentUrl: this.page.url(),
        diagnosisSectionOpened: diagnosisNavigationResult.diagnosisSectionOpened,
        diagnosisListFound: diagnosisNavigationResult.diagnosisListFound,
        diagnosisListSamples: diagnosisNavigationResult.diagnosisListSamples,
        visibleDiagnoses,
        lockStatus: diagnosisNavigationResult.lockState?.oasisLockState ?? "unknown",
        oasisAssessmentStatus: {
          detectedStatuses: assessmentProcessingStatus.summary.detectedStatuses,
          primaryStatus: assessmentProcessingStatus.summary.primaryStatus,
          decision: assessmentProcessingStatus.summary.decision,
          processingEligible: assessmentProcessingStatus.summary.processingEligible,
          reason: assessmentProcessingStatus.summary.reason,
          matchedSignals: assessmentProcessingStatus.summary.matchedSignals,
        },
        warnings,
      },
      stepLogs: [
        ...socDocumentResult.stepLogs,
        ...initialOasisLockState.stepLogs,
        ...diagnosisNavigationResult.stepLogs,
        ...assessmentProcessingStatus.stepLogs,
      ],
    };
  }

  async captureOasisPrintedNoteForReview(input: {
    chartUrl: string;
    evidenceDir: string;
    assessmentType: string;
    matchedAssessmentLabel?: string | null;
    printProfileKey?: OasisPrintSectionProfileKey | null;
  }): Promise<{
    result: OasisPrintedNoteCaptureOpenResult;
    stepLogs: AutomationStepLog[];
  }> {
    await waitForPortalPageSettled(this.page, this.options.debugConfig);
    const stepLogs: AutomationStepLog[] = [];
    const warnings: string[] = [];
    const documentDirectory = path.join(input.evidenceDir, "oasis-printed-note");
    await mkdir(documentDirectory, { recursive: true });

    const printedPdfPath = path.join(documentDirectory, "printed-source.pdf");
    const extractionResultPath = path.join(documentDirectory, "extraction-result.json");
    const printProfile = getOasisPrintSectionProfile(
      input.printProfileKey ?? DEFAULT_OASIS_PRINT_SECTION_PROFILE_KEY,
    );
    const printButtonCandidates = [
      {
        strategy: "css",
        selector: "fin-button[title='Print Preview'] > button",
        description: "Print Preview nested button",
      },
      {
        strategy: "css",
        selector: "fin-button[title*='Print'] > button",
        description: "Nested print button within titled fin-button",
      },
      {
        strategy: "css",
        selector: "fin-button[icon='ft-printer'] > button",
        description: "Nested print button within printer-icon fin-button",
      },
      {
        strategy: "css",
        selector: "button:has(.ft-printer)",
        description: "Button containing printer icon",
      },
      {
        strategy: "role",
        role: "button",
        name: /^print$/i,
        description: "Print button by accessible role",
      },
      {
        strategy: "css",
        selector: "button:has-text('Print')",
        description: "Visible button with Print text",
      },
    ] satisfies PortalSelectorCandidate[];
    const printButtonSelector = [
      "fin-button[title='Print Preview'] > button",
      "fin-button[title*='Print'] > button",
      "fin-button[icon='ft-printer'] > button",
      "button:has(.ft-printer)",
      "button:has-text('Print')",
      "role=button[name=/^print$/i]",
    ].join(", ");
    const printActionBarCandidates = [
      {
        strategy: "css",
        selector: "app-document-note section:has(fin-button[icon='ft-printer']), app-document-note fin-action-menu:has(fin-button[icon='ft-printer'])",
        description: "OASIS note action area containing the print control",
      },
      {
        strategy: "css",
        selector: "app-document-note [class*='action'], app-document-note [class*='toolbar'], app-document-note [class*='header']",
        description: "OASIS note header/action containers",
      },
    ] satisfies PortalSelectorCandidate[];
    const rawPrintButtonLocator = this.page.locator([
      "fin-button[title='Print Preview'] > button",
      "fin-button[title*='Print'] > button",
      "fin-button[icon='ft-printer'] > button",
      "button:has(.ft-printer)",
      "button:has-text('Print')",
    ].join(", "));
    const printButtonDetected = await rawPrintButtonLocator.count().catch(() => 0) > 0;
    let printButton: Locator | null = null;
    let printButtonSelectorUsed: string | null = null;
    const actionBarResolution = await resolveVisibleLocatorList({
      page: this.page,
      candidates: printActionBarCandidates,
      step: "oasis_print_action_bar",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      maxItems: 6,
    });
    for (const actionBar of actionBarResolution.items) {
      const buttonResolution = await resolveVisibleLocatorList({
        page: actionBar.locator,
        candidates: printButtonCandidates,
        step: "oasis_print_button_scoped",
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
        maxItems: 4,
      });
      if (buttonResolution.items.length > 0) {
        printButton = buttonResolution.items[0].locator;
        printButtonSelectorUsed = buttonResolution.items[0].candidate.strategy === "css"
          ? buttonResolution.items[0].candidate.selector
          : buttonResolution.items[0].candidate.description;
        break;
      }
    }
    if (!printButton) {
      const globalButtonResolution = await resolveVisibleLocatorList({
        page: this.page,
        candidates: printButtonCandidates,
        step: "oasis_print_button_global",
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
        maxItems: 4,
      });
      if (globalButtonResolution.items.length > 0) {
        printButton = globalButtonResolution.items[0].locator;
        printButtonSelectorUsed = globalButtonResolution.items[0].candidate.strategy === "css"
          ? globalButtonResolution.items[0].candidate.selector
          : globalButtonResolution.items[0].candidate.description;
      }
    }
    const printButtonVisible = Boolean(printButton);
    let printClickSucceeded = false;
    let printModalDetected = false;
    let printModalSelectorUsed: string | null = null;
    let printModalConfirmSelectorUsed: string | null = null;
    let printModalConfirmSucceeded = false;
    let selectedSectionLabels: string[] = [];

    if (printButton) {
      await printButton.scrollIntoViewIfNeeded().catch(() => undefined);
      await this.page.evaluate(() => {
        const windowWithPrintFlag = globalThis as unknown as {
          print?: () => void;
          __medicalAiQaOriginalPrint?: () => void;
          __medicalAiQaPrintRequested?: boolean;
        };
        if (!windowWithPrintFlag.__medicalAiQaOriginalPrint && windowWithPrintFlag.print) {
          windowWithPrintFlag.__medicalAiQaOriginalPrint = windowWithPrintFlag.print.bind(globalThis);
        }
        windowWithPrintFlag.__medicalAiQaPrintRequested = false;
        windowWithPrintFlag.print = () => {
          windowWithPrintFlag.__medicalAiQaPrintRequested = true;
        };
      }).catch(() => undefined);

      await clickReadOnlyTarget({
        locator: printButton,
        page: this.page,
        debugConfig: this.options.debugConfig,
      }).then(() => {
        printClickSucceeded = true;
      }).catch(() => {
        printClickSucceeded = false;
      });

      if (printClickSucceeded) {
        printClickSucceeded = await this.page.evaluate(() => {
          const windowWithPrintFlag = globalThis as unknown as {
            __medicalAiQaPrintRequested?: boolean;
          };
          return windowWithPrintFlag.__medicalAiQaPrintRequested === true;
        }).catch(() => true);
      }

      const modalResolution = await resolveVisibleModalLocator(this.page);
      if (modalResolution.locator) {
        printModalDetected = true;
        printModalSelectorUsed = modalResolution.selectorUsed;
        const modalSelection = await applyOasisPrintSectionProfile({
          modal: modalResolution.locator,
          page: this.page,
          profile: printProfile,
          debugConfig: this.options.debugConfig,
        });
        selectedSectionLabels = modalSelection.selectedSectionLabels;
        warnings.push(...modalSelection.warnings);

        const modalConfirmCandidates = [
          "button:has-text('Print')",
          "fin-button[title='Print']",
          "fin-button[icon='ft-printer']",
          "fin-button:has-text('Print')",
          "button:has-text('Preview')",
          "button:has-text('Generate')",
          "button:has-text('OK')",
          "button:has-text('Ok')",
        ];
        for (const selector of modalConfirmCandidates) {
          const confirmButton = modalResolution.locator.locator(selector).first();
          if (await confirmButton.count().catch(() => 0) > 0 && await confirmButton.isVisible().catch(() => false)) {
            printModalConfirmSelectorUsed = selector;
            const printCaptureTimeoutMs = resolveOasisPrintCaptureTimeoutMs(this.options.debugConfig);
            const downloadPromise = this.page.waitForEvent("download", {
              timeout: printCaptureTimeoutMs,
            }).catch(() => null);
            const pdfResponsePromise = this.page.waitForResponse((response) => {
              const contentType = response.headers()["content-type"] ?? "";
              return /application\/pdf/i.test(contentType);
            }, {
              timeout: printCaptureTimeoutMs,
            }).catch(() => null);

            await clickReadOnlyTarget({
              locator: confirmButton,
              page: this.page,
              debugConfig: this.options.debugConfig,
            }).then(() => {
              printModalConfirmSucceeded = true;
            }).catch(() => {
              printModalConfirmSucceeded = false;
            });

            const download = await downloadPromise;
            if (download) {
              await download.saveAs(printedPdfPath).catch(() => undefined);
            } else {
              const pdfResponse = await pdfResponsePromise;
              if (pdfResponse) {
                const responseBody = await pdfResponse.body().catch(() => null);
                if (responseBody) {
                  await writeFile(printedPdfPath, responseBody);
                }
              } else {
                warnings.push(
                  `Timed out after ${printCaptureTimeoutMs}ms waiting for Finale to produce the printed OASIS PDF.`,
                );
              }
            }
            break;
          }
        }

        if (!printModalConfirmSelectorUsed) {
          warnings.push("OASIS print modal opened but no confirm/print button was found.");
        }

        await this.page.waitForTimeout(250).catch(() => undefined);
        await waitForPortalPageSettled(this.page, this.options.debugConfig);
      } else if (!printClickSucceeded) {
        warnings.push("OASIS print button click did not open a print modal.");
      }
    } else {
      warnings.push("Print button could not be located on the OASIS assessment page.");
    }

    let sourcePdfPath: string | null = null;
    let extractionMethod: OasisPrintedNoteCaptureOpenResult["extractionMethod"] = "visible_text_fallback";
    const printedPdfExists = await access(printedPdfPath)
      .then(() => true)
      .catch(() => false);
    if (printedPdfExists) {
      sourcePdfPath = printedPdfPath;
      extractionMethod = "printed_pdf_no_ocr";
    } else if (printModalConfirmSucceeded || printClickSucceeded) {
      warnings.push(
        "Skipped Playwright page.pdf fallback because it can capture the live OASIS screen before Finale finishes generating the printable document.",
      );
    }

    const extractedTextFallback = normalizeWhitespace(await dumpTopVisibleText(this.page, 16_000).catch(() => ""));
    const artifact: ArtifactRecord = {
      artifactType: "OASIS",
      status: "DOWNLOADED",
      portalLabel: input.matchedAssessmentLabel ?? `${input.assessmentType} OASIS`,
      locatorUsed: printButtonDetected ? printButtonSelector : "visible_text_fallback",
      discoveredAt: new Date().toISOString(),
      downloadPath: sourcePdfPath,
      extractedFields: {},
      notes: [],
    };
    const extractedDocuments = await extractDocumentsFromArtifacts(sourcePdfPath ? [artifact] : []);
    const extractedDocument = extractedDocuments.find((document) => document.type === "OASIS") ?? null;
    const extractedTextPath = path.join(documentDirectory, "extracted-text.txt");
    const ocrResultPath = path.join(documentDirectory, "ocr-result.json");
    let textLength = extractedDocument?.text.length ?? 0;
    if (!extractedDocument) {
      await writeFile(extractedTextPath, `${extractedTextFallback}\n`, "utf8");
      textLength = extractedTextFallback.length;
      warnings.push("Fell back to visible page text because printed-note OCR text was unavailable.");
    } else if (extractedDocument.metadata.ocrSuccess) {
      extractionMethod = "printed_pdf_ocr";
    }

    await writeFile(
      extractionResultPath,
      JSON.stringify(
        {
          assessmentType: input.assessmentType,
          matchedAssessmentLabel: input.matchedAssessmentLabel ?? null,
          printProfileKey: printProfile.key,
          printProfileLabel: printProfile.label,
          currentUrl: this.page.url(),
          printButtonDetected,
          printButtonVisible,
          printButtonSelectorUsed: printButtonSelectorUsed ?? (printButtonDetected ? printButtonSelector : null),
          printClickSucceeded,
          printModalDetected,
          printModalSelectorUsed,
          printModalConfirmSelectorUsed,
          printModalConfirmSucceeded,
          selectedSectionLabels,
          printedPdfPath: sourcePdfPath,
          extractedTextPath,
          ocrResultPath: sourcePdfPath ? ocrResultPath : null,
          textLength,
          extractionMethod,
          warnings,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );

    stepLogs.push(createAutomationStepLog({
      step: "oasis_print_capture",
      message: sourcePdfPath
        ? "Captured the OASIS assessment print view for read-only OCR review."
        : "Attempted OASIS assessment print capture and fell back to visible text review.",
      urlBefore: input.chartUrl,
      urlAfter: this.page.url(),
      selectorUsed: printButtonSelectorUsed ?? (printButtonDetected ? printButtonSelector : null),
      found: [
        `assessmentType=${input.assessmentType}`,
        `printProfileKey=${printProfile.key}`,
        `printButtonDetected=${printButtonDetected}`,
        `printClickSucceeded=${printClickSucceeded}`,
        `printModalDetected=${printModalDetected}`,
        `printModalConfirmSucceeded=${printModalConfirmSucceeded}`,
        `extractionMethod=${extractionMethod}`,
        `textLength=${textLength}`,
      ],
      missing: textLength > 0 ? [] : ["printed OASIS note text"],
      openedDocumentLabel: input.matchedAssessmentLabel ?? `${input.assessmentType} OASIS`,
      openedDocumentUrl: this.page.url(),
      evidence: [
        `printedPdfPath=${sourcePdfPath ?? "none"}`,
        `selectedSectionLabels=${selectedSectionLabels.join(" | ") || "none"}`,
        `extractedTextPath=${extractedTextPath}`,
        `ocrResultPath=${sourcePdfPath ? ocrResultPath : "none"}`,
        `extractionResultPath=${extractionResultPath}`,
        `warnings=${warnings.join(" | ") || "none"}`,
      ],
      safeReadConfirmed: true,
    }));

    return {
      result: {
        assessmentType: input.assessmentType,
        printProfileKey: printProfile.key,
        printProfileLabel: printProfile.label,
        printButtonDetected,
        printButtonVisible,
        printButtonSelectorUsed: printButtonSelectorUsed ?? (printButtonDetected ? printButtonSelector : null),
        printClickSucceeded,
        printModalDetected,
        printModalSelectorUsed,
        printModalConfirmSelectorUsed,
        printModalConfirmSucceeded,
        selectedSectionLabels,
        currentUrl: this.page.url(),
        printedPdfPath: sourcePdfPath,
        sourcePdfPath,
        extractedTextPath,
        extractionResultPath,
        ocrResultPath: sourcePdfPath ? ocrResultPath : null,
        textLength,
        extractionMethod,
        warnings,
      },
      stepLogs,
    };
  }

  async executeOasisDiagnosisActionPlan(input: {
    chartUrl?: string | null;
    actionPlan: OasisInputActionPlan;
    lockState: OasisLockStateSnapshot | null;
    writeEnabled: boolean;
    initialSnapshot?: OasisDiagnosisPageSnapshot | null;
  }): Promise<{
    diagnosisPageSnapshot: OasisDiagnosisPageSnapshot | null;
    actionsPerformed: OasisExecutionActionPerformed[];
    insertClicksPerformed: number;
    fieldsUpdatedCount: number;
    executed: boolean;
    warnings: string[];
    stepLogs: AutomationStepLog[];
  }> {
    await waitForPortalPageSettled(this.page, this.options.debugConfig);
    const stepLogs: AutomationStepLog[] = [];
    const warnings = [...input.actionPlan.warnings];
    let currentSnapshot = input.initialSnapshot ?? await this.captureOasisDiagnosisSnapshot();
    const preExecutionRowCount = currentSnapshot?.rows.length ?? 0;
    const actionsPerformed: OasisExecutionActionPerformed[] = [];
    let insertClicksPerformed = 0;
    let fieldsUpdatedCount = 0;
    const chartUrl = input.chartUrl ?? this.page.url();
    const guardDecision: OasisDiagnosisExecutionGuardDecision = evaluateOasisDiagnosisExecutionGuard({
      lockState: input.lockState?.oasisLockState ?? input.actionPlan.lockState,
      mode: input.actionPlan.mode,
      writeEnabled: input.writeEnabled,
    });

    stepLogs.push(createAutomationStepLog({
      step: "oasis_diagnosis_execution_start",
      message: "Evaluated the guarded OASIS diagnosis execution stage before any insert or field input action.",
      urlBefore: chartUrl,
      urlAfter: this.page.url(),
      found: [
        "executionStarted:true",
        `lockState:${input.lockState?.oasisLockState ?? input.actionPlan.lockState}`,
        `mode:${input.actionPlan.mode}`,
        `writeEnabled:${input.writeEnabled}`,
        `executionEligible:${guardDecision.shouldExecute}`,
        `preExecutionRowCount:${preExecutionRowCount}`,
      ],
      missing: [],
      evidence: [
        `actionCount:${input.actionPlan.actions.length}`,
        `insertDiagnosisClicksNeeded:${input.actionPlan.insertDiagnosisClicksNeeded}`,
        `guardSkipReasons:${guardDecision.skipReasons.join(" | ") || "none"}`,
      ],
      safeReadConfirmed: true,
    }));

    if (!guardDecision.shouldExecute) {
      warnings.push("executionSkipped");
      warnings.push(...guardDecision.skipReasons.map((reason) => `executionSkipReason:${reason}`));
      stepLogs.push(createAutomationStepLog({
        step: "oasis_diagnosis_execution",
        message: "Skipped OASIS diagnosis execution because the execution guard did not allow live writes.",
        urlBefore: chartUrl,
        urlAfter: this.page.url(),
        found: [
          "executionSkipped:true",
          `lockState:${input.lockState?.oasisLockState ?? input.actionPlan.lockState}`,
          `mode:${input.actionPlan.mode}`,
          `writeEnabled:${input.writeEnabled}`,
        ],
        missing: ["eligible unlocked write path"],
        evidence: [
          `preExecutionRowCount:${preExecutionRowCount}`,
          `guardSkipReasons:${guardDecision.skipReasons.join(" | ") || "none"}`,
        ],
        safeReadConfirmed: true,
      }));
      return {
        diagnosisPageSnapshot: currentSnapshot,
        actionsPerformed,
        insertClicksPerformed,
        fieldsUpdatedCount,
        executed: false,
        warnings: [...new Set(warnings)],
        stepLogs,
      };
    }
    for (const action of input.actionPlan.actions) {
      if (action.type === "insert_slot") {
        const beforeRowCount = currentSnapshot?.rows.length ?? await this.countOasisDiagnosisRows();
        const insertResolution = await resolveFirstVisibleLocator({
          page: this.page,
          candidates: oasisDiagnosisSelectors.insertDiagnosisButton,
          step: `oasis_insert_diagnosis_execute_${action.targetIndex}`,
          logger: this.options.logger,
          debugConfig: this.options.debugConfig,
          settle: () => waitForPortalPageSettled(this.page, this.options.debugConfig),
        });

        if (!insertResolution.locator) {
          warnings.push(`Insert Diagnosis button was unavailable for targetIndex=${action.targetIndex}.`);
          actionsPerformed.push({
            type: "insert_slot",
            targetIndex: action.targetIndex,
            simulated: false,
            status: "failed",
            reason: "insert_button_not_found",
          });
          continue;
        }

        const clickTargetSummary = await summarizeClickTarget(insertResolution.locator);
        await clickPortalTarget({
          locator: insertResolution.locator,
          page: this.page,
          debugConfig: this.options.debugConfig,
        });
        const postInsertSnapshot = await this.waitForDiagnosisRowCountGreaterThan(beforeRowCount);
        currentSnapshot = postInsertSnapshot ?? currentSnapshot;
        const insertedRow = postInsertSnapshot?.rows.at(-1) ?? null;
        const insertedRowInteractable = insertedRow
          ? isOasisDiagnosisRowInteractable(toDiagnosisRowCandidate(insertedRow))
          : false;
        if (
          (postInsertSnapshot?.rows.length ?? beforeRowCount) > beforeRowCount &&
          insertedRowInteractable
        ) {
          insertClicksPerformed += 1;
          actionsPerformed.push({
            type: "insert_slot",
            targetIndex: action.targetIndex,
            simulated: false,
            status: "performed",
          });
          stepLogs.push(createAutomationStepLog({
            step: "oasis_diagnosis_insert_slot",
            message: `Inserted diagnosis slot ${action.targetIndex} and confirmed the new slot is interactable.`,
            urlBefore: chartUrl,
            urlAfter: this.page.url(),
            selectorUsed: clickTargetSummary,
            found: [
              `targetIndex:${action.targetIndex}`,
              `beforeRowCount:${beforeRowCount}`,
              `afterRowCount:${postInsertSnapshot?.rows.length ?? beforeRowCount}`,
              "insertedRowInteractable:true",
            ],
            missing: [],
            evidence: buildDiagnosisRowEvidence(insertedRow),
            safeReadConfirmed: true,
          }));
        } else {
          warnings.push(`Insert Diagnosis did not produce an interactable row for targetIndex=${action.targetIndex}.`);
          actionsPerformed.push({
            type: "insert_slot",
            targetIndex: action.targetIndex,
            simulated: false,
            status: "failed",
            reason: insertedRowInteractable ? "row_count_not_increased" : "inserted_row_not_interactable",
          });
          stepLogs.push(createAutomationStepLog({
            step: "oasis_diagnosis_insert_slot",
            message: `Insert Diagnosis did not produce a usable slot for targetIndex ${action.targetIndex}.`,
            urlBefore: chartUrl,
            urlAfter: this.page.url(),
            selectorUsed: clickTargetSummary,
            found: [
              `targetIndex:${action.targetIndex}`,
              `beforeRowCount:${beforeRowCount}`,
              `afterRowCount:${postInsertSnapshot?.rows.length ?? beforeRowCount}`,
            ],
            missing: ["interactable inserted diagnosis slot"],
            evidence: buildDiagnosisRowEvidence(insertedRow),
            safeReadConfirmed: true,
          }));
        }
        continue;
      }

      const matchingRowIndex = findMatchingDiagnosisRowIndex(currentSnapshot, action);
      if (matchingRowIndex >= 0) {
        actionsPerformed.push({
          type: "fill_diagnosis",
          targetSlot: action.targetSlot,
          code: action.code,
          description: action.description,
          simulated: false,
          status: "skipped",
          reason: `matching_diagnosis_already_present_in_row_${matchingRowIndex}`,
        });
        continue;
      }

      const targetRowIndex = targetSlotToRowIndex(action.targetSlot);
      if (targetRowIndex == null) {
        warnings.push(`Unrecognized diagnosis target slot '${action.targetSlot}'.`);
        actionsPerformed.push({
          type: "fill_diagnosis",
          targetSlot: action.targetSlot,
          code: action.code,
          description: action.description,
          simulated: false,
          status: "failed",
          reason: "invalid_target_slot",
        });
        continue;
      }

      const beforeActionSnapshot = currentSnapshot;
      const beforeTargetRow = beforeActionSnapshot?.rows[targetRowIndex] ?? null;
      const root = await resolveOasisDiagnosisRootLocator({
        page: this.page,
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
      });
      const rows = root ? await resolveDiagnosisRowLocators(root) : [];
      const row = rows[targetRowIndex] ?? null;
      if (!row) {
        warnings.push(`Diagnosis row ${action.targetSlot} was not available for input.`);
        actionsPerformed.push({
          type: "fill_diagnosis",
          targetSlot: action.targetSlot,
          code: action.code,
          description: action.description,
          simulated: false,
          status: "failed",
          reason: "target_row_not_found",
        });
        continue;
      }

      const codeField = await resolveFirstFieldLocator(row, oasisDiagnosisSelectors.icdCodeField);
      const descriptionField = await resolveFirstFieldLocator(row, oasisDiagnosisSelectors.descriptionField);
      let updatedFieldsForAction = 0;

      if (action.code) {
        if (await isLocatorEditable(codeField)) {
          await fillEditableField(codeField!, action.code);
          updatedFieldsForAction += 1;
        } else {
          warnings.push(`ICD field for slot ${action.targetSlot} was not editable.`);
        }
      }

      if (action.description) {
        if (await isLocatorEditable(descriptionField)) {
          await fillEditableField(descriptionField!, action.description);
          updatedFieldsForAction += 1;
        } else {
          warnings.push(`Description field for slot ${action.targetSlot} was not editable.`);
        }
      }

      const severityApplied = await clickRadioChoiceWithinRow({
        row,
        kind: "severity",
        target: String(action.severity),
      });
      if (severityApplied) {
        updatedFieldsForAction += 1;
      } else {
        warnings.push(`Severity control for slot ${action.targetSlot} could not be resolved.`);
      }

      const timingApplied = await clickRadioChoiceWithinRow({
        row,
        kind: "timing",
        target: action.onsetType,
      });
      if (timingApplied) {
        updatedFieldsForAction += 1;
      } else {
        warnings.push(`Timing control for slot ${action.targetSlot} could not be resolved.`);
      }

      fieldsUpdatedCount += updatedFieldsForAction;
      currentSnapshot = await this.captureOasisDiagnosisSnapshot();
      const afterTargetRow = currentSnapshot?.rows[targetRowIndex] ?? null;
      actionsPerformed.push({
        type: "fill_diagnosis",
        targetSlot: action.targetSlot,
        code: action.code,
        description: action.description,
        simulated: false,
        status: updatedFieldsForAction > 0 ? "performed" : "failed",
        reason: updatedFieldsForAction > 0 ? undefined : "no_editable_fields_updated",
      });
      stepLogs.push(createAutomationStepLog({
        step: "oasis_diagnosis_fill",
        message: updatedFieldsForAction > 0
          ? `Filled diagnosis slot ${action.targetSlot} and captured before/after evidence.`
          : `Diagnosis slot ${action.targetSlot} could not be updated with the planned values.`,
        urlBefore: chartUrl,
        urlAfter: this.page.url(),
        found: [
          `targetSlot:${action.targetSlot}`,
          `updatedFields:${updatedFieldsForAction}`,
          `code:${action.code || "none"}`,
          `description:${action.description || "none"}`,
        ],
        missing: updatedFieldsForAction > 0 ? [] : ["editable diagnosis fields"],
        evidence: [
          `before:${buildDiagnosisRowEvidence(beforeTargetRow).join(" | ")}`,
          `after:${buildDiagnosisRowEvidence(afterTargetRow).join(" | ")}`,
          `severity:${action.severity}`,
          `onsetType:${action.onsetType}`,
        ],
        safeReadConfirmed: true,
      }));
    }

    const postSnapshot = await this.captureOasisDiagnosisSnapshot();
    const postExecutionRowCount = postSnapshot?.rows.length ?? preExecutionRowCount;
    stepLogs.push(createAutomationStepLog({
      step: "oasis_diagnosis_execution_complete",
      message: "Completed the guarded OASIS diagnosis execution stage and captured the post-input diagnosis state.",
      urlBefore: chartUrl,
      urlAfter: this.page.url(),
      found: [
        "executionCompleted:true",
        `insertClicksPerformed:${insertClicksPerformed}`,
        `fieldsUpdatedCount:${fieldsUpdatedCount}`,
        `postExecutionRowCount:${postExecutionRowCount}`,
      ],
      missing: [],
      evidence: [
        "executed:true",
        "simulated:false",
        `warnings:${warnings.join(" | ") || "none"}`,
      ],
      safeReadConfirmed: true,
    }));

    return {
      diagnosisPageSnapshot: postSnapshot,
      actionsPerformed,
      insertClicksPerformed,
      fieldsUpdatedCount,
      executed: true,
      warnings: [...new Set(warnings)],
      stepLogs,
    };
  }

  private async captureOasisDiagnosisSnapshot(): Promise<OasisDiagnosisPageSnapshot | null> {
    try {
      return await inspectOasisDiagnosisPage({
        page: this.page,
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
      });
    } catch (error) {
      return createEmptyOasisDiagnosisPageSnapshot({
        page: this.page,
        extractionWarnings: [
          `Diagnosis snapshot capture failed during Active Diagnoses execution flow: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
        mappingNotes: [
          "Fallback snapshot emitted while preserving execution flow after Active Diagnoses DOM inspection failed.",
        ],
      });
    }
  }

  private async countOasisDiagnosisRows(): Promise<number> {
    const snapshot = await this.captureOasisDiagnosisSnapshot();
    return snapshot?.rows.length ?? 0;
  }

  private async waitForDiagnosisRowCountGreaterThan(
    beforeRowCount: number,
    maxAttempts = 6,
  ): Promise<OasisDiagnosisPageSnapshot | null> {
    let lastSnapshot: OasisDiagnosisPageSnapshot | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await this.page.waitForTimeout(400);
      await waitForPortalPageSettled(this.page, this.options.debugConfig);
      lastSnapshot = await this.captureOasisDiagnosisSnapshot();
      if ((lastSnapshot?.rows.length ?? 0) > beforeRowCount) {
        return lastSnapshot;
      }
    }
    return lastSnapshot;
  }

  private async restorePatientChartRouteIfNeeded(input: {
    expectedChartUrl: string;
    reason: string;
  }): Promise<AutomationStepLog | null> {
    const currentUrl = this.page.url();
    const expectedChartUrl = input.expectedChartUrl;
    if (currentUrl === expectedChartUrl) {
      return null;
    }

    const expectedChartRouteIsPatientCalendar =
      /\/provider\/[^/]+\/client\/[^/]+\/intake\/[^/]+\/calendar(?:$|[?#])/i.test(expectedChartUrl);
    const currentRouteIsPatientCalendar =
      /\/provider\/[^/]+\/client\/[^/]+\/intake\/[^/]+\/calendar(?:$|[?#])/i.test(currentUrl);

    if (!expectedChartRouteIsPatientCalendar || currentRouteIsPatientCalendar) {
      return null;
    }

    const evidence = [
      `Restore reason: ${input.reason}`,
      `Current URL before restore: ${currentUrl}`,
      `Expected patient chart URL: ${expectedChartUrl}`,
    ];
    let restored = false;
    let failureMessage: string | null = null;

    try {
      await this.page.goto(expectedChartUrl, { waitUntil: "domcontentloaded" });
      await waitForPortalPageSettled(this.page, this.options.debugConfig);
      restored = this.page.url() === expectedChartUrl ||
        /\/provider\/[^/]+\/client\/[^/]+\/intake\/[^/]+\/calendar(?:$|[?#])/i.test(this.page.url());
      evidence.push(`URL after restore: ${this.page.url()}`);
      evidence.push(`Chart route restored: ${restored}`);
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error);
      evidence.push(`URL after restore attempt: ${this.page.url()}`);
      evidence.push(`Chart route restore error: ${failureMessage}`);
      this.options.logger?.warn(
        {
          currentUrl,
          expectedChartUrl,
          failureMessage,
        },
        "failed to restore patient chart route before OASIS sidebar navigation",
      );
    }

    return createAutomationStepLog({
      step: "chart_route_restore",
      message: restored
        ? "Restored the patient chart route after File Uploads navigation before starting OASIS sidebar verification."
        : "Attempted to restore the patient chart route after File Uploads navigation, but the chart route was not confirmed.",
      urlBefore: currentUrl,
      urlAfter: this.page.url(),
      selectorUsed: "goto(expectedChartUrl)",
      found: restored
        ? [`chartRouteRestored:true`, `restoreReason:${input.reason}`]
        : [`chartRouteRestored:false`, `restoreReason:${input.reason}`],
      missing: restored ? [] : ["patient chart /calendar route"],
      evidence,
      safeReadConfirmed: true,
    });
  }

  private async openOasisDocumentsPageFromSidebar(): Promise<{
    opened: boolean;
    oasisMenuClicked: boolean;
    oasisDocumentListDetected: boolean;
    socDocumentFound: boolean;
    socDocumentClicked: boolean;
    oasisSelectorUsed: string | null;
    socSelectorUsed: string | null;
    matchedSocRowText: string | null;
    matchedSocAnchorText: string | null;
    stepLogs: AutomationStepLog[];
  }> {
    await waitForPortalPageSettled(this.page, this.options.debugConfig);
    const chartUrl = this.page.url();
    const stepLogs: AutomationStepLog[] = [];
    this.options.logger?.info({ chartUrl }, "entering active OASIS workflow");
    const buildFailureResult = (input: {
      message: string;
      failureReason: string;
      selectorUsed?: string | null;
      found?: string[];
      missing?: string[];
      evidence?: string[];
    }) => {
      const found = [
        ...(input.found ?? [
          "sidebarDetected:false",
          "oasisTextFound:false",
          "oasisMenuClicked:false",
          "oasisDocumentListDetected:false",
          "socDocumentFound:false",
          "socDocumentClicked:false",
        ]),
        `failureReason:${input.failureReason}`,
      ];
      const missing = input.missing ?? ["OASIS documents page"];
      const evidence = input.evidence ?? [];

      stepLogs.push(createAutomationStepLog({
        step: "oasis_menu",
        message: input.message,
        urlBefore: chartUrl,
        urlAfter: this.page.url(),
        selectorUsed: input.selectorUsed ?? null,
        found,
        missing,
        evidence,
        safeReadConfirmed: true,
      }));
      stepLogs.push(createAutomationStepLog({
        step: "qa_summary",
        message: input.message,
        urlBefore: chartUrl,
        urlAfter: this.page.url(),
        selectorUsed: input.selectorUsed ?? null,
        found,
        missing,
        evidence,
        safeReadConfirmed: true,
      }));

      return {
        opened: false,
        oasisMenuClicked: false,
        oasisDocumentListDetected: false,
        socDocumentFound: false,
        socDocumentClicked: false,
        oasisSelectorUsed: input.selectorUsed ?? null,
        socSelectorUsed: null,
        matchedSocRowText: null,
        matchedSocAnchorText: null,
        stepLogs,
      };
    };
    const sidebarContainerSelector = "fini-sidebar, fin-sidebar, nav.fin-sidebar__wrapper, .fin-sidebar__wrapper";
    let sidebarContainerCount = 0;
    const sidebarDiagnostics: Array<{
      index: number;
      visible: boolean;
      tagName: string;
      menuCount: number;
      oasisSpanCount: number;
      documentsSpanCount: number;
    }> = [];
    let sidebarRoot: Locator | null = null;
    let sidebarRootSource = "fini-sidebar";
    let resolvedOasisSpan: Locator | null = null;
    let resolvedOasisSpanSelector: string | null = null;
    let primaryOasisSpanCount = 0;
    let fallbackDocumentsOasisSpanCount = 0;
    let fallbackAnyDocumentsSpanCount = 0;
    const sidebarResolutionEvidence: string[] = [];

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await waitForPortalPageSettled(this.page, this.options.debugConfig);

      const sidebarContainers = this.page.locator(sidebarContainerSelector);
      sidebarContainerCount = await sidebarContainers.count().catch(() => 0);
      sidebarDiagnostics.length = 0;
      sidebarRoot = null;
      sidebarRootSource = "fini-sidebar";

      for (let index = 0; index < sidebarContainerCount; index += 1) {
        const sidebar = sidebarContainers.nth(index);
        const visible = await sidebar.isVisible().catch(() => false);
        const tagName = await sidebar.evaluate((el) => (el as any).tagName?.toLowerCase?.() ?? "unknown").catch(() => "unknown");
        const menuCount = await sidebar.locator("fin-sidebar-menu").count().catch(() => 0);
        const oasisSpanCount = await sidebar
          .locator('li.notes-sub-menu #documents span')
          .filter({ hasText: /OASIS/i })
          .count()
          .catch(() => 0);
        const documentsSpanCount = await sidebar.locator('#documents span').filter({ hasText: /OASIS/i }).count().catch(() => 0);

        sidebarDiagnostics.push({
          index,
          visible,
          tagName,
          menuCount,
          oasisSpanCount,
          documentsSpanCount,
        });

        if (!visible) {
          continue;
        }

        if (documentsSpanCount > 0 || oasisSpanCount > 0) {
          sidebarRoot = sidebar;
          sidebarRootSource = tagName;
          break;
        }

        if (!sidebarRoot && menuCount > 0) {
          sidebarRoot = sidebar;
          sidebarRootSource = tagName;
        }
      }

      if (!sidebarRoot) {
        // Fallback to visible menu roots when sidebar wrappers are present but still hydrating.
        const fallbackMenus = this.page.locator("fin-sidebar-menu");
        const fallbackMenuCount = await fallbackMenus.count().catch(() => 0);
        sidebarRootSource = "fin-sidebar-menu";
        for (let index = 0; index < fallbackMenuCount; index += 1) {
          const candidate = fallbackMenus.nth(index);
          if (await candidate.isVisible().catch(() => false)) {
            sidebarRoot = candidate;
            break;
          }
        }
      }

      if (sidebarRoot) {
        const primaryOasisSpans = sidebarRoot.locator('li.notes-sub-menu #documents span').filter({ hasText: /^OASIS$/i });
        const fallbackDocumentsOasisSpans = sidebarRoot.locator('#documents span').filter({ hasText: /OASIS/i });
        const fallbackAnyDocumentsSpans = sidebarRoot.locator('span').filter({ hasText: /^OASIS$/i });

        primaryOasisSpanCount = await primaryOasisSpans.count().catch(() => 0);
        fallbackDocumentsOasisSpanCount = await fallbackDocumentsOasisSpans.count().catch(() => 0);
        fallbackAnyDocumentsSpanCount = await fallbackAnyDocumentsSpans.count().catch(() => 0);

        resolvedOasisSpan = primaryOasisSpanCount > 0
          ? primaryOasisSpans.first()
          : fallbackDocumentsOasisSpanCount > 0
            ? fallbackDocumentsOasisSpans.first()
            : fallbackAnyDocumentsSpanCount > 0
              ? fallbackAnyDocumentsSpans.first()
              : null;
        resolvedOasisSpanSelector = primaryOasisSpanCount > 0
          ? 'li.notes-sub-menu #documents span:has-text("OASIS")'
          : fallbackDocumentsOasisSpanCount > 0
            ? '#documents span:has-text("OASIS")'
            : fallbackAnyDocumentsSpanCount > 0
              ? 'span:has-text("OASIS")'
              : null;
      }

      if (!resolvedOasisSpan) {
        const globalPrimaryOasisSpans = this.page.locator('li.notes-sub-menu #documents span').filter({ hasText: /^OASIS$/i });
        const globalFallbackDocumentsOasisSpans = this.page.locator('#documents span').filter({ hasText: /OASIS/i });
        const globalPrimaryCount = await globalPrimaryOasisSpans.count().catch(() => 0);
        const globalFallbackDocumentsCount = await globalFallbackDocumentsOasisSpans.count().catch(() => 0);
        if (globalPrimaryCount > 0) {
          resolvedOasisSpan = globalPrimaryOasisSpans.first();
          resolvedOasisSpanSelector = 'li.notes-sub-menu #documents span:has-text("OASIS") [global]';
        } else if (globalFallbackDocumentsCount > 0) {
          resolvedOasisSpan = globalFallbackDocumentsOasisSpans.first();
          resolvedOasisSpanSelector = '#documents span:has-text("OASIS") [global]';
        }
      }

      sidebarResolutionEvidence.push(
        `sidebarResolutionAttempt=${attempt} rootSource=${sidebarRootSource} finSidebarCount=${sidebarContainerCount} primaryOasisSpanCount=${primaryOasisSpanCount} documentsOasisSpanCount=${fallbackDocumentsOasisSpanCount} anyOasisSpanCount=${fallbackAnyDocumentsSpanCount} resolved=${Boolean(resolvedOasisSpan)}`,
      );

      if (resolvedOasisSpan) {
        break;
      }

      if (attempt < 8) {
        await this.page.waitForTimeout(350);
      }
    }

    if (!sidebarRoot) {
      return buildFailureResult({
        message: "OASIS sidebar navigation failed because fin-sidebar-menu was not found.",
        failureReason: "sidebar_root_missing",
        found: [`currentChartUrl:${chartUrl}`],
        missing: ["fin-sidebar-menu"],
        evidence: [
          `fin-sidebar count: ${sidebarContainerCount}`,
          `sidebar diagnostics: ${JSON.stringify(sidebarDiagnostics)}`,
          ...sidebarResolutionEvidence,
        ],
      });
    }

    if (!resolvedOasisSpan) {
      return buildFailureResult({
        message: "OASIS sidebar navigation failed because the OASIS menu label was not found inside fin-sidebar-menu.",
        failureReason: "oasis_label_missing",
        selectorUsed: "fin-sidebar-menu",
        found: [`currentChartUrl:${chartUrl}`],
        missing: ["OASIS sidebar label"],
        evidence: [
          `sidebar root source: ${sidebarRootSource}`,
          `fin-sidebar count: ${sidebarContainerCount}`,
          `sidebar diagnostics: ${JSON.stringify(sidebarDiagnostics)}`,
          `Primary OASIS span count: ${primaryOasisSpanCount}`,
          `#documents OASIS span count: ${fallbackDocumentsOasisSpanCount}`,
          `[id=\"documents\"] OASIS span count: ${fallbackAnyDocumentsSpanCount}`,
          ...sidebarResolutionEvidence,
        ],
      });
    }

    const oasisSpanText = normalizeWhitespace(await resolvedOasisSpan.textContent().catch(() => null));
    const oasisButton = resolvedOasisSpan.locator('xpath=ancestor::div[@id="documents"][1]').first();
    const oasisMenuListItem = resolvedOasisSpan.locator('xpath=ancestor::li[contains(@class,"notes-sub-menu")][1]').first();
    const oasisButtonCount = await oasisButton.count().catch(() => 0);
    const oasisButtonVisible = oasisButtonCount > 0
      ? await oasisButton.isVisible().catch(() => false)
      : false;

    this.options.logger?.info(
      {
        currentChartUrl: chartUrl,
        sidebarRootSource,
        finSidebarCount: sidebarContainerCount,
        sidebarDiagnostics,
        primaryOasisSpanCount,
        fallbackDocumentsOasisSpanCount,
        fallbackAnyDocumentsSpanCount,
        selectedLabel: oasisSpanText,
        selectedSpanSelector: resolvedOasisSpanSelector,
        oasisButtonCount,
        oasisButtonVisible,
      },
      "attempting OASIS sidebar navigation",
    );

    if (oasisButtonCount === 0) {
      return buildFailureResult({
        message: "OASIS sidebar navigation failed because the OASIS parent #documents container could not be resolved.",
        failureReason: "oasis_button_missing",
        selectorUsed: resolvedOasisSpanSelector,
        found: [`selectedLabel:${oasisSpanText || "none"}`],
        missing: ["OASIS parent #documents container"],
        evidence: [
          `Selected span selector: ${resolvedOasisSpanSelector ?? "none"}`,
          `Selected span text: ${oasisSpanText || "none"}`,
          `OASIS button count: ${oasisButtonCount}`,
        ],
      });
    }

    assertReadOnlyActionAllowed({
      safety: this.safety,
      actionClass: "READ_NAV",
      description: "open OASIS documents page from the chart sidebar",
    });
    const verifyOasisDocumentsPageOpen = async (options?: {
      maxAttempts?: number;
      waitMs?: number;
    }): Promise<{
      opened: boolean;
      markers: string[];
      url: string;
      urlDetected: boolean;
      documentsPageDetected: boolean;
        documentListCount: number;
        readyAttemptCount: number;
      }> => {
      const maxAttempts = options?.maxAttempts ?? 8;
      const waitMs = options?.waitMs ?? 500;
      let markers: string[] = [];
      let currentUrl = this.page.url();
      let urlDetected = false;
      let documentsPageDetected = false;
      let documentListCount = 0;
      let readyAttemptCount = 0;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        await waitForPortalPageSettled(this.page, this.options.debugConfig);
        const postClickMarkerResolution = await resolveVisibleLocatorList({
          page: this.page,
          candidates: OASIS_POST_CLICK_MARKERS,
          step: "oasis_post_click_markers",
          logger: this.options.logger,
          debugConfig: this.options.debugConfig,
          maxItems: 8,
        });
        const documentListResolution = await resolveVisibleLocatorList({
          page: this.page,
          candidates: OASIS_DOCUMENT_LIST_SELECTORS,
          step: "oasis_document_list_ready",
          logger: this.options.logger,
          debugConfig: this.options.debugConfig,
          maxItems: 40,
        });

        markers = (
          await Promise.all(
            postClickMarkerResolution.items.map(async (item) =>
              readLocatorLabel(item.locator) ?? item.candidate.description),
          )
        ).filter((value): value is string => Boolean(value));
        currentUrl = this.page.url();
        urlDetected =
          /\/documents\?type=oasis\b/i.test(currentUrl) ||
          /\/documents\b.*\btype=oasis\b/i.test(currentUrl);
        documentsPageDetected = postClickMarkerResolution.items.some((item) =>
          item.candidate.description === "OASIS documents page wrappers" ||
          item.candidate.description === "OASIS documents listview section",
        );
        documentListCount = documentListResolution.items.length;
        readyAttemptCount = attempt;

        this.options.logger?.info(
          {
            readyAttempt: attempt,
            currentUrl,
            urlDetected,
            documentsPageDetected,
            documentListCount,
            markers,
          },
          "waiting for OASIS document page content",
        );

        if (urlDetected || documentsPageDetected || documentListCount > 0) {
          break;
        }

        if (attempt < maxAttempts) {
          await this.page.waitForTimeout(waitMs);
        }
      }

      return {
        opened: urlDetected || documentsPageDetected || documentListCount > 0,
        markers,
        url: currentUrl,
        urlDetected,
        documentsPageDetected,
        documentListCount,
        readyAttemptCount,
      };
    };
    const clickAttemptEvidence: string[] = [];
    let clickMethodUsed = "none";
    let clickSelectorUsed = resolvedOasisSpanSelector;
    let verification = await verifyOasisDocumentsPageOpen({ maxAttempts: 1, waitMs: 50 });
    const clickCandidates: Array<{ selector: string; locator: Locator }> = [
      { selector: 'li.notes-sub-menu #documents', locator: oasisButton },
      { selector: 'li.notes-sub-menu #documents span:has-text("OASIS")', locator: resolvedOasisSpan },
      { selector: 'li.notes-sub-menu:has-text("OASIS")', locator: oasisMenuListItem },
    ];
    const clickMethods: Array<{
      name: string;
      action: (target: Locator) => Promise<void>;
    }> = [
      {
        name: "scrollIntoViewIfNeeded()+click()",
        action: async (target) => {
          await target.scrollIntoViewIfNeeded();
          await target.click();
        },
      },
      {
        name: "click({ force: true })",
        action: async (target) => {
          await target.click({ force: true });
        },
      },
      {
        name: "evaluate(el => el.click())",
        action: async (target) => {
          await target.evaluate((el) => {
            (el as any).click();
          });
        },
      },
    ];

    if (!verification.opened) {
      for (const candidate of clickCandidates) {
        const candidateCount = await candidate.locator.count().catch(() => 0);
        if (candidateCount === 0) {
          clickAttemptEvidence.push(`Candidate ${candidate.selector} count=0`);
          continue;
        }

        const target = candidate.locator.first();
        const visible = await target.isVisible().catch(() => false);
        const text = normalizeWhitespace(await target.textContent().catch(() => null)) || "none";
        const box = await target.boundingBox().catch(() => null);
        const boxText = box
          ? `x=${box.x.toFixed(0)} y=${box.y.toFixed(0)} w=${box.width.toFixed(0)} h=${box.height.toFixed(0)}`
          : "null";
        clickAttemptEvidence.push(
          `Candidate ${candidate.selector} count=${candidateCount} visible=${visible} text=${text} box=${boxText}`,
        );

        if (!visible) {
          continue;
        }

        for (const method of clickMethods) {
          try {
            await method.action(target);
            clickSelectorUsed = candidate.selector;
            clickMethodUsed = `${candidate.selector} :: ${method.name}`;
            verification = await verifyOasisDocumentsPageOpen({ maxAttempts: 2, waitMs: 300 });
            clickAttemptEvidence.push(
              `Attempt ${clickMethodUsed} -> url=${verification.url} opened=${verification.opened} urlDetected=${verification.urlDetected} listCount=${verification.documentListCount}`,
            );
            if (verification.opened) {
              break;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            clickAttemptEvidence.push(`Attempt ${candidate.selector} :: ${method.name} error=${message}`);
          }
        }

        if (verification.opened) {
          break;
        }
      }
    }

    if (!verification.opened) {
      verification = await verifyOasisDocumentsPageOpen();
    }

    const postClickMarkers = verification.markers;
    const documentsPageDetected = verification.documentsPageDetected;
    const oasisDocumentsUrlDetected = verification.urlDetected;
    const documentListCount = verification.documentListCount;
    const opened = verification.opened;

    this.options.logger?.info(
      {
        currentChartUrl: chartUrl,
        selectedLabel: oasisSpanText,
        selectedSpanSelector: resolvedOasisSpanSelector,
        selectedClickSelector: clickSelectorUsed,
        clickMethodUsed,
        postNavigationUrl: verification.url,
        oasisPageMarkers: postClickMarkers,
        oasisDocumentsUrlDetected,
        oasisDocumentsPageDetected: documentsPageDetected,
        oasisDocumentListCount: documentListCount,
        readyAttemptCount: verification.readyAttemptCount,
        oasisMenuClicked: opened,
      },
      opened ? "OASIS sidebar navigation succeeded" : "OASIS sidebar navigation failed",
    );

    const evidence = [
      `Current chart URL: ${chartUrl}`,
      `Sidebar navigation attempted: true`,
      `Selected label: ${oasisSpanText || "none"}`,
      `Selected span selector: ${resolvedOasisSpanSelector ?? "none"}`,
      `Selected click selector: ${clickSelectorUsed ?? "none"}`,
      `Click method used: ${clickMethodUsed}`,
      `Post-navigation URL: ${verification.url}`,
      `OASIS documents URL detected: ${oasisDocumentsUrlDetected}`,
      `OASIS documents page detected: ${documentsPageDetected}`,
      `OASIS document list count: ${documentListCount}`,
      `OASIS content ready attempts: ${verification.readyAttemptCount}`,
      `OASIS page markers: ${postClickMarkers.join(" | ") || "none"}`,
      ...clickAttemptEvidence,
    ];

    if (!opened) {
      return buildFailureResult({
        message: "OASIS sidebar navigation did not open a verifiable OASIS documents page.",
        failureReason: "oasis_documents_page_not_verified",
        selectorUsed: clickSelectorUsed ?? resolvedOasisSpanSelector,
        found: [
          "oasisMenuClicked:false",
          "oasisDocumentListDetected:false",
          "socDocumentFound:false",
          "socDocumentClicked:false",
          `postNavigationUrl:${verification.url}`,
        ],
        missing: ["OASIS documents page"],
        evidence,
      });
    }

    const documentListResolution = await resolveVisibleLocatorList({
      page: this.page,
      candidates: OASIS_DOCUMENT_LIST_SELECTORS,
      step: "oasis_document_list",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      maxItems: 40,
    });
    const listEvidence = documentListResolution.attempts.map(selectorAttemptToEvidence);
    const listItems = documentListResolution.items;

    this.options.logger?.info(
      {
        postClickUrl: verification.url,
        documentListSelectorUsed: listItems[0]?.candidate.description ?? null,
        rowCount: listItems.length,
        oasisMenuClicked: true,
        oasisDocumentListDetected: true,
      },
      "OASIS documents page detected",
    );

    stepLogs.push(createAutomationStepLog({
      step: "oasis_menu",
      message: "Opened the OASIS documents page from the in-app sidebar and verified it opened.",
      urlBefore: chartUrl,
      urlAfter: verification.url,
      selectorUsed: clickSelectorUsed ?? resolvedOasisSpanSelector,
      found: postClickMarkers,
      missing: [],
      evidence: [
        ...evidence,
        ...listEvidence,
        `Final URL: ${verification.url}`,
        `OASIS documents rows detected: ${listItems.length}`,
      ],
      safeReadConfirmed: true,
    }));
    stepLogs.push(createAutomationStepLog({
      step: "qa_summary",
      message: "Active OASIS workflow confirmed the OASIS documents page is open.",
      urlBefore: chartUrl,
      urlAfter: verification.url,
      selectorUsed: clickSelectorUsed ?? resolvedOasisSpanSelector,
      found: [
        "oasisMenuClicked:true",
        "oasisDocumentListDetected:true",
        "socDocumentFound:false",
        "socDocumentClicked:false",
      ],
      missing: [],
      evidence: [
        ...evidence,
        ...listEvidence,
        `OASIS menu clicked: true`,
        `OASIS documents page detected: true`,
        `Final URL: ${verification.url}`,
      ],
      safeReadConfirmed: true,
    }));
    this.options.logger?.info(
      {
        qaSummarySignals: [
          "oasisMenuClicked:true",
          "oasisDocumentListDetected:true",
        ],
        postClickUrl: verification.url,
      },
      "qa_summary contents for OASIS documents page open",
    );

    return {
      opened: true,
      oasisMenuClicked: true,
      oasisDocumentListDetected: true,
      socDocumentFound: false,
      socDocumentClicked: false,
      oasisSelectorUsed: clickSelectorUsed ?? resolvedOasisSpanSelector,
      socSelectorUsed: null,
      matchedSocRowText: null,
      matchedSocAnchorText: null,
      stepLogs,
    };
  }

  private async collectVisibleOasisAssessmentTypes(): Promise<string[]> {
    const anchorLocator = this.page.locator(
      "app-private-documents table tbody tr a.tbl-link, fin-datatable table tbody tr a.tbl-link, table tbody tr a.tbl-link, a.tbl-link",
    );
    const count = await anchorLocator.count().catch(() => 0);
    const labels = new Set<string>();

    for (let index = 0; index < Math.min(count, 100); index += 1) {
      const text = normalizeWhitespace(await anchorLocator.nth(index).textContent().catch(() => null)).toUpperCase();
      if (!text) {
        continue;
      }
      if (/\bSOC\b/.test(text)) {
        labels.add("SOC");
      }
      if (/\bROC\b/.test(text)) {
        labels.add("ROC");
      }
      if (/\bREC\b|\bRECERT/i.test(text)) {
        labels.add("RECERT");
      }
      if (/\bDC\b|\bDISCHARGE\b/i.test(text)) {
        labels.add("DC");
      }
    }

    return [...labels];
  }

  private async openSocDocumentFromOasisTable(input: {
    chartUrl: string;
    oasisSelectorUsed: string | null;
  }): Promise<{
    opened: boolean;
    socDocumentFound: boolean;
    socDocumentClicked: boolean;
    socSelectorUsed: string | null;
    matchedSocRowText: string | null;
    matchedSocAnchorText: string | null;
    stepLogs: AutomationStepLog[];
  }> {
    await waitForPortalPageSettled(this.page, this.options.debugConfig);
    const stepLogs: AutomationStepLog[] = [];
    const tableRows = this.page.locator("app-private-documents table tbody tr, fin-datatable table tbody tr, table tbody tr");
    const totalTableRowCount = await tableRows.count().catch(() => 0);
    const tableAnchors = this.page.locator(
      "app-private-documents table tbody tr a.tbl-link, fin-datatable table tbody tr a.tbl-link, table tbody tr a.tbl-link, a.tbl-link",
    );
    const totalAnchorCount = await tableAnchors.count().catch(() => 0);
    const allAnchorTexts: string[] = [];
    const normalizedAnchorTexts: string[] = [];
    const anchorScanLimit = Math.min(totalAnchorCount, 100);

    for (let index = 0; index < anchorScanLimit; index += 1) {
      const anchorText = normalizeWhitespace(await tableAnchors.nth(index).textContent().catch(() => null));
      if (anchorText) {
        allAnchorTexts.push(anchorText);
        normalizedAnchorTexts.push(anchorText.toUpperCase());
      }
    }

    this.options.logger?.info(
      {
        postClickUrl: this.page.url(),
        totalTableRowCount,
        totalTblLinkAnchorCount: totalAnchorCount,
        allAnchorTexts,
        normalizedAnchorTexts,
      },
      "OASIS document anchors collected",
    );

    const listResolution = await resolveVisibleLocatorList({
      page: this.page,
      candidates: OASIS_DOCUMENT_LIST_SELECTORS,
      step: "oasis_document_list",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      maxItems: 40,
    });
    const listEvidence = listResolution.attempts.map(selectorAttemptToEvidence);
    const listItems = listResolution.items;
    let failureReason: string | null = null;

    if (listItems.length === 0 && totalTableRowCount === 0 && totalAnchorCount === 0) {
      failureReason = "oasis_document_table_unavailable";
      const evidence = [
        ...listEvidence,
        `Total table tbody tr count: ${totalTableRowCount}`,
        `Total a.tbl-link anchor count: ${totalAnchorCount}`,
        `All anchor texts: ${allAnchorTexts.join(" | ") || "none"}`,
        `Normalized anchor texts: ${normalizedAnchorTexts.join(" | ") || "none"}`,
        `Post-click URL: ${this.page.url()}`,
      ];
      this.options.logger?.warn(
        {
          totalTableRowCount,
          totalTblLinkAnchorCount: totalAnchorCount,
          allAnchorTexts,
          normalizedAnchorTexts,
          failureReason,
          socDocumentFound: false,
          socDocumentClicked: false,
        },
        "SOC step failed before table rows were available",
      );
      stepLogs.push(createAutomationStepLog({
        step: "oasis_soc_document",
        message: "OASIS documents page was not verifiable before SOC selection.",
        urlBefore: input.chartUrl,
        urlAfter: this.page.url(),
        selectorUsed: input.oasisSelectorUsed,
        missing: ["OASIS document table/list"],
        evidence,
        safeReadConfirmed: true,
      }));
      stepLogs.push(createAutomationStepLog({
        step: "qa_summary",
        message: "OASIS workflow stopped because the OASIS document table/list was not available for SOC selection.",
        urlBefore: input.chartUrl,
        urlAfter: this.page.url(),
        selectorUsed: input.oasisSelectorUsed,
        found: [
          "oasisMenuClicked:true",
          "oasisDocumentListDetected:false",
          "socDocumentFound:false",
          "socDocumentClicked:false",
          `failureReason:${failureReason}`,
        ],
        missing: ["OASIS document table/list", "SOC document click"],
        evidence,
        safeReadConfirmed: true,
      }));
      return {
        opened: false,
        socDocumentFound: false,
        socDocumentClicked: false,
        socSelectorUsed: null,
        matchedSocRowText: null,
        matchedSocAnchorText: null,
        stepLogs,
      };
    }

    const candidateSocAnchors: Array<{
      rowText: string;
      anchorText: string;
      anchor: Locator;
      selectorUsed: string;
      score: number;
    }> = [];

    for (let index = 0; index < anchorScanLimit; index += 1) {
      const anchor = tableAnchors.nth(index);
      if (!(await anchor.isVisible().catch(() => false))) {
        continue;
      }

      const anchorText = normalizeWhitespace(await anchor.textContent().catch(() => null));
      if (!anchorText) {
        continue;
      }

      const normalizedAnchorText = anchorText.toUpperCase();
      if (!/\bSOC\b/.test(normalizedAnchorText) && !/SOC/.test(normalizedAnchorText)) {
        continue;
      }

      const row = anchor.locator("xpath=ancestor::tr[1]").first();
      const rowText = normalizeWhitespace(await row.textContent().catch(() => null));

      let score = 0;
      if (/\bSOC\b/.test(normalizedAnchorText)) {
        score += 50;
      } else if (/SOC/.test(normalizedAnchorText)) {
        score += 20;
      }
      if (/OASIS/.test(normalizedAnchorText) && /\bSOC\b/.test(normalizedAnchorText)) {
        score += 40;
      }
      if (/PT\s+SOC/.test(normalizedAnchorText)) {
        score += 20;
      }
      if (/OASIS.*SOC|SOC.*OASIS/.test(normalizedAnchorText)) {
        score += 10;
      }
      score += Math.max(0, 100 - index);

      candidateSocAnchors.push({
        rowText,
        anchorText,
        anchor,
        selectorUsed: "table tbody tr a.tbl-link",
        score,
      });
    }

    this.options.logger?.info(
      {
        postClickUrl: this.page.url(),
        documentListSelectorUsed: listItems[0]?.candidate.description ?? null,
        totalTableRowCount,
        totalTblLinkAnchorCount: totalAnchorCount,
        allAnchorTexts,
        normalizedAnchorTexts,
        socCandidateCount: candidateSocAnchors.length,
        rankedSocCandidateTexts: candidateSocAnchors
          .slice()
          .sort((left, right) => right.score - left.score || left.anchorText.localeCompare(right.anchorText))
          .slice(0, 10)
          .map((candidate) => candidate.anchorText),
        socCandidates: candidateSocAnchors.slice(0, 10).map((candidate) => ({
          rowText: candidate.rowText,
          anchorText: candidate.anchorText,
          selectorUsed: candidate.selectorUsed,
          score: candidate.score,
        })),
      },
      "OASIS document table/list detected",
    );

    if (candidateSocAnchors.length === 0) {
      failureReason = "no_soc_anchor_found";
      const combinedEvidence = [
        ...listEvidence,
        `Total table tbody tr count: ${totalTableRowCount}`,
        `Total a.tbl-link anchor count: ${totalAnchorCount}`,
        `All anchor texts: ${allAnchorTexts.join(" | ") || "none"}`,
        `Normalized anchor texts: ${normalizedAnchorTexts.join(" | ") || "none"}`,
        `Visible document rows inspected: ${listItems.length}`,
      ];
      stepLogs.push(createAutomationStepLog({
        step: "oasis_soc_document",
        message: "OASIS document table was visible, but no SOC anchor was found.",
        urlBefore: input.chartUrl,
        urlAfter: this.page.url(),
        selectorUsed: "table tbody tr a.tbl-link",
        missing: ["SOC OASIS document anchor"],
        evidence: combinedEvidence,
        safeReadConfirmed: true,
      }));
      stepLogs.push(createAutomationStepLog({
        step: "qa_summary",
        message: "OASIS workflow stopped because no SOC OASIS anchor was found in the OASIS table/list.",
        urlBefore: input.chartUrl,
        urlAfter: this.page.url(),
        selectorUsed: "table tbody tr a.tbl-link",
        found: [
          "oasisMenuClicked:true",
          "oasisDocumentListDetected:true",
          "socDocumentFound:false",
          "socDocumentClicked:false",
          `failureReason:${failureReason}`,
        ],
        missing: ["SOC OASIS document anchor"],
        evidence: combinedEvidence,
        safeReadConfirmed: true,
      }));
      this.options.logger?.warn(
        {
          totalTableRowCount,
          totalTblLinkAnchorCount: totalAnchorCount,
          allAnchorTexts,
          normalizedAnchorTexts,
          socCandidateCount: candidateSocAnchors.length,
          rankedSocCandidateTexts: [],
          chosenSocAnchorText: null,
          socDocumentFound: false,
          socDocumentClicked: false,
          failureReason,
        },
        "active OASIS workflow failed to locate SOC in the OASIS table",
      );
      return {
        opened: false,
        socDocumentFound: false,
        socDocumentClicked: false,
        socSelectorUsed: listItems[0]?.candidate.description ?? null,
        matchedSocRowText: null,
        matchedSocAnchorText: null,
        stepLogs,
      };
    }

    candidateSocAnchors.sort((left, right) => right.score - left.score || left.anchorText.localeCompare(right.anchorText));
    const matchedSoc = candidateSocAnchors[0]!;
    const socClickTargetSummary = await summarizeClickTarget(matchedSoc.anchor);
    const socUrlBeforeClick = this.page.url();
    const rankedSocCandidateTexts = candidateSocAnchors.slice(0, 10).map((candidate) => candidate.anchorText);
    const clickMethodUsed = "clickReadOnlyTarget(a.tbl-link)";
    this.options.logger?.info(
      {
        totalTableRowCount,
        totalTblLinkAnchorCount: totalAnchorCount,
        allAnchorTexts,
        normalizedAnchorTexts,
        socCandidateCount: candidateSocAnchors.length,
        rankedSocCandidateTexts,
        chosenSocAnchorText: matchedSoc.anchorText,
        matchedSocRowText: matchedSoc.rowText,
        matchedSocAnchorText: matchedSoc.anchorText,
        socDocumentFound: true,
        socDocumentFoundEmitted: true,
        socSelectorUsed: matchedSoc.selectorUsed,
      },
      "SOC document found",
    );
    await clickReadOnlyTarget({
      locator: matchedSoc.anchor,
      page: this.page,
      debugConfig: this.options.debugConfig,
    });
    this.options.logger?.info(
      {
        chosenSocAnchorText: matchedSoc.anchorText,
        matchedSocAnchorText: matchedSoc.anchorText,
        socSelectorUsed: matchedSoc.selectorUsed,
        socClickTargetSummary,
        clickMethodUsed,
        postClickUrl: this.page.url(),
      },
      "SOC anchor clicked",
    );

    const socPostClickMarkerResolution = await resolveVisibleLocatorList({
      page: this.page,
      candidates: SOC_DOCUMENT_OPEN_MARKERS,
      step: "soc_document_open_markers",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      maxItems: 8,
    });
    const socPostClickMarkers = (
      await Promise.all(socPostClickMarkerResolution.items.map(async (item) =>
        readLocatorLabel(item.locator) ?? item.candidate.description,
      ))
    ).filter((value): value is string => Boolean(value));
    const socUrlChanged = this.page.url() !== socUrlBeforeClick;
    const socOpened = socPostClickMarkers.length > 0 || socUrlChanged;
    failureReason = socOpened ? null : "soc_click_open_verification_failed";
    this.options.logger?.info(
      {
        chosenSocAnchorText: matchedSoc.anchorText,
        clickMethodUsed,
        postClickUrl: this.page.url(),
        postClickMarkers: socPostClickMarkers,
        socDocumentFound: true,
        socDocumentClicked: socOpened,
        socDocumentClickedEmitted: socOpened,
        failureReason,
      },
      "post-click SOC page markers found",
    );

    const socEvidence = [
      ...listEvidence,
      ...socPostClickMarkerResolution.attempts.map(selectorAttemptToEvidence),
      `Total table tbody tr count: ${totalTableRowCount}`,
      `Total a.tbl-link anchor count: ${totalAnchorCount}`,
      `All anchor texts: ${allAnchorTexts.join(" | ") || "none"}`,
      `Normalized anchor texts: ${normalizedAnchorTexts.join(" | ") || "none"}`,
      `Candidate SOC anchors found: ${candidateSocAnchors.length}`,
      `Ranked SOC candidate texts: ${rankedSocCandidateTexts.join(" | ") || "none"}`,
      `Chosen SOC anchor text: ${matchedSoc.anchorText}`,
      `socDocumentFound emitted: true`,
      `Matched SOC row text: ${matchedSoc.rowText}`,
      `Matched SOC anchor text: ${matchedSoc.anchorText}`,
      `Clicked selector/container: ${matchedSoc.selectorUsed} -> ${socClickTargetSummary}`,
      `Click method used: ${clickMethodUsed}`,
      `Post-click URL: ${this.page.url()}`,
      `Post-click markers: ${socPostClickMarkers.join(" | ") || "none"}`,
      `socDocumentClicked emitted: ${socOpened}`,
      ...(failureReason ? [`failureReason:${failureReason}`] : []),
      ...candidateSocAnchors.slice(0, 10).map((candidate, index) =>
        `socCandidate[${index + 1}] score=${candidate.score} anchor='${candidate.anchorText}' row='${candidate.rowText}' selector='${candidate.selectorUsed}'`,
      ),
    ];

    stepLogs.push(createAutomationStepLog({
      step: "oasis_soc_document",
      message: socOpened
        ? "Clicked the SOC OASIS document anchor from the OASIS document list."
        : "Clicked the matched SOC OASIS document anchor, but could not verify a resulting UI change.",
      urlBefore: socUrlBeforeClick,
      urlAfter: this.page.url(),
      selectorUsed: matchedSoc.selectorUsed,
      found: socPostClickMarkers,
      missing: socOpened ? [] : ["verified SOC document open state"],
      openedDocumentLabel: matchedSoc.anchorText,
      evidence: socEvidence,
      safeReadConfirmed: true,
    }));
    stepLogs.push(createAutomationStepLog({
      step: "qa_summary",
      message: `SOC document selection summary: socDocumentFound=true, socDocumentClicked=${socOpened}.`,
      urlBefore: input.chartUrl,
      urlAfter: this.page.url(),
      selectorUsed: matchedSoc.selectorUsed,
      found: [
        `oasisMenuClicked:true`,
        `oasisDocumentListDetected:true`,
        `socDocumentFound:true`,
        `socDocumentClicked:${socOpened}`,
        `postClickUrl:${this.page.url()}`,
        ...(failureReason ? [`failureReason:${failureReason}`] : []),
      ],
      missing: socOpened ? [] : ["verified SOC document open state"],
      evidence: socEvidence,
      safeReadConfirmed: true,
    }));
    this.options.logger?.info(
      {
        matchedSocRowText: matchedSoc.rowText,
        matchedSocAnchorText: matchedSoc.anchorText,
        totalTableRowCount,
        totalTblLinkAnchorCount: totalAnchorCount,
        rankedSocCandidateTexts,
        chosenSocAnchorText: matchedSoc.anchorText,
        socDocumentFound: true,
        socDocumentClicked: socOpened,
        socDocumentFoundEmitted: true,
        socDocumentClickedEmitted: socOpened,
        failureReason,
        qaSummarySignals: [
          "oasisMenuClicked:true",
          "oasisDocumentListDetected:true",
          "socDocumentFound:true",
          `socDocumentClicked:${socOpened}`,
        ],
      },
      "qa_summary contents for active OASIS workflow",
    );

    return {
      opened: socOpened,
      socDocumentFound: true,
      socDocumentClicked: socOpened,
      socSelectorUsed: matchedSoc.selectorUsed,
      matchedSocRowText: matchedSoc.rowText,
      matchedSocAnchorText: matchedSoc.anchorText,
      stepLogs,
    };
  }

  private async detectOasisSocLockState(input: {
    chartUrl: string;
    socSelectorUsed: string | null;
    matchedSocAnchorText: string | null;
  }): Promise<{
    lockState: OasisLockStateSnapshot | null;
    stepLogs: AutomationStepLog[];
  }> {
    await waitForPortalPageSettled(this.page, this.options.debugConfig);
    const stepLogs: AutomationStepLog[] = [];

    const lockState = await detectOasisLockState({
      page: this.page,
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
    });

    this.options.logger?.info(
      {
        postSocUrl: this.page.url(),
        socSelectorUsed: input.socSelectorUsed,
        matchedSocAnchorText: input.matchedSocAnchorText,
        oasisLockState: lockState.oasisLockState,
        unlockControlVisible: lockState.unlockControlVisible,
        unlockControlText: lockState.unlockControlText,
        fieldsEditable: lockState.fieldsEditable,
        verificationOnly: lockState.verificationOnly,
        inputEligible: lockState.inputEligible,
      },
      "OASIS SOC lock state detected",
    );

    stepLogs.push(createAutomationStepLog({
      step: "oasis_lock_state_detected",
      message:
        lockState.oasisLockState === "locked"
          ? "Detected a locked OASIS SOC note after routing to the SOC page; continuing in verification-only mode."
          : lockState.oasisLockState === "unlocked"
            ? "Detected an unlocked OASIS SOC note after routing to the SOC page; the workflow is input-capable but live writes remain disabled."
            : "OASIS SOC lock state could not be confirmed after routing to the SOC page; defaulting to verification-only mode.",
      urlBefore: input.chartUrl,
      urlAfter: this.page.url(),
      selectorUsed: input.socSelectorUsed,
      found: [
        `oasis_lock_state_detected:${lockState.oasisLockState}`,
        `unlockControlVisible:${lockState.unlockControlVisible}`,
        `unlockControlText:${lockState.unlockControlText ?? "none"}`,
        `fieldsEditable:${lockState.fieldsEditable}`,
        `verificationOnly:${lockState.verificationOnly}`,
        `inputEligible:${lockState.inputEligible}`,
      ],
      missing: lockState.oasisLockState === "unknown" ? ["confirmed OASIS lock state"] : [],
      evidence: [
        `SOC selector used: ${input.socSelectorUsed ?? "none"}`,
        `SOC anchor text: ${input.matchedSocAnchorText ?? "none"}`,
        ...lockState.selectorEvidence.slice(0, 30),
        ...lockState.notes,
      ],
      safeReadConfirmed: true,
    }));

    return {
      lockState,
      stepLogs,
    };
  }

  private async openActiveDiagnosesSectionFromSocForm(input: {
    chartUrl: string;
    socSelectorUsed: string | null;
    matchedSocAnchorText: string | null;
    lockState: OasisLockStateSnapshot | null;
  }): Promise<{
    diagnosisSectionOpened: boolean;
    diagnosisListFound: boolean;
    diagnosisNavigationMethod: string | null;
    diagnosisListSamples: string[];
    diagnosisPageSnapshot: OasisDiagnosisPageSnapshot | null;
    lockState: OasisLockStateSnapshot | null;
    stepLogs: AutomationStepLog[];
  }> {
    await waitForPortalPageSettled(this.page, this.options.debugConfig);
    const stepLogs: AutomationStepLog[] = [];
    const evidence: string[] = [];
    let failureReason: string | null = null;
    let diagnosisNavigationMethod: string | null = null;
    let diagnosisPageSnapshot: OasisDiagnosisPageSnapshot | null = null;
    let lockState = input.lockState;

    const socMarkerResolution = await resolveVisibleLocatorList({
      page: this.page,
      candidates: SOC_DOCUMENT_OPEN_MARKERS,
      step: "soc_markers_before_diagnosis_navigation",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      maxItems: 8,
    });
    evidence.push(...socMarkerResolution.attempts.map(selectorAttemptToEvidence));

    const evaluateDiagnosisState = async () => {
      const activeSelectionResolution = await resolveVisibleLocatorList({
        page: this.page,
        candidates: OASIS_ACTIVE_DIAGNOSES_SELECTED_MARKERS,
        step: "oasis_active_diagnoses_selected_markers",
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
        maxItems: 8,
      });
      const sectionResolution = await resolveVisibleLocatorList({
        page: this.page,
        candidates: OASIS_DIAGNOSIS_SECTION_MARKERS,
        step: "oasis_diagnosis_section_markers",
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
        maxItems: 10,
      });
      const listResolution = await resolveVisibleLocatorList({
        page: this.page,
        candidates: OASIS_DIAGNOSIS_LIST_SELECTORS,
        step: "oasis_diagnosis_list_markers",
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
        maxItems: 10,
      });

      const sectionSamples = (
        await Promise.all(
          sectionResolution.items.slice(0, 6).map(async (item) =>
            readLocatorLabel(item.locator) ?? item.candidate.description),
        )
      ).filter((value): value is string => Boolean(value));
      const listSamples = (
        await Promise.all(
          listResolution.items.slice(0, 6).map(async (item) =>
            readLocatorLabel(item.locator) ?? item.candidate.description),
        )
      ).filter((value): value is string => Boolean(value));

      return {
        activeSelectionResolution,
        sectionResolution,
        listResolution,
        activeDiagnosesSelected: activeSelectionResolution.items.length > 0,
        diagnosisSectionOpened: activeSelectionResolution.items.length > 0,
        diagnosisListFound: listResolution.items.length > 0,
        diagnosisSectionSamples: sectionSamples,
        diagnosisListSamples: listSamples,
        firstSectionLocator: sectionResolution.items[0]?.locator ?? null,
      };
    };

    let diagnosisState = await evaluateDiagnosisState();
    evidence.push(...diagnosisState.activeSelectionResolution.attempts.map(selectorAttemptToEvidence));
    evidence.push(...diagnosisState.sectionResolution.attempts.map(selectorAttemptToEvidence));
    evidence.push(...diagnosisState.listResolution.attempts.map(selectorAttemptToEvidence));
    if (diagnosisState.activeDiagnosesSelected) {
      diagnosisNavigationMethod = "already_active_diagnoses";
    }

    if (!diagnosisState.activeDiagnosesSelected) {
      const dropdownResolution = await resolveFirstVisibleLocator({
        page: this.page,
        candidates: OASIS_SECTION_DROPDOWN_SELECTORS,
        step: "oasis_section_dropdown_root",
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
        settle: () => waitForPortalPageSettled(this.page, this.options.debugConfig),
      });
      evidence.push(...dropdownResolution.attempts.map(selectorAttemptToEvidence));

      if (dropdownResolution.locator && dropdownResolution.matchedCandidate) {
        const triggerResolution = await resolveFirstVisibleLocator({
          page: dropdownResolution.locator,
          candidates: OASIS_SECTION_DROPDOWN_TRIGGER_SELECTORS,
          step: "oasis_section_dropdown_trigger",
          logger: this.options.logger,
          debugConfig: this.options.debugConfig,
        });
        evidence.push(...triggerResolution.attempts.map(selectorAttemptToEvidence));
        const dropdownTrigger = triggerResolution.locator ?? dropdownResolution.locator;

        await clickReadOnlyTarget({
          locator: dropdownTrigger,
          page: this.page,
          debugConfig: this.options.debugConfig,
        });
        await waitForPortalPageSettled(this.page, this.options.debugConfig);

        const optionResolution = await resolveFirstVisibleLocator({
          page: this.page,
          candidates: OASIS_ACTIVE_DIAGNOSES_OPTION_SELECTORS,
          step: "oasis_active_diagnoses_option",
          logger: this.options.logger,
          debugConfig: this.options.debugConfig,
          settle: () => waitForPortalPageSettled(this.page, this.options.debugConfig),
        });
        evidence.push(...optionResolution.attempts.map(selectorAttemptToEvidence));

        if (optionResolution.locator && optionResolution.matchedCandidate) {
          const optionTarget = optionResolution.locator.locator("xpath=ancestor::div[contains(@class,'ng-option')][1]").first();
          const optionTargetCount = await optionTarget.count().catch(() => 0);
          await clickReadOnlyTarget({
            locator: optionTargetCount > 0 ? optionTarget : optionResolution.locator,
            page: this.page,
            debugConfig: this.options.debugConfig,
          });
          diagnosisNavigationMethod = "dropdown_active_diagnoses";
          await waitForPortalPageSettled(this.page, this.options.debugConfig);
          diagnosisState = await evaluateDiagnosisState();
          evidence.push(...diagnosisState.activeSelectionResolution.attempts.map(selectorAttemptToEvidence));
          evidence.push(...diagnosisState.sectionResolution.attempts.map(selectorAttemptToEvidence));
          evidence.push(...diagnosisState.listResolution.attempts.map(selectorAttemptToEvidence));
        }
      }
    }

    if (!diagnosisState.activeDiagnosesSelected) {
      const chevronResolution = await resolveFirstVisibleLocator({
        page: this.page,
        candidates: OASIS_SECTION_CHEVRON_RIGHT_SELECTORS,
        step: "oasis_section_chevron_right",
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
      });
      evidence.push(...chevronResolution.attempts.map(selectorAttemptToEvidence));

      if (chevronResolution.locator && chevronResolution.matchedCandidate) {
        for (let attempt = 1; attempt <= 4; attempt += 1) {
          await clickReadOnlyTarget({
            locator: chevronResolution.locator,
            page: this.page,
            debugConfig: this.options.debugConfig,
          });
          await waitForPortalPageSettled(this.page, this.options.debugConfig);
          diagnosisState = await evaluateDiagnosisState();
          evidence.push(...diagnosisState.activeSelectionResolution.attempts.map(selectorAttemptToEvidence));
          evidence.push(
            `chevronRightAttempt:${attempt} activeDiagnosesSelected:${diagnosisState.activeDiagnosesSelected} diagnosisSectionOpened:${diagnosisState.diagnosisSectionOpened} diagnosisListFound:${diagnosisState.diagnosisListFound}`,
          );
          if (diagnosisState.activeDiagnosesSelected) {
            diagnosisNavigationMethod = `chevron_right_attempt_${attempt}`;
            break;
          }
        }
      }
    }

    if (diagnosisState.firstSectionLocator) {
      await diagnosisState.firstSectionLocator.scrollIntoViewIfNeeded().catch(() => undefined);
      await this.page.mouse.wheel(0, 500).catch(() => undefined);
      await waitForPortalPageSettled(this.page, this.options.debugConfig);
      const listAfterScroll = await resolveVisibleLocatorList({
        page: this.page,
        candidates: OASIS_DIAGNOSIS_LIST_SELECTORS,
        step: "oasis_diagnosis_list_after_scroll",
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
        maxItems: 10,
      });
      evidence.push(...listAfterScroll.attempts.map(selectorAttemptToEvidence));
      if (!diagnosisState.diagnosisListFound && listAfterScroll.items.length > 0) {
        const samples = (
          await Promise.all(
            listAfterScroll.items.slice(0, 6).map(async (item) =>
              readLocatorLabel(item.locator) ?? item.candidate.description),
          )
        ).filter((value): value is string => Boolean(value));
        diagnosisState = {
          ...diagnosisState,
          diagnosisListFound: true,
          diagnosisListSamples: samples,
        };
      }
    }

    if (!diagnosisState.activeDiagnosesSelected) {
      failureReason = "active_diagnoses_not_selected";
    }

    const diagnosisListStatus = diagnosisState.diagnosisListFound
      ? "FOUND"
      : diagnosisState.diagnosisSectionOpened
        ? "EMPTY_OR_NOT_VISIBLE"
        : "UNAVAILABLE";

    if (diagnosisState.diagnosisSectionOpened) {
      try {
        diagnosisPageSnapshot = await inspectOasisDiagnosisPage({
          page: this.page,
          logger: this.options.logger,
          debugConfig: this.options.debugConfig,
        });
        if (lockState) {
          lockState = refineOasisLockStateWithDiagnosisSnapshot({
            lockState,
            diagnosisPageSnapshot,
          });
        }
        evidence.push(
          `Diagnosis snapshot captured: rows=${diagnosisPageSnapshot.rows.length} selectorEvidenceCount=${diagnosisPageSnapshot.selectorEvidence.length}`,
        );
        evidence.push(
          `Diagnosis snapshot warnings: ${diagnosisPageSnapshot.extractionWarnings.join(" | ") || "none"}`,
        );
        evidence.push(
          `Diagnosis snapshot counts: existingRows=${diagnosisPageSnapshot.page.existingDiagnosisRowCount} emptyEditableSlots=${diagnosisPageSnapshot.page.emptyEditableSlotCount} emptyReadonlySlots=${diagnosisPageSnapshot.page.emptyReadonlySlotCount} visibleEditableSlots=${diagnosisPageSnapshot.page.visibleEditableSlotCount}`,
        );
        evidence.push(
          `oasisLockState:${lockState?.oasisLockState ?? "none"} unlockControlVisible:${lockState?.unlockControlVisible ?? false} fieldsEditable:${lockState?.fieldsEditable ?? false} verificationOnly:${lockState?.verificationOnly ?? true} inputEligible:${lockState?.inputEligible ?? false}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        evidence.push(`Diagnosis snapshot capture failed: ${message}`);
        diagnosisPageSnapshot = createEmptyOasisDiagnosisPageSnapshot({
          page: this.page,
          extractionWarnings: [`Diagnosis snapshot capture failed after Active Diagnoses navigation: ${message}`],
          mappingNotes: [
            "Fallback snapshot emitted after Active Diagnoses was reached but DOM inspection failed.",
          ],
        });
      }
    }

    this.options.logger?.info(
      {
        postSocUrl: this.page.url(),
        socSelectorUsed: input.socSelectorUsed,
        matchedSocAnchorText: input.matchedSocAnchorText,
        diagnosisNavigationMethod,
        activeDiagnosesSelected: diagnosisState.activeDiagnosesSelected,
        diagnosisSectionOpened: diagnosisState.diagnosisSectionOpened,
        diagnosisListFound: diagnosisState.diagnosisListFound,
        diagnosisListStatus,
        diagnosisSectionSamples: diagnosisState.diagnosisSectionSamples,
        diagnosisListSamples: diagnosisState.diagnosisListSamples,
        diagnosisSnapshotRowCount: diagnosisPageSnapshot?.rows.length ?? 0,
        diagnosisSnapshotVisibleEditableSlotCount: diagnosisPageSnapshot?.page.visibleEditableSlotCount ?? 0,
        diagnosisSnapshotEmptyEditableSlotCount: diagnosisPageSnapshot?.page.emptyEditableSlotCount ?? 0,
        oasisLockState: lockState?.oasisLockState ?? null,
        unlockControlVisible: lockState?.unlockControlVisible ?? false,
        unlockControlText: lockState?.unlockControlText ?? null,
        fieldsEditable: lockState?.fieldsEditable ?? false,
        verificationOnly: lockState?.verificationOnly ?? true,
        inputEligible: lockState?.inputEligible ?? false,
        failureReason,
      },
      diagnosisState.diagnosisSectionOpened
        ? "OASIS Active Diagnoses section navigation completed"
        : "OASIS Active Diagnoses section navigation failed",
    );

    const foundSignals = [
      "oasisMenuClicked:true",
      "oasisDocumentListDetected:true",
      "socDocumentFound:true",
      "socDocumentClicked:true",
      `activeDiagnosesSelected:${diagnosisState.activeDiagnosesSelected}`,
      `diagnosisSectionOpened:${diagnosisState.diagnosisSectionOpened}`,
      `diagnosisListFound:${diagnosisState.diagnosisListFound}`,
      `diagnosisListStatus:${diagnosisListStatus}`,
      `diagnosisNavigationMethod:${diagnosisNavigationMethod ?? "none"}`,
      ...(failureReason ? [`failureReason:${failureReason}`] : []),
    ];
    const missingSignals = [
      ...(diagnosisState.activeDiagnosesSelected ? [] : ["Active Diagnoses section"]),
      ...(diagnosisState.diagnosisListFound ? [] : ["Diagnosis list (may be empty on first pass)"]),
    ];
    const diagnosisEvidence = [
      `SOC selector used: ${input.socSelectorUsed ?? "none"}`,
      `SOC anchor text: ${input.matchedSocAnchorText ?? "none"}`,
      `Diagnosis navigation method: ${diagnosisNavigationMethod ?? "none"}`,
      `Active Diagnoses selected: ${diagnosisState.activeDiagnosesSelected}`,
      `Diagnosis section opened: ${diagnosisState.diagnosisSectionOpened}`,
      `Diagnosis list found: ${diagnosisState.diagnosisListFound}`,
      `Diagnosis list status: ${diagnosisListStatus}`,
      `Diagnosis snapshot row count: ${diagnosisPageSnapshot?.rows.length ?? 0}`,
      `Diagnosis snapshot existing rows: ${diagnosisPageSnapshot?.page.existingDiagnosisRowCount ?? 0}`,
      `Diagnosis snapshot empty editable slots: ${diagnosisPageSnapshot?.page.emptyEditableSlotCount ?? 0}`,
      `Diagnosis snapshot visible editable slots: ${diagnosisPageSnapshot?.page.visibleEditableSlotCount ?? 0}`,
      `Diagnosis snapshot warnings: ${diagnosisPageSnapshot?.extractionWarnings.join(" | ") || "none"}`,
      `OASIS lock state: ${lockState?.oasisLockState ?? "none"}`,
      `Unlock control visible: ${lockState?.unlockControlVisible ?? false}`,
      `Unlock control text: ${lockState?.unlockControlText ?? "none"}`,
      `Fields editable: ${lockState?.fieldsEditable ?? false}`,
      `Verification only: ${lockState?.verificationOnly ?? true}`,
      `Input eligible: ${lockState?.inputEligible ?? false}`,
      `Diagnosis section samples: ${diagnosisState.diagnosisSectionSamples.join(" | ") || "none"}`,
      `Diagnosis list samples: ${diagnosisState.diagnosisListSamples.join(" | ") || "none"}`,
      ...evidence,
    ];

    stepLogs.push(createAutomationStepLog({
      step: "oasis_diagnosis_section",
      message: diagnosisState.activeDiagnosesSelected
        ? "Opened OASIS Active Diagnoses section and scanned for diagnosis list."
        : "Could not open OASIS Active Diagnoses section after dropdown/chevron navigation attempts.",
      urlBefore: input.chartUrl,
      urlAfter: this.page.url(),
      selectorUsed: input.socSelectorUsed,
      found: foundSignals,
      missing: missingSignals,
      evidence: diagnosisEvidence,
      safeReadConfirmed: true,
    }));
    if (diagnosisPageSnapshot) {
      stepLogs.push(createAutomationStepLog({
        step: "oasis_diagnosis_snapshot",
        message: "Captured read-only diagnosis page snapshot for DOM-aware QA mapping and future autofill planning.",
        urlBefore: input.chartUrl,
        urlAfter: this.page.url(),
        selectorUsed: diagnosisPageSnapshot.page.diagnosisContainerSelector,
        found: [
          `rowCount:${diagnosisPageSnapshot.rows.length}`,
          `existingDiagnosisRowCount:${diagnosisPageSnapshot.page.existingDiagnosisRowCount}`,
          `emptyEditableSlotCount:${diagnosisPageSnapshot.page.emptyEditableSlotCount}`,
          `visibleEditableSlotCount:${diagnosisPageSnapshot.page.visibleEditableSlotCount}`,
          `insertDiagnosisVisible:${diagnosisPageSnapshot.page.insertDiagnosisVisible}`,
          `sectionMarkerCount:${diagnosisPageSnapshot.page.sectionMarkers.length}`,
        ],
        missing: diagnosisPageSnapshot.page.noVisibleDiagnosisControls ? ["diagnosis controls"] : [],
        evidence: [
          ...diagnosisPageSnapshot.selectorEvidence.slice(0, 30),
          `mappingNotes:${diagnosisPageSnapshot.mappingNotes.join(" | ") || "none"}`,
          `extractionWarnings:${diagnosisPageSnapshot.extractionWarnings.join(" | ") || "none"}`,
        ],
        safeReadConfirmed: true,
      }));
    }
    stepLogs.push(createAutomationStepLog({
      step: "qa_summary",
      message: diagnosisState.activeDiagnosesSelected
        ? "Active Diagnoses section reached after SOC open."
        : "Active Diagnoses section was not reached after SOC open.",
      urlBefore: input.chartUrl,
      urlAfter: this.page.url(),
      selectorUsed: input.socSelectorUsed,
      found: foundSignals,
      missing: missingSignals,
      evidence: diagnosisEvidence,
      safeReadConfirmed: true,
    }));

    return {
      diagnosisSectionOpened: diagnosisState.activeDiagnosesSelected,
      diagnosisListFound: diagnosisState.diagnosisListFound,
      diagnosisNavigationMethod,
      diagnosisListSamples: diagnosisState.diagnosisListSamples,
      diagnosisPageSnapshot,
      lockState,
      stepLogs,
    };
  }

  private async openFileUploadsAndAdmissionOrderFromSidebar(input: {
    chartUrl: string;
    outputDirectory: string;
    socSelectorUsed: string | null;
    matchedSocAnchorText: string | null;
    includeOasisSignals?: boolean;
  }): Promise<{
    fileUploadsAccessible: boolean;
    fileUploadsUrl: string | null;
    visibleUploadedDocuments: string[];
    admissionOrderAccessible: boolean;
    admissionOrderTitle: string | null;
    admissionReasonSnippets: string[];
    admissionReasonPrimary: string | null;
    possibleIcd10Codes: string[];
    rawExtractedTextSource: "dom" | "ocr" | "hybrid" | null;
    domExtractionRejectedReasons: string[];
    admissionOrderTextExcerpt: string | null;
    sourcePdfPath: string | null;
    printedPdfPath: string | null;
    sourceMetaPath: string | null;
    extractedTextPath: string | null;
    extractionResultPath: string | null;
    fileUploadsSelectorUsed: string | null;
    admissionOrderSelectorUsed: string | null;
    stepLogs: AutomationStepLog[];
  }> {
    return this.openFileUploadsAndAdmissionOrderFromSidebarRefactored(input);
    /*
    await waitForPortalPageSettled(this.page, this.options.debugConfig);
    const stepLogs: AutomationStepLog[] = [];
    const evidence: string[] = [];
    let fileUploadsSelectorUsed: string | null = null;
    let matchedFileUploadsLabel: string | null = null;
    let matchedFileUploadsHref: string | null = null;
    let fileUploadsSidebarClickSucceeded = false;
    let admissionOrderSelectorUsed: string | null = null;
    let fileUploadsAccessible = false;
    let fileUploadsTraversalMode: "folder_view" | "file_list_view" | "mixed" | "unknown" = "unknown";
    let fileUploadsPageComponentDetected = false;
    let admissionOrderAccessible = false;
    let admissionOrderTitle: string | null = null;
    let admissionOrderTextExcerpt: string | null = null;
    let sourcePdfPath: string | null = null;
    let printedPdfPath: string | null = null;
    let sourceMetaPath: string | null = null;
    let extractedTextPath: string | null = null;
    let extractionResultPath: string | null = null;
    let admissionReasonPrimary: string | null = null;
    let admissionReasonSnippets: string[] = [];
    let possibleIcd10Codes: string[] = [];
    let rawExtractedTextSource: "dom" | "ocr" | "hybrid" | null = null;
    let domExtractionRejectedReasons: string[] = [];
    let selectedSourceFile: string | null = null;
    let selectedSourceFileNormalized: string | null = null;
    let viewerDetected = false;
    let printButtonDetected = false;
    let printButtonVisible = false;
    let printButtonSelectorUsed: string | null = null;
    let printClickSucceeded = false;
    let pdfResponseDetected = false;
    let pdfResponseUrl: string | null = null;
    let pdfContentType: string | null = null;
    let pdfSavedPath: string | null = null;
    let pdfByteSize = 0;
    let printAcquisitionMethodUsed = "none";
    let extractionMethodUsed: "click" | "preview" | "metadata" | null = null;
    let extractionSuccess = false;
    const normalizedFileLabels = new Set<string>();
    const matchedSourceDocuments: Array<{
      label: string;
      normalizedLabel: string;
      score: number;
    }> = [];
    const visibleUploadedDocuments: string[] = [];
    let usedDocUploadsFallback = false;
    let usedChartDocumentsFallback = false;
    const oasisContextSignals = input.includeOasisSignals
      ? [
          "oasisMenuClicked:true",
          "oasisDocumentListDetected:true",
          "socDocumentFound:true",
          "socDocumentClicked:true",
        ]
      : [];
    const withContextSignals = (signals: string[]) => [...oasisContextSignals, ...signals];
    const collectVisibleLabels = async (locator: Locator, limit = 40): Promise<string[]> => {
      const labels: string[] = [];
      const count = Math.min(await locator.count().catch(() => 0), limit);
      for (let index = 0; index < count; index += 1) {
        const item = locator.nth(index);
        if (!(await item.isVisible().catch(() => false))) {
          continue;
        }
        const label = normalizeWhitespace(await item.textContent().catch(() => null));
        if (label) {
          labels.push(label);
        }
      }
      return Array.from(new Set(labels));
    };
    const collectSidebarDebugSnapshot = async (): Promise<void> => {
      const sidebarMenuTexts = await collectVisibleLabels(
        this.page.locator(
          "fini-sidebar span, fin-sidebar span, nav.fin-sidebar__wrapper span, .fin-sidebar__wrapper span",
        ),
        120,
      ).catch(() => []);
      const bodyTextSample = normalizeWhitespace(
        await this.page.locator("body").innerText().catch(() => ""),
      ).slice(0, 1200);
      const pageTitle = await this.page.title().catch(() => "unknown");
      const fileUploadRootCount = await this.page.locator("app-client-file-upload").count().catch(() => 0);
      evidence.push(`Current page URL during File Uploads detection: ${this.page.url()}`);
      evidence.push(`Current page title during File Uploads detection: ${pageTitle}`);
      evidence.push(`app-client-file-upload count during File Uploads detection: ${fileUploadRootCount}`);
      evidence.push(`Visible sidebar labels during File Uploads detection: ${sidebarMenuTexts.join(" | ") || "none"}`);
      evidence.push(`Body text sample during File Uploads detection: ${bodyTextSample || "none"}`);
    };

    const sidebarContainers = this.page.locator("fini-sidebar, fin-sidebar, nav.fin-sidebar__wrapper, .fin-sidebar__wrapper");
    const sidebarContainerCount = await sidebarContainers.count().catch(() => 0);
    let sidebarRoot: Locator | null = null;
    const sidebarDiagnostics: Array<{
      index: number;
      visible: boolean;
      fileUploadsLabelCount: number;
      fileUploadsAnchorCount: number;
    }> = [];

    for (let index = 0; index < sidebarContainerCount; index += 1) {
      const candidate = sidebarContainers.nth(index);
      const visible = await candidate.isVisible().catch(() => false);
      const fileUploadsLabelCount = await candidate.locator("span").filter({ hasText: /^File Uploads$/i }).count().catch(() => 0);
      const fileUploadsAnchorCount = await candidate.locator('a[href*="/file-uploads"]').count().catch(() => 0);
      sidebarDiagnostics.push({
        index,
        visible,
        fileUploadsLabelCount,
        fileUploadsAnchorCount,
      });
      if (!visible) {
        continue;
      }
      if (fileUploadsLabelCount > 0 || fileUploadsAnchorCount > 0) {
        sidebarRoot = candidate;
        break;
      }
      if (!sidebarRoot) {
        sidebarRoot = candidate;
      }
    }
    evidence.push(`Sidebar container count: ${sidebarContainerCount}`);
    evidence.push(`Sidebar diagnostics: ${JSON.stringify(sidebarDiagnostics)}`);
    let fileUploadsLabelResolution: Awaited<ReturnType<typeof resolveFirstVisibleLocator>> | null = null;
    if (!sidebarRoot) {
      evidence.push("File Uploads sidebar root was not resolvable; falling back to chart Documents content.");
    } else {
      const resolveFileUploadsLabel = async (step: string) =>
        resolveFirstVisibleLocator({
          page: sidebarRoot!,
          candidates: FILE_UPLOADS_SIDEBAR_LABEL_SELECTORS,
          step,
          logger: this.options.logger,
          debugConfig: this.options.debugConfig,
          settle: () => waitForPortalPageSettled(this.page, this.options.debugConfig),
        });

      fileUploadsLabelResolution = await resolveFileUploadsLabel("file_uploads_sidebar_label_initial");
      evidence.push(...fileUploadsLabelResolution.attempts.map(selectorAttemptToEvidence));

      if (!fileUploadsLabelResolution.locator) {
        await sidebarRoot.evaluate((el) => {
          (el as any).scrollTop = 0;
        }).catch(() => undefined);
        await waitForPortalPageSettled(this.page, this.options.debugConfig);
        await sidebarRoot.evaluate((el) => {
          (el as any).scrollTop = (el as any).scrollHeight;
        }).catch(() => undefined);
        await waitForPortalPageSettled(this.page, this.options.debugConfig);
        fileUploadsLabelResolution = await resolveFileUploadsLabel("file_uploads_sidebar_label_after_scroll");
        evidence.push(...fileUploadsLabelResolution.attempts.map(selectorAttemptToEvidence));
      }

      if (!fileUploadsLabelResolution.locator) {
        const globalFallback = await resolveFirstVisibleLocator({
          page: this.page,
          candidates: FILE_UPLOADS_SIDEBAR_LABEL_SELECTORS,
          step: "file_uploads_sidebar_label_global_fallback",
          logger: this.options.logger,
          debugConfig: this.options.debugConfig,
          settle: () => waitForPortalPageSettled(this.page, this.options.debugConfig),
        });
        evidence.push(...globalFallback.attempts.map(selectorAttemptToEvidence));
        if (globalFallback.locator && globalFallback.matchedCandidate) {
          fileUploadsLabelResolution = globalFallback;
        }
      }

      if (!fileUploadsLabelResolution.locator || !fileUploadsLabelResolution.matchedCandidate) {
        await collectSidebarDebugSnapshot();
        const docUploadsFallback = await resolveFirstVisibleLocator({
          page: this.page,
          candidates: SOC_DOC_UPLOADS_TRIGGER_SELECTORS,
          step: "soc_doc_uploads_trigger_when_sidebar_file_uploads_missing",
          logger: this.options.logger,
          debugConfig: this.options.debugConfig,
          settle: () => waitForPortalPageSettled(this.page, this.options.debugConfig),
        });
        evidence.push(...docUploadsFallback.attempts.map(selectorAttemptToEvidence));
        if (docUploadsFallback.locator && docUploadsFallback.matchedCandidate) {
          await clickReadOnlyTarget({
            locator: docUploadsFallback.locator,
            page: this.page,
            debugConfig: this.options.debugConfig,
          });
          usedDocUploadsFallback = true;
          fileUploadsSelectorUsed = `Doc Uploads fallback trigger (${docUploadsFallback.matchedCandidate.description})`;
          evidence.push(`File Uploads sidebar label missing; clicked Doc Uploads fallback via ${docUploadsFallback.matchedCandidate.description}`);
        } else {
          evidence.push("File Uploads sidebar label was not found; no Doc Uploads fallback available in current page.");
        }
      }
    }

    if (!usedDocUploadsFallback && (!fileUploadsLabelResolution?.locator || !fileUploadsLabelResolution?.matchedCandidate)) {
      const documentsFallback = await this.ensureDocumentsSectionVisible();
      usedChartDocumentsFallback = true;
      fileUploadsSelectorUsed = fileUploadsSelectorUsed ?? "wrong_context_generic_documents_fallback";
      evidence.push("Attempted chart Documents section fallback because File Uploads menu item was unavailable.");
      if (documentsFallback.log) {
        evidence.push(`Documents fallback step: ${documentsFallback.log.message}`);
        evidence.push(...documentsFallback.log.evidence.slice(0, 12));
      }
      await collectSidebarDebugSnapshot();
    }

    let fileUploadsUrlBeforeClick = this.page.url();
    if (!usedDocUploadsFallback && fileUploadsLabelResolution?.locator && fileUploadsLabelResolution?.matchedCandidate) {
      const resolvedFileUploadsTarget = fileUploadsLabelResolution.locator;
      const resolvedTagName = (await resolvedFileUploadsTarget.evaluate((element) =>
        element.tagName.toLowerCase()).catch(() => ""));
      const ancestorAnchor = resolvedFileUploadsTarget.locator('xpath=ancestor::a[contains(@href,"/file-uploads")][1]').first();
      const ancestorAnchorCount = await ancestorAnchor.count().catch(() => 0);
      const notesSubMenuContainer = resolvedFileUploadsTarget.locator("xpath=ancestor::li[contains(@class,'notes-sub-menu')][1]").first();
      const notesSubMenuContainerCount = await notesSubMenuContainer.count().catch(() => 0);
      const fileUploadsClickTarget = resolvedTagName === "a"
        ? resolvedFileUploadsTarget
        : ancestorAnchorCount > 0
        ? ancestorAnchor
        : notesSubMenuContainerCount > 0
        ? notesSubMenuContainer
        : resolvedFileUploadsTarget;
      fileUploadsSelectorUsed = fileUploadsLabelResolution.matchedCandidate.description;
      matchedFileUploadsLabel = normalizeWhitespace(await resolvedFileUploadsTarget.textContent().catch(() => null)) || "File Uploads";
      matchedFileUploadsHref = await fileUploadsClickTarget.getAttribute("href").catch(() => null);
      fileUploadsUrlBeforeClick = this.page.url();

      await clickReadOnlyTarget({
        locator: fileUploadsClickTarget,
        page: this.page,
        debugConfig: this.options.debugConfig,
      });
      await waitForPortalPageSettled(this.page, this.options.debugConfig);
      fileUploadsSidebarClickSucceeded = isPatientSpecificFileUploadsUrl(this.page.url()) ||
        await this.page.locator("app-client-file-upload").count().catch(() => 0) > 0;
      evidence.push(`Matched File Uploads sidebar label: ${matchedFileUploadsLabel ?? "none"}`);
      evidence.push(`Matched File Uploads sidebar href: ${matchedFileUploadsHref ?? "none"}`);
      evidence.push(`File Uploads sidebar click succeeded: ${fileUploadsSidebarClickSucceeded}`);
      evidence.push(`File Uploads URL after sidebar click: ${this.page.url()}`);
    } else if (usedDocUploadsFallback && !fileUploadsSelectorUsed) {
      fileUploadsSelectorUsed = "Doc Uploads fallback trigger";
    } else if (!fileUploadsSelectorUsed && usedChartDocumentsFallback) {
      fileUploadsSelectorUsed = "wrong_context_generic_documents_fallback";
    }

    const verifyFileUploadsContent = async (stepPrefix: string, maxAttempts: number, waitMs: number): Promise<{
      markers: string[];
      markerResolution: Awaited<ReturnType<typeof resolveVisibleLocatorList>>;
      anchorResolution: Awaited<ReturnType<typeof resolveVisibleLocatorList>>;
      anchorLocators: Locator[];
      pageComponentDetected: boolean;
      traversalMode: "folder_view" | "file_list_view" | "mixed" | "unknown";
      folderLabels: string[];
      fileLabels: string[];
      url: string;
      urlChanged: boolean;
      readyAttemptCount: number;
      ready: boolean;
    }> => {
      let markers: string[] = [];
      let markerResolution = await resolveVisibleLocatorList({
        page: this.page,
        candidates: FILE_UPLOADS_PAGE_MARKERS,
        step: `${stepPrefix}_markers_attempt_1`,
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
        maxItems: 20,
      });
      let anchorResolution = await resolveVisibleLocatorList({
        page: this.page,
        candidates: FILE_UPLOADS_DOCUMENT_ANCHOR_SELECTORS,
        step: `${stepPrefix}_anchors_attempt_1`,
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
        maxItems: 80,
      });
      let anchorLocators = anchorResolution.items.map((item) => item.locator);
      let pageComponentDetected = false;
      let traversalMode: "folder_view" | "file_list_view" | "mixed" | "unknown" = "unknown";
      let folderLabels: string[] = [];
      let fileLabels: string[] = [];
      let url = this.page.url();
      let urlChanged = url !== fileUploadsUrlBeforeClick;
      let readyAttemptCount = 1;
      let ready = false;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        await waitForPortalPageSettled(this.page, this.options.debugConfig);
        markerResolution = await resolveVisibleLocatorList({
          page: this.page,
          candidates: FILE_UPLOADS_PAGE_MARKERS,
          step: `${stepPrefix}_markers_attempt_${attempt}`,
          logger: this.options.logger,
          debugConfig: this.options.debugConfig,
          maxItems: 20,
        });
        anchorResolution = await resolveVisibleLocatorList({
          page: this.page,
          candidates: FILE_UPLOADS_DOCUMENT_ANCHOR_SELECTORS,
          step: `${stepPrefix}_anchors_attempt_${attempt}`,
          logger: this.options.logger,
          debugConfig: this.options.debugConfig,
          maxItems: 80,
        });
        anchorLocators = anchorResolution.items.map((item) => item.locator);
        const fileUploadRoot = this.page.locator("app-client-file-upload");
        const fileUploadRootCount = await fileUploadRoot.count().catch(() => 0);
        const fileUploadRootVisible = fileUploadRootCount > 0 && await fileUploadRoot.first().isVisible().catch(() => false);
        pageComponentDetected = fileUploadRootVisible;
        folderLabels = await collectVisibleLabels(this.page.locator("app-client-file-upload .folder-label, .folder-item .folder-label, .folder-label"));
        fileLabels = await collectVisibleLabels(this.page.locator("app-client-file-upload .file-label, .file-item .file-label, .file-label"));
        const hasFolderView = folderLabels.length > 0;
        const hasFileListView = fileLabels.length > 0;
        traversalMode = hasFolderView && hasFileListView
          ? "mixed"
          : hasFileListView
          ? "file_list_view"
          : hasFolderView
          ? "folder_view"
          : "unknown";
        markers = (
          await Promise.all(
            markerResolution.items.slice(0, 8).map(async (item) =>
              readLocatorLabel(item.locator) ?? item.candidate.description),
          )
        ).filter((value): value is string => Boolean(value));
        url = this.page.url();
        urlChanged = url !== fileUploadsUrlBeforeClick;
        readyAttemptCount = attempt;
        const patientFileUploadsRouteDetected = isPatientSpecificFileUploadsUrl(url);
        const genericProviderDocumentsRouteDetected = isGenericProviderDocumentsUrl(url);
        const admissionMarkerVisible = markers.some((marker) =>
          /Admission\s+Order|Admission\s+Info|Admission\s+Packets/i.test(marker),
        );
        ready =
          pageComponentDetected ||
          folderLabels.length > 0 ||
          fileLabels.length > 0 ||
          (patientFileUploadsRouteDetected && anchorLocators.length > 0) ||
          admissionMarkerVisible ||
          patientFileUploadsRouteDetected;
        evidence.push(
          `File Uploads ready attempt=${attempt} url=${url} urlChanged=${urlChanged} patientFileUploadsRouteDetected=${patientFileUploadsRouteDetected} genericProviderDocumentsRouteDetected=${genericProviderDocumentsRouteDetected} pageComponentDetected=${pageComponentDetected} traversalMode=${traversalMode} folderCount=${folderLabels.length} fileCount=${fileLabels.length} markers=${markers.join(" | ") || "none"} anchorCount=${anchorLocators.length}`,
        );
        if (ready) {
          break;
        }
        if (attempt < maxAttempts) {
          await this.page.waitForTimeout(waitMs);
        }
      }

      return {
        markers,
        markerResolution,
        anchorResolution,
        anchorLocators,
        pageComponentDetected,
        traversalMode,
        folderLabels,
        fileLabels,
        url,
        urlChanged,
        readyAttemptCount,
        ready,
      };
    };

    let fileUploadsState = await verifyFileUploadsContent("file_uploads_page", 5, 350);
    evidence.push(...fileUploadsState.markerResolution.attempts.map(selectorAttemptToEvidence));
    evidence.push(...fileUploadsState.anchorResolution.attempts.map(selectorAttemptToEvidence));

    if (!fileUploadsState.ready && !usedDocUploadsFallback) {
      await collectSidebarDebugSnapshot();
      const docUploadsFallback = await resolveFirstVisibleLocator({
        page: this.page,
        candidates: SOC_DOC_UPLOADS_TRIGGER_SELECTORS,
        step: "soc_doc_uploads_trigger_fallback",
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
        settle: () => waitForPortalPageSettled(this.page, this.options.debugConfig),
      });
      evidence.push(...docUploadsFallback.attempts.map(selectorAttemptToEvidence));
      if (docUploadsFallback.locator && docUploadsFallback.matchedCandidate) {
        await clickReadOnlyTarget({
          locator: docUploadsFallback.locator,
          page: this.page,
          debugConfig: this.options.debugConfig,
        });
        evidence.push(`Doc Uploads fallback clicked via ${docUploadsFallback.matchedCandidate.description}`);
        fileUploadsState = await verifyFileUploadsContent("file_uploads_page_after_doc_uploads_fallback", 5, 350);
        evidence.push(...fileUploadsState.markerResolution.attempts.map(selectorAttemptToEvidence));
        evidence.push(...fileUploadsState.anchorResolution.attempts.map(selectorAttemptToEvidence));
      }
    }

    let referralFolderSelected = false;
    let referralFolderLabel: string | null = null;
    let referralFileLabel: string | null = null;
    const visibleReferralFileCandidate = fileUploadsState.fileLabels
      .map((label) => ({
        label,
        score: scoreReferralOrAdmissionUploadLabel(label),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))[0] ?? null;

    if (fileUploadsState.fileLabels.length > 0) {
      referralFileLabel = visibleReferralFileCandidate?.label ?? fileUploadsState.fileLabels[0] ?? null;
      evidence.push(
        `File rows are already visible; folder click is not required. selectedReferralFileLabel=${referralFileLabel ?? "none"} candidateScore=${visibleReferralFileCandidate?.score ?? 0}`,
      );
    } else {
      const referralFolderResolution = await resolveFirstVisibleLocator({
        page: this.page,
        candidates: REFERRAL_FOLDER_SELECTORS,
        step: "file_uploads_referral_folder_target",
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
        settle: () => waitForPortalPageSettled(this.page, this.options.debugConfig),
      });
      evidence.push(...referralFolderResolution.attempts.map(selectorAttemptToEvidence));
      if (referralFolderResolution.locator && referralFolderResolution.matchedCandidate) {
        referralFolderLabel = normalizeWhitespace(
          await referralFolderResolution.locator.textContent().catch(() => null),
        ) || referralFolderResolution.matchedCandidate.description;
        const normalizedReferralLabel = referralFolderLabel.toUpperCase();
        const looksLikeFile = /\.(PDF|DOC|DOCX|TXT|RTF|XLS|XLSX|PNG|JPG|JPEG)\b/i.test(referralFolderLabel);
        const looksLikeRootReferralFolder = /ROOT\s*\/\s*REFERRAL/.test(normalizedReferralLabel);
        const looksLikeGenericReferralFolder = /\bREFERRAL\b/.test(normalizedReferralLabel) && !looksLikeFile;
        const looksLikeReferralFilesFolder = /REFERRAL\s+FILES/.test(normalizedReferralLabel) && !looksLikeFile;
        const referralFolderIsFolder = looksLikeRootReferralFolder || looksLikeGenericReferralFolder || looksLikeReferralFilesFolder;

        if (referralFolderIsFolder) {
          const referralFolderClickTarget = referralFolderResolution.locator
            .locator("xpath=ancestor::*[contains(@class,'folder-item')][1]")
            .first();
          const referralFolderClickCount = await referralFolderClickTarget.count().catch(() => 0);
          await clickReadOnlyTarget({
            locator: referralFolderClickCount > 0 ? referralFolderClickTarget : referralFolderResolution.locator,
            page: this.page,
            debugConfig: this.options.debugConfig,
          });
          referralFolderSelected = true;
          evidence.push(
            `Referral folder target clicked: ${referralFolderLabel} via ${referralFolderResolution.matchedCandidate.description}`,
          );
          fileUploadsState = await verifyFileUploadsContent("file_uploads_page_after_referral_folder_click", 4, 300);
          evidence.push(...fileUploadsState.markerResolution.attempts.map(selectorAttemptToEvidence));
          evidence.push(...fileUploadsState.anchorResolution.attempts.map(selectorAttemptToEvidence));
        } else {
          referralFileLabel = referralFolderLabel;
          referralFolderSelected = false;
          evidence.push(
            `Referral folder target resolved to file-like entry '${referralFileLabel}'; folder click skipped to avoid false folder selection.`,
          );
        }
      } else {
        evidence.push("Referral folder target not resolved; proceeding with currently visible uploads list.");
      }
    }

    const anchorLocators = fileUploadsState.anchorLocators;
    fileUploadsTraversalMode = fileUploadsState.traversalMode;
    fileUploadsPageComponentDetected = fileUploadsState.pageComponentDetected;
    if (!referralFileLabel && fileUploadsState.fileLabels.length > 0) {
      referralFileLabel = fileUploadsState.fileLabels
        .map((label) => ({
          label,
          score: scoreReferralOrAdmissionUploadLabel(label),
        }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))[0]?.label ??
        fileUploadsState.fileLabels[0] ??
        null;
    }
    fileUploadsState.fileLabels.forEach((label) => {
      if (label) {
        visibleUploadedDocuments.push(label);
      }
    });
    for (const [index, anchor] of anchorLocators.entries()) {
      if (index >= 60) {
        break;
      }
      const text = normalizeWhitespace(await anchor.textContent().catch(() => null));
      if (text) {
        visibleUploadedDocuments.push(text);
      }
    }
    const dedupedVisibleUploadedDocuments = Array.from(new Set(
      visibleUploadedDocuments
        .map((label) => normalizeWhitespace(label))
        .filter(Boolean),
    ));
    visibleUploadedDocuments.length = 0;
    visibleUploadedDocuments.push(...dedupedVisibleUploadedDocuments);

    for (const label of visibleUploadedDocuments) {
      const normalizedLabel = normalizeUploadFileNameForMatch(label);
      if (normalizedLabel) {
        normalizedFileLabels.add(normalizedLabel);
      }
      const score = scoreReferralOrAdmissionUploadLabel(label);
      if (score > 0 && normalizedLabel) {
        matchedSourceDocuments.push({
          label,
          normalizedLabel,
          score,
        });
      }
    }
    matchedSourceDocuments.sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));

    fileUploadsAccessible =
      fileUploadsState.ready ||
      fileUploadsState.pageComponentDetected ||
      fileUploadsState.folderLabels.length > 0 ||
      visibleUploadedDocuments.length > 0;
    const fileUploadsUrl = fileUploadsState.url;
    const patientFileUploadsRouteDetected = isPatientSpecificFileUploadsUrl(fileUploadsUrl);
    const genericProviderDocumentsRouteDetected = isGenericProviderDocumentsUrl(fileUploadsUrl);
    evidence.push(`File Uploads accessible: ${fileUploadsAccessible}`);
    evidence.push(`Patient-specific File Uploads route detected: ${patientFileUploadsRouteDetected}`);
    evidence.push(`Generic provider Documents route detected: ${genericProviderDocumentsRouteDetected}`);
    evidence.push(`Matched File Uploads sidebar label: ${matchedFileUploadsLabel ?? "none"}`);
    evidence.push(`Matched File Uploads sidebar href: ${matchedFileUploadsHref ?? "none"}`);
    evidence.push(`File Uploads sidebar click succeeded: ${fileUploadsSidebarClickSucceeded}`);
    evidence.push(`File Uploads page component detected: ${fileUploadsPageComponentDetected}`);
    evidence.push(`File Uploads traversal mode: ${fileUploadsTraversalMode}`);
    evidence.push(`Used chart Documents fallback: ${usedChartDocumentsFallback}`);
    evidence.push(`File Uploads URL: ${fileUploadsUrl}`);
    evidence.push(`File Uploads URL changed from prior page: ${fileUploadsState.urlChanged}`);
    evidence.push(`File Uploads ready attempt count: ${fileUploadsState.readyAttemptCount}`);
    evidence.push(`File Uploads page markers: ${fileUploadsState.markers.join(" | ") || "none"}`);
    evidence.push(`Referral folder selected: ${referralFolderSelected}`);
    evidence.push(`Referral folder label: ${referralFolderLabel ?? "none"}`);
    evidence.push(`Referral file label (if resolved instead of folder): ${referralFileLabel ?? "none"}`);
    evidence.push(`Discovered folder labels: ${fileUploadsState.folderLabels.join(" | ") || "none"}`);
    evidence.push(`Discovered file labels: ${fileUploadsState.fileLabels.join(" | ") || "none"}`);
    evidence.push(`Normalized file labels: ${Array.from(normalizedFileLabels).join(" | ") || "none"}`);
    evidence.push(
      `Matched source documents: ${matchedSourceDocuments.map((entry) => `${entry.label} [normalized=${entry.normalizedLabel}] [score=${entry.score}]`).join(" | ") || "none"}`,
    );
    evidence.push(`Visible uploaded documents: ${visibleUploadedDocuments.join(" | ") || "none"}`);

    const admissionCandidates: Array<{
      anchor: Locator;
      anchorText: string;
      normalizedAnchorText: string;
      rowText: string;
      normalizedRowText: string;
      score: number;
    }> = [];

    const scanLimit = Math.min(anchorLocators.length, 80);
    for (let index = 0; index < scanLimit; index += 1) {
      const anchor = anchorLocators[index]!;
      if (!(await anchor.isVisible().catch(() => false))) {
        continue;
      }
      const anchorText = normalizeWhitespace(await anchor.textContent().catch(() => null));
      if (!anchorText) {
        continue;
      }
      const fileRowContainer = anchor
        .locator("xpath=ancestor::*[contains(@class,'file-item')][1]")
        .first();
      const fileRowContainerCount = await fileRowContainer.count().catch(() => 0);
      const tableRowText = normalizeWhitespace(await anchor.locator("xpath=ancestor::tr[1]").first().textContent().catch(() => null));
      const fileRowText = fileRowContainerCount > 0
        ? normalizeWhitespace(await fileRowContainer.textContent().catch(() => null))
        : "";
      const rowText = fileRowText || tableRowText || anchorText;
      const normalizedAnchorText = normalizeUploadFileNameForMatch(anchorText);
      const normalizedRowText = normalizeUploadFileNameForMatch(rowText);
      const sourceDocumentScore = Math.max(
        scoreReferralOrAdmissionUploadLabel(anchorText),
        scoreReferralOrAdmissionUploadLabel(rowText),
      );
      if (sourceDocumentScore <= 0) {
        continue;
      }
      // Ignore broad container text that matches many unrelated menu labels.
      if (
        anchorText.length > 260 &&
        /\bcalendar\b|\binsurance\s*payer\b|\bphysicians\b|\bcare\s*team\b|\bdocumentations\b/.test(
          normalizedAnchorText,
        )
      ) {
        continue;
      }
      let score = sourceDocumentScore;
      if (/\badmission\s*order\b/.test(normalizedAnchorText)) {
        score += 100;
      }
      if (/\badmission\s*order\b/.test(normalizedRowText)) {
        score += 30;
      }
      if (!/\badmission\s*order\b/.test(normalizedAnchorText) && /\badmission\b/.test(normalizedAnchorText)) {
        score += 60;
      }
      if (!/\badmission\s*order\b/.test(normalizedRowText) && /\badmission\b/.test(normalizedRowText)) {
        score += 25;
      }
      if (
        referralFileLabel &&
        (normalizedAnchorText === normalizeUploadFileNameForMatch(referralFileLabel) ||
          normalizedRowText === normalizeUploadFileNameForMatch(referralFileLabel))
      ) {
        score += 90;
      }
      score += Math.max(0, 100 - index);
      admissionCandidates.push({
        anchor: fileRowContainerCount > 0 ? fileRowContainer : anchor,
        anchorText,
        normalizedAnchorText,
        rowText,
        normalizedRowText,
        score,
      });
    }

    evidence.push(`Admission Order candidate count: ${admissionCandidates.length}`);
    evidence.push(
      `Admission Order candidate labels: ${admissionCandidates.map((candidate) => `${candidate.anchorText} [score=${candidate.score}]`).join(" | ") || "none"}`,
    );

    if (admissionCandidates.length > 0) {
      admissionCandidates.sort((left, right) => right.score - left.score || left.anchorText.localeCompare(right.anchorText));
      const chosen = admissionCandidates[0]!;
      admissionOrderTitle = chosen.anchorText;
      selectedSourceFile =
        normalizeUploadFileLabelForDisplay(chosen.anchorText) ||
        normalizeUploadFileLabelForDisplay(chosen.rowText) ||
        chosen.anchorText ||
        chosen.rowText;
      selectedSourceFileNormalized = normalizeUploadFileNameForMatch(selectedSourceFile);
      admissionOrderSelectorUsed = "File Uploads source document row by .file-item/.file-label or table row";
      const documentDirectory = path.join(
        resolvePatientDocumentsDirectory(input.outputDirectory),
        slugify(selectedSourceFileNormalized || selectedSourceFile || "source-document") || "source-document",
      );
      await mkdir(documentDirectory, { recursive: true });
      sourceMetaPath = path.join(documentDirectory, "source-meta.json");
      sourcePdfPath = path.join(documentDirectory, "source.pdf");
      extractedTextPath = path.join(documentDirectory, "extracted-text.txt");
      extractionResultPath = path.join(documentDirectory, "extraction-result.json");
      printedPdfPath = path.join(documentDirectory, "printed-source.pdf");

      const urlBeforeAdmissionClick = this.page.url();
      const capturePdfResponses: Promise<void>[] = [];
      const onResponse = (response: Response) => {
        if (pdfResponseDetected) {
          return;
        }
        const responseUrl = response.url();
        const responseContentType = response.headers()["content-type"] ?? "";
        if (!isLikelyPdfResponse({
          url: responseUrl,
          contentType: responseContentType,
        })) {
          return;
        }
        capturePdfResponses.push((async () => {
          try {
            const body = await response.body();
            if (!body || body.length === 0 || pdfResponseDetected || !sourcePdfPath) {
              return;
            }
            await writeFile(sourcePdfPath, body);
            pdfResponseDetected = true;
            pdfResponseUrl = responseUrl;
            pdfContentType = responseContentType || null;
            pdfSavedPath = sourcePdfPath;
            pdfByteSize = body.length;
          } catch {
            // Keep viewer fallback available if response body capture is blocked by the browser.
          }
        })());
      };
      this.page.on("response", onResponse);
      await clickReadOnlyTarget({
        locator: chosen.anchor,
        page: this.page,
        debugConfig: this.options.debugConfig,
      });
      extractionMethodUsed = "click";
      await waitForPortalPageSettled(this.page, this.options.debugConfig);

      const viewerMarkers = await resolveVisibleLocatorList({
        page: this.page,
        candidates: FILE_UPLOADS_VIEWER_MARKERS,
        step: "file_uploads_viewer_markers_after_source_click",
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
        maxItems: 12,
      });
      evidence.push(...viewerMarkers.attempts.map(selectorAttemptToEvidence));
      const viewerMarkerSamples = (
        await Promise.all(
          viewerMarkers.items.slice(0, 6).map(async (item) =>
            readLocatorLabel(item.locator) ?? item.candidate.description),
        )
      ).filter((value): value is string => Boolean(value));
      viewerDetected = viewerMarkers.items.length > 0;

      await this.page.waitForTimeout(1200).catch(() => undefined);
      await Promise.all(capturePdfResponses).catch(() => undefined);
      this.page.off("response", onResponse);

      const printButton = this.page
        .locator("pdf-print #printButton, #printButton, pdf-shy-button[primarytoolbarid='printButton'] button")
        .first();
      const printButtonCount = await printButton.count().catch(() => 0);
      printButtonDetected = printButtonCount > 0;
      printButtonVisible = printButtonDetected && await printButton.isVisible().catch(() => false);
      printButtonSelectorUsed = printButtonDetected
        ? "pdf-print #printButton, #printButton, pdf-shy-button[primarytoolbarid='printButton'] button"
        : null;

      if (!pdfResponseDetected && printButtonVisible) {
        await this.page.evaluate(() => {
          const windowWithPrintFlag = globalThis as unknown as {
            print?: () => void;
            __medicalAiQaOriginalPrint?: () => void;
            __medicalAiQaPrintRequested?: boolean;
          };
          if (!windowWithPrintFlag.__medicalAiQaOriginalPrint && windowWithPrintFlag.print) {
            windowWithPrintFlag.__medicalAiQaOriginalPrint = windowWithPrintFlag.print.bind(globalThis);
          }
          windowWithPrintFlag.__medicalAiQaPrintRequested = false;
          windowWithPrintFlag.print = () => {
            windowWithPrintFlag.__medicalAiQaPrintRequested = true;
          };
        }).catch(() => undefined);

        await clickReadOnlyTarget({
          locator: printButton,
          page: this.page,
          debugConfig: this.options.debugConfig,
        }).then(() => {
          printClickSucceeded = true;
        }).catch(() => {
          printClickSucceeded = false;
        });

        if (printClickSucceeded) {
          printClickSucceeded = await this.page.evaluate(() => {
            const windowWithPrintFlag = globalThis as unknown as {
              __medicalAiQaPrintRequested?: boolean;
            };
            return windowWithPrintFlag.__medicalAiQaPrintRequested === true;
          }).catch(() => true);
        }
      }

      if (pdfResponseDetected) {
        printedPdfPath = null;
        printAcquisitionMethodUsed = "network_pdf_response";
      } else if (viewerDetected && printClickSucceeded) {
        try {
          await this.page.pdf({
            path: printedPdfPath,
            format: "Letter",
            printBackground: true,
          });
          printAcquisitionMethodUsed = "viewer_print_button_then_page_pdf";
        } catch {
          printedPdfPath = null;
          printAcquisitionMethodUsed = "viewer_print_button_then_text_capture";
        }
      } else if (viewerDetected) {
        printedPdfPath = null;
        printAcquisitionMethodUsed = "viewer_detected_without_print_capture";
      } else {
        printedPdfPath = null;
        printAcquisitionMethodUsed = "metadata_fallback";
      }

      const postClickMarkers = await resolveVisibleLocatorList({
        page: this.page,
        candidates: ADMISSION_ORDER_OPEN_MARKERS,
        step: "admission_order_open_markers",
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
        maxItems: 10,
      });
      evidence.push(...postClickMarkers.attempts.map(selectorAttemptToEvidence));
      const markerSamples = (
        await Promise.all(
          postClickMarkers.items.slice(0, 6).map(async (item) => readLocatorLabel(item.locator) ?? item.candidate.description),
        )
      ).filter((value): value is string => Boolean(value));
      admissionOrderAccessible =
        viewerDetected ||
        printButtonDetected ||
        postClickMarkers.items.length > 0 ||
        this.page.url() !== urlBeforeAdmissionClick;
      const admissionTextCandidates = new Set<string>();
      const pushAdmissionText = (value: string | null | undefined) => {
        const normalized = normalizeWhitespace(value ?? "");
        if (normalized.length >= 30) {
          admissionTextCandidates.add(normalized);
        }
      };
      pushAdmissionText(chosen.rowText);
      pushAdmissionText(chosen.anchorText);
      for (const item of postClickMarkers.items.slice(0, 8)) {
        pushAdmissionText(await item.locator.innerText().catch(() => null));
      }
      const admissionSpecificWrappers = this.page.locator(
        "ngx-extended-pdf-viewer, .textLayer, .pdfViewer, fin-modal, fin-slideover, app-document-note, app-document-sent-details, [class*='admission'], [id*='admission']",
      );
      const wrapperCount = Math.min(await admissionSpecificWrappers.count().catch(() => 0), 12);
      for (let index = 0; index < wrapperCount; index += 1) {
        const wrapper = admissionSpecificWrappers.nth(index);
        if (!(await wrapper.isVisible().catch(() => false))) {
          continue;
        }
        pushAdmissionText(await wrapper.innerText().catch(() => null));
      }

      const scoreAdmissionTextCandidate = (value: string): number => {
        let score = 0;
        const upper = value.toUpperCase();
        if (/REASON FOR ADMISSION/.test(upper)) {
          score += 120;
        }
        if (/ADMITTING DIAGNOSIS/.test(upper)) {
          score += 100;
        }
        if (/PRIMARY DIAGNOSIS/.test(upper)) {
          score += 80;
        }
        if (/DIAGNOSIS/.test(upper)) {
          score += 40;
        }
        if (/ADMISSION/.test(upper)) {
          score += 35;
        }
        if (/\b[A-TV-Z][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?\b/.test(upper)) {
          score += 50;
        }
        if (/DASHBOARD|VIEW ALL AGENCIES|SEARCH PATIENT|NOTIFICATIONS|MESSAGES|LOGOUT|STICKY NOTES|QAPI BOARD/.test(upper)) {
          score -= 140;
        }
        score += Math.min(value.length, 1600) / 40;
        return score;
      };

      const rankedAdmissionTextCandidates = [...admissionTextCandidates]
        .map((value) => ({ value, score: scoreAdmissionTextCandidate(value) }))
        .sort((left, right) => right.score - left.score)
        .slice(0, 6);
      const bestAdmissionText = rankedAdmissionTextCandidates[0]?.value ?? "";
      const pageFallbackText = await dumpTopVisibleText(this.page, 8000).catch(() => "");
      admissionOrderTextExcerpt =
        (pdfResponseDetected && pdfSavedPath ? normalizeWhitespace(bestAdmissionText) : "") ||
        bestAdmissionText ||
        pageFallbackText ||
        normalizeWhitespace(chosen.rowText) ||
        normalizeWhitespace(chosen.anchorText) ||
        null;
      if (
        !bestAdmissionText &&
        !pageFallbackText &&
        (normalizeWhitespace(chosen.rowText) || normalizeWhitespace(chosen.anchorText))
      ) {
        extractionMethodUsed = "metadata";
      }
      await writeFile(extractedTextPath, `${normalizeWhitespace(admissionOrderTextExcerpt) || ""}\n`, "utf8");
      rawExtractedTextSource = "dom";
      const admissionTextAnalysis = analyzeDocumentText(admissionOrderTextExcerpt ?? "");
      domExtractionRejectedReasons = admissionTextAnalysis.rejectionReasons;
      admissionReasonSnippets = extractAdmissionReasonSnippets(admissionTextAnalysis.normalizedText);
      admissionReasonPrimary = admissionReasonSnippets[0] ?? null;
      possibleIcd10Codes = extractPossibleIcd10Codes(admissionTextAnalysis.normalizedText);
      const extractedTextLength = admissionTextAnalysis.normalizedText.length;
      extractionSuccess =
        admissionTextAnalysis.accepted &&
        (pdfResponseDetected || extractedTextLength >= 120 || possibleIcd10Codes.length > 0);
      const queuedForLlm = !extractionSuccess;
      admissionOrderAccessible =
        admissionOrderAccessible ||
        Boolean(
          selectedSourceFileNormalized &&
          (extractionSuccess || extractionMethodUsed === "metadata" || viewerDetected),
        );
      await writeFile(
        sourceMetaPath,
        JSON.stringify(
          {
            selectedSourceFile,
            selectedSourceFileNormalized,
            admissionOrderTitle,
            admissionOrderSelectorUsed,
            sourceUrlBeforeClick: urlBeforeAdmissionClick,
            sourceUrlAfterClick: this.page.url(),
            matchedReferralFileLabel: referralFileLabel
              ? normalizeUploadFileLabelForDisplay(referralFileLabel)
              : null,
            normalizedFileLabels: Array.from(normalizedFileLabels),
            matchedSourceDocuments,
            viewerDetected,
            viewerMarkerSamples,
            printButtonDetected,
            printButtonVisible,
            printButtonSelectorUsed,
            printClickSucceeded,
            pdfResponseDetected,
            pdfResponseUrl,
            pdfContentType,
            pdfSavedPath,
            pdfByteSize,
            printAcquisitionMethodUsed,
            printedPdfSaved: Boolean(printedPdfPath),
            printedPdfPath,
            sourcePdfPath: pdfSavedPath,
            extractedTextPath,
            extractionResultPath,
            extractedTextLength,
            rawExtractedTextSource,
            domExtractionRejectedReasons,
            extractionSuccess,
            queuedForLlm,
            generatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf8",
      );
      await writeFile(
        extractionResultPath,
        JSON.stringify(
          {
            documentType: "ORDER",
            sourceLabel: selectedSourceFile,
            normalizedSourceLabel: selectedSourceFileNormalized,
            viewerDetected,
            printButtonDetected,
            printButtonSelectorUsed,
            printClickSucceeded,
            pdfResponseDetected,
            pdfResponseUrl,
            pdfContentType,
            pdfSavedPath,
            pdfByteSize,
            printAcquisitionMethodUsed,
            printedPdfSaved: Boolean(printedPdfPath),
            printedPdfPath,
            sourcePdfPath: pdfSavedPath,
            extractedTextPath,
            extractedTextLength,
            extractionMethodUsed,
            rawExtractedTextSource,
            domExtractionRejectedReasons,
            extractionSuccess,
            queuedForLlm,
            admissionReasonPrimary,
            admissionReasonSnippets,
            possibleIcd10Codes,
            textPreview: admissionTextAnalysis.normalizedText.slice(0, 500) || null,
            generatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf8",
      );
      evidence.push(`Selected source file: ${selectedSourceFile ?? "none"}`);
      evidence.push(`Selected source file normalized: ${selectedSourceFileNormalized ?? "none"}`);
      evidence.push(`Viewer detected: ${viewerDetected}`);
      evidence.push(`Viewer marker samples: ${viewerMarkerSamples.join(" | ") || "none"}`);
      evidence.push(`Print button detected: ${printButtonDetected}`);
      evidence.push(`Print button visible: ${printButtonVisible}`);
      evidence.push(`Print button selector used: ${printButtonSelectorUsed ?? "none"}`);
      evidence.push(`Print click succeeded: ${printClickSucceeded}`);
      evidence.push(`PDF response detected: ${pdfResponseDetected}`);
      evidence.push(`PDF response URL: ${pdfResponseUrl ?? "none"}`);
      evidence.push(`PDF content type: ${pdfContentType ?? "none"}`);
      evidence.push(`PDF saved path: ${pdfSavedPath ?? "none"}`);
      evidence.push(`PDF byte size: ${pdfByteSize}`);
      evidence.push(`Print acquisition method used: ${printAcquisitionMethodUsed}`);
      evidence.push(`Printed PDF saved: ${Boolean(printedPdfPath)}`);
      evidence.push(`Printed PDF path: ${printedPdfPath ?? "none"}`);
      evidence.push(`Source meta path: ${sourceMetaPath ?? "none"}`);
      evidence.push(`Extracted text path: ${extractedTextPath ?? "none"}`);
      evidence.push(`Extraction result path: ${extractionResultPath ?? "none"}`);
      evidence.push(`Extracted text length: ${extractedTextLength}`);
      evidence.push(`Raw extracted text source: ${rawExtractedTextSource ?? "none"}`);
      evidence.push(`DOM extraction rejected reasons: ${domExtractionRejectedReasons.join(" | ") || "none"}`);
      evidence.push(`Extraction method used: ${extractionMethodUsed ?? "none"}`);
      evidence.push(`Extraction success: ${extractionSuccess}`);
      evidence.push(`Queued for LLM: ${queuedForLlm}`);
      evidence.push(`Admission Order title: ${admissionOrderTitle}`);
      evidence.push(`Admission Order URL after click: ${this.page.url()}`);
      evidence.push(`Admission Order markers: ${markerSamples.join(" | ") || "none"}`);
      evidence.push(
        `Admission text candidates ranked: ${rankedAdmissionTextCandidates
          .map((entry, index) => `[${index + 1}] score=${entry.score.toFixed(1)} text=${entry.value.slice(0, 220)}`)
          .join(" || ") || "none"}`,
      );
      evidence.push(`Admission reason primary: ${admissionReasonPrimary ?? "none"}`);
      evidence.push(`Admission reason snippets: ${admissionReasonSnippets.join(" | ") || "none"}`);
      evidence.push(`Possible ICD-10 codes: ${possibleIcd10Codes.join(" | ") || "none"}`);
      evidence.push(`Admission order text excerpt: ${normalizeWhitespace(admissionOrderTextExcerpt).slice(0, 900) || "none"}`);
    } else {
      admissionOrderAccessible = false;
      admissionOrderTextExcerpt = null;
      sourcePdfPath = null;
      admissionReasonSnippets = [];
      admissionReasonPrimary = null;
      possibleIcd10Codes = [];
      rawExtractedTextSource = null;
      domExtractionRejectedReasons = [];
      selectedSourceFile = null;
      selectedSourceFileNormalized = null;
      viewerDetected = false;
      printButtonDetected = false;
      printButtonVisible = false;
      printButtonSelectorUsed = null;
      printClickSucceeded = false;
      pdfResponseDetected = false;
      pdfResponseUrl = null;
      pdfContentType = null;
      pdfSavedPath = null;
      pdfByteSize = 0;
      printAcquisitionMethodUsed = "none";
      extractionMethodUsed = null;
      extractionSuccess = false;
      printedPdfPath = null;
      sourceMetaPath = null;
      extractedTextPath = null;
      extractionResultPath = null;
    }

    stepLogs.push(createAutomationStepLog({
      step: "file_uploads_open",
      message: fileUploadsAccessible
        ? "Opened File Uploads section and enumerated available uploaded records."
        : "Could not verify File Uploads section content after sidebar navigation.",
      urlBefore: input.chartUrl,
      urlAfter: this.page.url(),
      selectorUsed: fileUploadsSelectorUsed,
      found: withContextSignals([
        `fileUploadsAccessible:${fileUploadsAccessible}`,
        `patientFileUploadsRouteDetected:${patientFileUploadsRouteDetected}`,
        `genericProviderDocumentsRouteDetected:${genericProviderDocumentsRouteDetected}`,
        `fileUploadsSidebarClickSucceeded:${fileUploadsSidebarClickSucceeded}`,
        `pageComponentDetected:${fileUploadsPageComponentDetected}`,
        `traversalMode:${fileUploadsTraversalMode}`,
        `usedChartDocumentsFallback:${usedChartDocumentsFallback}`,
        `matchedFileUploadsLabel:${matchedFileUploadsLabel ?? "none"}`,
        `matchedFileUploadsHref:${matchedFileUploadsHref ?? "none"}`,
        `referralFolderSelected:${referralFolderSelected}`,
        `referralFolderLabel:${referralFolderLabel ?? "none"}`,
        `matchedReferralFileLabel:${referralFileLabel ?? "none"}`,
        `normalizedFileLabels:${Array.from(normalizedFileLabels).join(" | ") || "none"}`,
        `matchedSourceDocuments:${matchedSourceDocuments.map((entry) => entry.normalizedLabel).join(" | ") || "none"}`,
        `selectedSourceFile:${selectedSourceFile ?? "none"}`,
        `viewerDetected:${viewerDetected}`,
        `printButtonDetected:${printButtonDetected}`,
        `printButtonVisible:${printButtonVisible}`,
        `printClickSucceeded:${printClickSucceeded}`,
        `pdfResponseDetected:${pdfResponseDetected}`,
        `pdfResponseUrl:${pdfResponseUrl ?? "none"}`,
        `pdfContentType:${pdfContentType ?? "none"}`,
        `pdfSavedPath:${pdfSavedPath ?? "none"}`,
        `pdfByteSize:${pdfByteSize}`,
        `printAcquisitionMethodUsed:${printAcquisitionMethodUsed}`,
        `sourcePdfPath:${sourcePdfPath ?? "none"}`,
        `printedPdfPath:${printedPdfPath ?? "none"}`,
        `extractionMethodUsed:${extractionMethodUsed ?? "none"}`,
        `rawExtractedTextSource:${rawExtractedTextSource ?? "none"}`,
        `domExtractionRejectedReasons:${domExtractionRejectedReasons.join(" | ") || "none"}`,
        `extractionSuccess:${extractionSuccess}`,
        `uploadedDocumentCount:${visibleUploadedDocuments.length}`,
      ]),
      missing: fileUploadsAccessible ? [] : ["File Uploads content"],
      evidence,
      safeReadConfirmed: true,
    }));

    stepLogs.push(createAutomationStepLog({
      step: "admission_order_open",
      message: admissionOrderAccessible
        ? "Opened Admission Order from File Uploads for coding-reference verification."
        : "Admission Order could not be located/opened from File Uploads.",
      urlBefore: input.chartUrl,
      urlAfter: this.page.url(),
      selectorUsed: admissionOrderSelectorUsed ?? fileUploadsSelectorUsed,
      found: withContextSignals([
        `fileUploadsAccessible:${fileUploadsAccessible}`,
        `patientFileUploadsRouteDetected:${patientFileUploadsRouteDetected}`,
        `genericProviderDocumentsRouteDetected:${genericProviderDocumentsRouteDetected}`,
        `fileUploadsSidebarClickSucceeded:${fileUploadsSidebarClickSucceeded}`,
        `pageComponentDetected:${fileUploadsPageComponentDetected}`,
        `traversalMode:${fileUploadsTraversalMode}`,
        `usedChartDocumentsFallback:${usedChartDocumentsFallback}`,
        `referralFolderSelected:${referralFolderSelected}`,
        `admissionOrderAccessible:${admissionOrderAccessible}`,
        `admissionOrderTitle:${admissionOrderTitle ?? "none"}`,
        `selectedSourceFile:${selectedSourceFile ?? "none"}`,
        `viewerDetected:${viewerDetected}`,
        `printButtonDetected:${printButtonDetected}`,
        `printClickSucceeded:${printClickSucceeded}`,
        `pdfResponseDetected:${pdfResponseDetected}`,
        `pdfResponseUrl:${pdfResponseUrl ?? "none"}`,
        `pdfContentType:${pdfContentType ?? "none"}`,
        `pdfSavedPath:${pdfSavedPath ?? "none"}`,
        `pdfByteSize:${pdfByteSize}`,
        `printAcquisitionMethodUsed:${printAcquisitionMethodUsed}`,
        `sourcePdfPath:${sourcePdfPath ?? "none"}`,
        `printedPdfPath:${printedPdfPath ?? "none"}`,
        `extractionMethodUsed:${extractionMethodUsed ?? "none"}`,
        `rawExtractedTextSource:${rawExtractedTextSource ?? "none"}`,
        `domExtractionRejectedReasons:${domExtractionRejectedReasons.join(" | ") || "none"}`,
        `extractionSuccess:${extractionSuccess}`,
        `admissionReasonPrimary:${admissionReasonPrimary ?? "none"}`,
        `possibleIcd10Codes:${possibleIcd10Codes.join(" | ") || "none"}`,
      ]),
      missing: admissionOrderAccessible ? [] : ["Admission Order"],
      evidence,
      safeReadConfirmed: true,
    }));

    stepLogs.push(createAutomationStepLog({
      step: "qa_summary",
      message: admissionOrderAccessible
        ? "File Uploads and Admission Order were successfully accessed for coding reference."
        : "File Uploads stage completed but Admission Order was not accessible.",
      urlBefore: input.chartUrl,
      urlAfter: this.page.url(),
      selectorUsed: admissionOrderSelectorUsed ?? fileUploadsSelectorUsed,
      found: withContextSignals([
        `fileUploadsAccessible:${fileUploadsAccessible}`,
        `patientFileUploadsRouteDetected:${patientFileUploadsRouteDetected}`,
        `genericProviderDocumentsRouteDetected:${genericProviderDocumentsRouteDetected}`,
        `fileUploadsSidebarClickSucceeded:${fileUploadsSidebarClickSucceeded}`,
        `pageComponentDetected:${fileUploadsPageComponentDetected}`,
        `traversalMode:${fileUploadsTraversalMode}`,
        `usedChartDocumentsFallback:${usedChartDocumentsFallback}`,
        `referralFolderSelected:${referralFolderSelected}`,
        `admissionOrderAccessible:${admissionOrderAccessible}`,
        `admissionOrderTitle:${admissionOrderTitle ?? "none"}`,
        `selectedSourceFile:${selectedSourceFile ?? "none"}`,
        `viewerDetected:${viewerDetected}`,
        `printButtonDetected:${printButtonDetected}`,
        `printClickSucceeded:${printClickSucceeded}`,
        `pdfResponseDetected:${pdfResponseDetected}`,
        `pdfResponseUrl:${pdfResponseUrl ?? "none"}`,
        `pdfContentType:${pdfContentType ?? "none"}`,
        `pdfSavedPath:${pdfSavedPath ?? "none"}`,
        `pdfByteSize:${pdfByteSize}`,
        `printAcquisitionMethodUsed:${printAcquisitionMethodUsed}`,
        `sourcePdfPath:${sourcePdfPath ?? "none"}`,
        `printedPdfPath:${printedPdfPath ?? "none"}`,
        `extractionMethodUsed:${extractionMethodUsed ?? "none"}`,
        `rawExtractedTextSource:${rawExtractedTextSource ?? "none"}`,
        `domExtractionRejectedReasons:${domExtractionRejectedReasons.join(" | ") || "none"}`,
        `extractionSuccess:${extractionSuccess}`,
        `admissionReasonPrimary:${admissionReasonPrimary ?? "none"}`,
        `possibleIcd10Codes:${possibleIcd10Codes.join(" | ") || "none"}`,
      ]),
      missing: [
        ...(fileUploadsAccessible ? [] : ["File Uploads"]),
        ...(admissionOrderAccessible ? [] : ["Admission Order"]),
      ],
      evidence,
      safeReadConfirmed: true,
    }));

    this.options.logger?.info(
      {
        postNavigationUrl: this.page.url(),
        socSelectorUsed: input.socSelectorUsed,
        matchedSocAnchorText: input.matchedSocAnchorText,
        fileUploadsSelectorUsed,
        matchedFileUploadsLabel,
        matchedFileUploadsHref,
        fileUploadsSidebarClickSucceeded,
        fileUploadsAccessible,
        patientFileUploadsRouteDetected,
        genericProviderDocumentsRouteDetected,
        fileUploadsPageComponentDetected,
        fileUploadsTraversalMode,
        usedChartDocumentsFallback,
        referralFolderSelected,
        referralFolderLabel,
        referralFileLabel,
        normalizedFileLabels: Array.from(normalizedFileLabels).slice(0, 20),
        matchedSourceDocuments: matchedSourceDocuments.slice(0, 20),
        selectedSourceFile,
        selectedSourceFileNormalized,
        viewerDetected,
        printButtonDetected,
        printButtonVisible,
        printButtonSelectorUsed,
        printClickSucceeded,
        pdfResponseDetected,
        pdfResponseUrl,
        pdfContentType,
        pdfSavedPath,
        pdfByteSize,
        printAcquisitionMethodUsed,
        sourcePdfPath,
        printedPdfPath,
        sourceMetaPath,
        extractedTextPath,
        extractionResultPath,
        extractionMethodUsed,
        rawExtractedTextSource,
        domExtractionRejectedReasons,
        extractionSuccess,
        folderLabels: fileUploadsState.folderLabels.slice(0, 20),
        fileUploadsUrl,
        uploadedDocumentCount: visibleUploadedDocuments.length,
        visibleUploadedDocuments: visibleUploadedDocuments.slice(0, 20),
        admissionOrderSelectorUsed,
        admissionOrderAccessible,
        admissionOrderTitle,
        admissionReasonPrimary,
        admissionReasonSnippets,
        possibleIcd10Codes,
      },
      "File Uploads and Admission Order read-only navigation completed",
    );

    return {
      fileUploadsAccessible,
      fileUploadsUrl,
      visibleUploadedDocuments,
      admissionOrderAccessible,
      admissionOrderTitle,
      admissionReasonSnippets,
      admissionReasonPrimary,
      possibleIcd10Codes,
      rawExtractedTextSource,
      domExtractionRejectedReasons,
      admissionOrderTextExcerpt,
      sourcePdfPath,
      printedPdfPath,
      sourceMetaPath,
      extractedTextPath,
      extractionResultPath,
      fileUploadsSelectorUsed,
      admissionOrderSelectorUsed,
      stepLogs,
    };
    */
  }

  private async openFileUploadsAndAdmissionOrderFromSidebarRefactored(input: {
    chartUrl: string;
    outputDirectory: string;
    socSelectorUsed: string | null;
    matchedSocAnchorText: string | null;
    includeOasisSignals?: boolean;
  }): Promise<{
    fileUploadsAccessible: boolean;
    fileUploadsUrl: string | null;
    visibleUploadedDocuments: string[];
    admissionOrderAccessible: boolean;
    admissionOrderTitle: string | null;
    admissionReasonSnippets: string[];
    admissionReasonPrimary: string | null;
    possibleIcd10Codes: string[];
    rawExtractedTextSource: "dom" | "ocr" | "hybrid" | null;
    domExtractionRejectedReasons: string[];
    admissionOrderTextExcerpt: string | null;
    sourcePdfPath: string | null;
    printedPdfPath: string | null;
    sourceMetaPath: string | null;
    extractedTextPath: string | null;
    extractionResultPath: string | null;
    fileUploadsSelectorUsed: string | null;
    admissionOrderSelectorUsed: string | null;
    stepLogs: AutomationStepLog[];
  }> {
    await waitForPortalPageSettled(this.page, this.options.debugConfig);
    const stepLogs: AutomationStepLog[] = [];
    const oasisContextSignals = input.includeOasisSignals
      ? [
          "oasisMenuClicked:true",
          "oasisDocumentListDetected:true",
          "socDocumentFound:true",
          "socDocumentClicked:true",
        ]
      : [];
    const withContextSignals = (signals: string[]) => [...oasisContextSignals, ...signals];

    const captureResult = await captureChartDocument({
      page: this.page,
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      chartUrl: input.chartUrl,
      outputDirectory: input.outputDirectory,
      targetType: "admission_order",
      ensureDocumentsSectionVisible: () => this.ensureDocumentsSectionVisible(),
    });

    const evidence = [...captureResult.evidence];
    let admissionOrderAccessible = captureResult.admissionOrderAccessible;
    let admissionOrderTextExcerpt: string | null = null;
    let admissionReasonPrimary: string | null = null;
    let admissionReasonSnippets: string[] = [];
    let possibleIcd10Codes: string[] = [];
    let rawExtractedTextSource: "dom" | "ocr" | "hybrid" | null = null;
    let domExtractionRejectedReasons: string[] = [];
    let extractionMethodUsed = captureResult.extractionMethodUsed;
    let extractionSuccess = false;
    const extractionPolicyDecision = captureResult.capturedDocument
      ? await decideDocumentExtractionPolicy(captureResult.capturedDocument)
      : null;

    if (extractionPolicyDecision) {
      evidence.push(`Extraction policy mode: ${extractionPolicyDecision.mode}`);
      evidence.push(`Extraction policy confidence: ${extractionPolicyDecision.confidence}`);
      evidence.push(`Extraction policy reasons: ${extractionPolicyDecision.reasons.join(" | ") || "none"}`);
      evidence.push(`Extraction policy recommended source: ${extractionPolicyDecision.recommendedSourcePath ?? "none"}`);
      evidence.push(`Extraction policy fallback source: ${extractionPolicyDecision.fallbackSourcePath ?? "none"}`);
      this.options.logger?.info(
        {
          chartUrl: input.chartUrl,
          selectedSourceFile: captureResult.selectedSourceFile,
          selectedSourceFileNormalized: captureResult.selectedSourceFileNormalized,
          extractionPolicyDecision,
        },
        "document extraction policy evaluated for captured chart document",
      );
    }

    if (
      captureResult.capturedDocument &&
      captureResult.extractedTextPath &&
      captureResult.extractionResultPath &&
      captureResult.sourceMetaPath
    ) {
      const scoreAdmissionTextCandidate = (value: string): number => {
        let score = 0;
        const upper = value.toUpperCase();
        if (/REASON FOR ADMISSION/.test(upper)) {
          score += 120;
        }
        if (/ADMITTING DIAGNOSIS/.test(upper)) {
          score += 100;
        }
        if (/PRIMARY DIAGNOSIS/.test(upper)) {
          score += 80;
        }
        if (/DIAGNOSIS/.test(upper)) {
          score += 40;
        }
        if (/ADMISSION/.test(upper)) {
          score += 35;
        }
        if (/\b[A-TV-Z][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?\b/.test(upper)) {
          score += 50;
        }
        if (/DASHBOARD|VIEW ALL AGENCIES|SEARCH PATIENT|NOTIFICATIONS|MESSAGES|LOGOUT|STICKY NOTES|QAPI BOARD/.test(upper)) {
          score -= 140;
        }
        score += Math.min(value.length, 1600) / 40;
        return score;
      };

      const rankedAdmissionTextCandidates = captureResult.rawTextCandidates
        .map((value) => ({ value, score: scoreAdmissionTextCandidate(value) }))
        .sort((left, right) => right.score - left.score)
        .slice(0, 6);
      const bestAdmissionText = rankedAdmissionTextCandidates[0]?.value ?? "";
      const pageFallbackText = await dumpTopVisibleText(this.page, 8000).catch(() => "");
      admissionOrderTextExcerpt =
        (captureResult.pdfResponseDetected && captureResult.pdfSavedPath ? normalizeWhitespace(bestAdmissionText) : "") ||
        bestAdmissionText ||
        pageFallbackText ||
        normalizeWhitespace(captureResult.selectedSourceFile) ||
        captureResult.admissionOrderTitle ||
        null;

      if (!bestAdmissionText && !pageFallbackText && normalizeWhitespace(captureResult.selectedSourceFile)) {
        extractionMethodUsed = "metadata";
      }

      await writeFile(
        captureResult.extractedTextPath,
        `${normalizeWhitespace(admissionOrderTextExcerpt) || ""}\n`,
        "utf8",
      );
      rawExtractedTextSource = "dom";
      const admissionTextAnalysis = analyzeDocumentText(admissionOrderTextExcerpt ?? "");
      domExtractionRejectedReasons = admissionTextAnalysis.rejectionReasons;
      admissionReasonSnippets = extractAdmissionReasonSnippets(admissionTextAnalysis.normalizedText);
      admissionReasonPrimary = admissionReasonSnippets[0] ?? null;
      possibleIcd10Codes = extractPossibleIcd10Codes(admissionTextAnalysis.normalizedText);
      const extractedTextLength = admissionTextAnalysis.normalizedText.length;
      extractionSuccess =
        admissionTextAnalysis.accepted &&
        (captureResult.pdfResponseDetected || extractedTextLength >= 120 || possibleIcd10Codes.length > 0);
      const queuedForLlm = !extractionSuccess;
      admissionOrderAccessible =
        admissionOrderAccessible ||
        Boolean(
          captureResult.selectedSourceFileNormalized &&
            (extractionSuccess || extractionMethodUsed === "metadata" || captureResult.viewerDetected),
        );

      await writeFile(
        captureResult.sourceMetaPath,
        JSON.stringify(
          {
            selectedSourceFile: captureResult.selectedSourceFile,
            selectedSourceFileNormalized: captureResult.selectedSourceFileNormalized,
            admissionOrderTitle: captureResult.admissionOrderTitle,
            admissionOrderSelectorUsed: captureResult.admissionOrderSelectorUsed,
            sourceUrlBeforeClick: input.chartUrl,
            sourceUrlAfterClick: this.page.url(),
            matchedReferralFileLabel: captureResult.referralFileLabel
              ? normalizeUploadFileLabelForDisplay(captureResult.referralFileLabel)
              : null,
            normalizedFileLabels: captureResult.normalizedFileLabels,
            matchedSourceDocuments: captureResult.matchedSourceDocuments,
            viewerDetected: captureResult.viewerDetected,
            viewerMarkerSamples: captureResult.viewerMarkerSamples,
            printButtonDetected: captureResult.printButtonDetected,
            printButtonVisible: captureResult.printButtonVisible,
            printButtonSelectorUsed: captureResult.printButtonSelectorUsed,
            printClickSucceeded: captureResult.printClickSucceeded,
            pdfResponseDetected: captureResult.pdfResponseDetected,
            pdfResponseUrl: captureResult.pdfResponseUrl,
            pdfContentType: captureResult.pdfContentType,
            pdfSavedPath: captureResult.pdfSavedPath,
            pdfByteSize: captureResult.pdfByteSize,
            printAcquisitionMethodUsed: captureResult.printAcquisitionMethodUsed,
            printedPdfSaved: Boolean(captureResult.printedPdfPath),
            printedPdfPath: captureResult.printedPdfPath,
            sourcePdfPath: captureResult.pdfSavedPath,
            extractedTextPath: captureResult.extractedTextPath,
            extractionResultPath: captureResult.extractionResultPath,
            extractedTextLength,
            rawExtractedTextSource,
            domExtractionRejectedReasons,
            extractionSuccess,
            queuedForLlm,
            extractionPolicyDecision,
            generatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf8",
      );
      await writeFile(
        captureResult.extractionResultPath,
        JSON.stringify(
          {
            documentType: "ORDER",
            sourceLabel: captureResult.selectedSourceFile,
            normalizedSourceLabel: captureResult.selectedSourceFileNormalized,
            viewerDetected: captureResult.viewerDetected,
            printButtonDetected: captureResult.printButtonDetected,
            printButtonSelectorUsed: captureResult.printButtonSelectorUsed,
            printClickSucceeded: captureResult.printClickSucceeded,
            pdfResponseDetected: captureResult.pdfResponseDetected,
            pdfResponseUrl: captureResult.pdfResponseUrl,
            pdfContentType: captureResult.pdfContentType,
            pdfSavedPath: captureResult.pdfSavedPath,
            pdfByteSize: captureResult.pdfByteSize,
            printAcquisitionMethodUsed: captureResult.printAcquisitionMethodUsed,
            printedPdfSaved: Boolean(captureResult.printedPdfPath),
            printedPdfPath: captureResult.printedPdfPath,
            sourcePdfPath: captureResult.pdfSavedPath,
            extractedTextPath: captureResult.extractedTextPath,
            extractedTextLength,
            extractionMethodUsed,
            rawExtractedTextSource,
            domExtractionRejectedReasons,
            extractionSuccess,
            queuedForLlm,
            extractionPolicyDecision,
            admissionReasonPrimary,
            admissionReasonSnippets,
            possibleIcd10Codes,
            textPreview: admissionTextAnalysis.normalizedText.slice(0, 500) || null,
            generatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf8",
      );

      evidence.push(`Extracted text length: ${extractedTextLength}`);
      evidence.push(`Raw extracted text source: ${rawExtractedTextSource ?? "none"}`);
      evidence.push(`DOM extraction rejected reasons: ${domExtractionRejectedReasons.join(" | ") || "none"}`);
      evidence.push(`Extraction method used: ${extractionMethodUsed ?? "none"}`);
      evidence.push(`Extraction success: ${extractionSuccess}`);
      evidence.push(`Queued for LLM: ${queuedForLlm}`);
      evidence.push(
        `Admission text candidates ranked: ${rankedAdmissionTextCandidates
          .map((entry, index) => `[${index + 1}] score=${entry.score.toFixed(1)} text=${entry.value.slice(0, 220)}`)
          .join(" || ") || "none"}`,
      );
      evidence.push(`Admission reason primary: ${admissionReasonPrimary ?? "none"}`);
      evidence.push(`Admission reason snippets: ${admissionReasonSnippets.join(" | ") || "none"}`);
      evidence.push(`Possible ICD-10 codes: ${possibleIcd10Codes.join(" | ") || "none"}`);
      evidence.push(`Admission order text excerpt: ${normalizeWhitespace(admissionOrderTextExcerpt).slice(0, 900) || "none"}`);
    }

    stepLogs.push(createAutomationStepLog({
      step: "file_uploads_open",
      message: captureResult.fileUploadsAccessible
        ? "Opened File Uploads section and enumerated available uploaded records."
        : "Could not verify File Uploads section content after sidebar navigation.",
      urlBefore: input.chartUrl,
      urlAfter: this.page.url(),
      selectorUsed: captureResult.fileUploadsSelectorUsed,
      found: withContextSignals([
        `fileUploadsAccessible:${captureResult.fileUploadsAccessible}`,
        `patientFileUploadsRouteDetected:${captureResult.patientFileUploadsRouteDetected}`,
        `genericProviderDocumentsRouteDetected:${captureResult.genericProviderDocumentsRouteDetected}`,
        `fileUploadsSidebarClickSucceeded:${captureResult.fileUploadsSidebarClickSucceeded}`,
        `pageComponentDetected:${captureResult.fileUploadsPageComponentDetected}`,
        `traversalMode:${captureResult.fileUploadsTraversalMode}`,
        `usedChartDocumentsFallback:${captureResult.usedChartDocumentsFallback}`,
        `matchedFileUploadsLabel:${captureResult.matchedFileUploadsLabel ?? "none"}`,
        `matchedFileUploadsHref:${captureResult.matchedFileUploadsHref ?? "none"}`,
        `referralFolderSelected:${captureResult.referralFolderSelected}`,
        `referralFolderLabel:${captureResult.referralFolderLabel ?? "none"}`,
        `matchedReferralFileLabel:${captureResult.referralFileLabel ?? "none"}`,
        `normalizedFileLabels:${captureResult.normalizedFileLabels.join(" | ") || "none"}`,
        `matchedSourceDocuments:${captureResult.matchedSourceDocuments.map((entry) => entry.normalizedLabel).join(" | ") || "none"}`,
        `selectedSourceFile:${captureResult.selectedSourceFile ?? "none"}`,
        `viewerDetected:${captureResult.viewerDetected}`,
        `printButtonDetected:${captureResult.printButtonDetected}`,
        `printButtonVisible:${captureResult.printButtonVisible}`,
        `printClickSucceeded:${captureResult.printClickSucceeded}`,
        `pdfResponseDetected:${captureResult.pdfResponseDetected}`,
        `pdfResponseUrl:${captureResult.pdfResponseUrl ?? "none"}`,
        `pdfContentType:${captureResult.pdfContentType ?? "none"}`,
        `pdfSavedPath:${captureResult.pdfSavedPath ?? "none"}`,
        `pdfByteSize:${captureResult.pdfByteSize}`,
        `printAcquisitionMethodUsed:${captureResult.printAcquisitionMethodUsed}`,
        `sourcePdfPath:${captureResult.sourcePdfPath ?? "none"}`,
        `printedPdfPath:${captureResult.printedPdfPath ?? "none"}`,
        `extractionMethodUsed:${extractionMethodUsed ?? "none"}`,
        `rawExtractedTextSource:${rawExtractedTextSource ?? "none"}`,
        `domExtractionRejectedReasons:${domExtractionRejectedReasons.join(" | ") || "none"}`,
        `extractionSuccess:${extractionSuccess}`,
        `uploadedDocumentCount:${captureResult.visibleUploadedDocuments.length}`,
      ]),
      missing: captureResult.fileUploadsAccessible ? [] : ["File Uploads content"],
      evidence,
      safeReadConfirmed: true,
    }));

    stepLogs.push(createAutomationStepLog({
      step: "admission_order_open",
      message: admissionOrderAccessible
        ? "Opened Admission Order from File Uploads for coding-reference verification."
        : "Admission Order could not be located/opened from File Uploads.",
      urlBefore: input.chartUrl,
      urlAfter: this.page.url(),
      selectorUsed: captureResult.admissionOrderSelectorUsed ?? captureResult.fileUploadsSelectorUsed,
      found: withContextSignals([
        `fileUploadsAccessible:${captureResult.fileUploadsAccessible}`,
        `patientFileUploadsRouteDetected:${captureResult.patientFileUploadsRouteDetected}`,
        `genericProviderDocumentsRouteDetected:${captureResult.genericProviderDocumentsRouteDetected}`,
        `fileUploadsSidebarClickSucceeded:${captureResult.fileUploadsSidebarClickSucceeded}`,
        `pageComponentDetected:${captureResult.fileUploadsPageComponentDetected}`,
        `traversalMode:${captureResult.fileUploadsTraversalMode}`,
        `usedChartDocumentsFallback:${captureResult.usedChartDocumentsFallback}`,
        `referralFolderSelected:${captureResult.referralFolderSelected}`,
        `admissionOrderAccessible:${admissionOrderAccessible}`,
        `admissionOrderTitle:${captureResult.admissionOrderTitle ?? "none"}`,
        `selectedSourceFile:${captureResult.selectedSourceFile ?? "none"}`,
        `viewerDetected:${captureResult.viewerDetected}`,
        `printButtonDetected:${captureResult.printButtonDetected}`,
        `printClickSucceeded:${captureResult.printClickSucceeded}`,
        `pdfResponseDetected:${captureResult.pdfResponseDetected}`,
        `pdfResponseUrl:${captureResult.pdfResponseUrl ?? "none"}`,
        `pdfContentType:${captureResult.pdfContentType ?? "none"}`,
        `pdfSavedPath:${captureResult.pdfSavedPath ?? "none"}`,
        `pdfByteSize:${captureResult.pdfByteSize}`,
        `printAcquisitionMethodUsed:${captureResult.printAcquisitionMethodUsed}`,
        `sourcePdfPath:${captureResult.sourcePdfPath ?? "none"}`,
        `printedPdfPath:${captureResult.printedPdfPath ?? "none"}`,
        `extractionMethodUsed:${extractionMethodUsed ?? "none"}`,
        `rawExtractedTextSource:${rawExtractedTextSource ?? "none"}`,
        `domExtractionRejectedReasons:${domExtractionRejectedReasons.join(" | ") || "none"}`,
        `extractionSuccess:${extractionSuccess}`,
        `admissionReasonPrimary:${admissionReasonPrimary ?? "none"}`,
        `possibleIcd10Codes:${possibleIcd10Codes.join(" | ") || "none"}`,
      ]),
      missing: admissionOrderAccessible ? [] : ["Admission Order"],
      evidence,
      safeReadConfirmed: true,
    }));

    stepLogs.push(createAutomationStepLog({
      step: "qa_summary",
      message: admissionOrderAccessible
        ? "File Uploads and Admission Order were successfully accessed for coding reference."
        : "File Uploads stage completed but Admission Order was not accessible.",
      urlBefore: input.chartUrl,
      urlAfter: this.page.url(),
      selectorUsed: captureResult.admissionOrderSelectorUsed ?? captureResult.fileUploadsSelectorUsed,
      found: withContextSignals([
        `fileUploadsAccessible:${captureResult.fileUploadsAccessible}`,
        `patientFileUploadsRouteDetected:${captureResult.patientFileUploadsRouteDetected}`,
        `genericProviderDocumentsRouteDetected:${captureResult.genericProviderDocumentsRouteDetected}`,
        `fileUploadsSidebarClickSucceeded:${captureResult.fileUploadsSidebarClickSucceeded}`,
        `pageComponentDetected:${captureResult.fileUploadsPageComponentDetected}`,
        `traversalMode:${captureResult.fileUploadsTraversalMode}`,
        `usedChartDocumentsFallback:${captureResult.usedChartDocumentsFallback}`,
        `referralFolderSelected:${captureResult.referralFolderSelected}`,
        `admissionOrderAccessible:${admissionOrderAccessible}`,
        `admissionOrderTitle:${captureResult.admissionOrderTitle ?? "none"}`,
        `selectedSourceFile:${captureResult.selectedSourceFile ?? "none"}`,
        `viewerDetected:${captureResult.viewerDetected}`,
        `printButtonDetected:${captureResult.printButtonDetected}`,
        `printClickSucceeded:${captureResult.printClickSucceeded}`,
        `pdfResponseDetected:${captureResult.pdfResponseDetected}`,
        `pdfResponseUrl:${captureResult.pdfResponseUrl ?? "none"}`,
        `pdfContentType:${captureResult.pdfContentType ?? "none"}`,
        `pdfSavedPath:${captureResult.pdfSavedPath ?? "none"}`,
        `pdfByteSize:${captureResult.pdfByteSize}`,
        `printAcquisitionMethodUsed:${captureResult.printAcquisitionMethodUsed}`,
        `sourcePdfPath:${captureResult.sourcePdfPath ?? "none"}`,
        `printedPdfPath:${captureResult.printedPdfPath ?? "none"}`,
        `extractionMethodUsed:${extractionMethodUsed ?? "none"}`,
        `rawExtractedTextSource:${rawExtractedTextSource ?? "none"}`,
        `domExtractionRejectedReasons:${domExtractionRejectedReasons.join(" | ") || "none"}`,
        `extractionSuccess:${extractionSuccess}`,
        `admissionReasonPrimary:${admissionReasonPrimary ?? "none"}`,
        `possibleIcd10Codes:${possibleIcd10Codes.join(" | ") || "none"}`,
      ]),
      missing: [
        ...(captureResult.fileUploadsAccessible ? [] : ["File Uploads"]),
        ...(admissionOrderAccessible ? [] : ["Admission Order"]),
      ],
      evidence,
      safeReadConfirmed: true,
    }));

    this.options.logger?.info(
      {
        postNavigationUrl: this.page.url(),
        socSelectorUsed: input.socSelectorUsed,
        matchedSocAnchorText: input.matchedSocAnchorText,
        fileUploadsSelectorUsed: captureResult.fileUploadsSelectorUsed,
        matchedFileUploadsLabel: captureResult.matchedFileUploadsLabel,
        matchedFileUploadsHref: captureResult.matchedFileUploadsHref,
        fileUploadsSidebarClickSucceeded: captureResult.fileUploadsSidebarClickSucceeded,
        fileUploadsAccessible: captureResult.fileUploadsAccessible,
        patientFileUploadsRouteDetected: captureResult.patientFileUploadsRouteDetected,
        genericProviderDocumentsRouteDetected: captureResult.genericProviderDocumentsRouteDetected,
        fileUploadsPageComponentDetected: captureResult.fileUploadsPageComponentDetected,
        fileUploadsTraversalMode: captureResult.fileUploadsTraversalMode,
        usedChartDocumentsFallback: captureResult.usedChartDocumentsFallback,
        referralFolderSelected: captureResult.referralFolderSelected,
        referralFolderLabel: captureResult.referralFolderLabel,
        referralFileLabel: captureResult.referralFileLabel,
        normalizedFileLabels: captureResult.normalizedFileLabels.slice(0, 20),
        matchedSourceDocuments: captureResult.matchedSourceDocuments.slice(0, 20),
        selectedSourceFile: captureResult.selectedSourceFile,
        selectedSourceFileNormalized: captureResult.selectedSourceFileNormalized,
        viewerDetected: captureResult.viewerDetected,
        printButtonDetected: captureResult.printButtonDetected,
        printButtonVisible: captureResult.printButtonVisible,
        printButtonSelectorUsed: captureResult.printButtonSelectorUsed,
        printClickSucceeded: captureResult.printClickSucceeded,
        pdfResponseDetected: captureResult.pdfResponseDetected,
        pdfResponseUrl: captureResult.pdfResponseUrl,
        pdfContentType: captureResult.pdfContentType,
        pdfSavedPath: captureResult.pdfSavedPath,
        pdfByteSize: captureResult.pdfByteSize,
        printAcquisitionMethodUsed: captureResult.printAcquisitionMethodUsed,
        sourcePdfPath: captureResult.sourcePdfPath,
        printedPdfPath: captureResult.printedPdfPath,
        sourceMetaPath: captureResult.sourceMetaPath,
        extractedTextPath: captureResult.extractedTextPath,
        extractionResultPath: captureResult.extractionResultPath,
        extractionMethodUsed,
        rawExtractedTextSource,
        domExtractionRejectedReasons,
        extractionSuccess,
        fileUploadsUrl: captureResult.fileUploadsUrl,
        uploadedDocumentCount: captureResult.visibleUploadedDocuments.length,
        visibleUploadedDocuments: captureResult.visibleUploadedDocuments.slice(0, 20),
        admissionOrderSelectorUsed: captureResult.admissionOrderSelectorUsed,
        admissionOrderAccessible,
        admissionOrderTitle: captureResult.admissionOrderTitle,
        admissionReasonPrimary,
        admissionReasonSnippets,
        possibleIcd10Codes,
      },
      "File Uploads and Admission Order read-only navigation completed",
    );

    return {
      fileUploadsAccessible: captureResult.fileUploadsAccessible,
      fileUploadsUrl: captureResult.fileUploadsUrl,
      visibleUploadedDocuments: captureResult.visibleUploadedDocuments,
      admissionOrderAccessible,
      admissionOrderTitle: captureResult.admissionOrderTitle,
      admissionReasonSnippets,
      admissionReasonPrimary,
      possibleIcd10Codes,
      rawExtractedTextSource,
      domExtractionRejectedReasons,
      admissionOrderTextExcerpt,
      sourcePdfPath: captureResult.sourcePdfPath,
      printedPdfPath: captureResult.printedPdfPath,
      sourceMetaPath: captureResult.sourceMetaPath,
      extractedTextPath: captureResult.extractedTextPath,
      extractionResultPath: captureResult.extractionResultPath,
      fileUploadsSelectorUsed: captureResult.fileUploadsSelectorUsed,
      admissionOrderSelectorUsed: captureResult.admissionOrderSelectorUsed,
      stepLogs,
    };
  }

  private async extractOasisCalendarScope(outputDirectory: string): Promise<{
    calendarScope: OasisCalendarScopeResult;
    calendarScopePath: string;
    stepLogs: AutomationStepLog[];
  }> {
    await waitForPortalPageSettled(this.page, this.options.debugConfig);
    const chartUrl = this.page.url();
    this.options.logger?.info(
      {
        chartUrl,
      },
      "entering OASIS calendar scope extraction",
    );

    const stepLogs: AutomationStepLog[] = [];
    const pageMarkerResolution = await resolveVisibleLocatorList({
      page: this.page,
      candidates: chartCalendarSelectors.pageMarkers,
      step: "oasis_calendar_page_markers",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      maxItems: 8,
    });
    const pageMarkersFound = (
      await Promise.all(
        pageMarkerResolution.items.map(async (item) => readLocatorLabel(item.locator) ?? item.candidate.description),
      )
    ).filter((entry): entry is string => Boolean(entry));

    const headerResolution = await resolveFirstVisibleLocator({
      page: this.page,
      candidates: chartCalendarSelectors.headerSelectors,
      step: "oasis_calendar_header",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      settle: async () => waitForPortalPageSettled(this.page, this.options.debugConfig),
    });
    const rawHeaderText = headerResolution.locator
      ? normalizeWhitespace(await headerResolution.locator.innerText().catch(() => null))
      : "";
    const calendarRootResolution = await resolveFirstVisibleLocator({
      page: this.page,
      candidates: chartCalendarSelectors.calendarRootSelectors,
      step: "oasis_calendar_root",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      settle: async () => waitForPortalPageSettled(this.page, this.options.debugConfig),
    });
    const calendarRoot = calendarRootResolution.locator ?? this.page.locator("main").first();
    const weekdayHeaders = await resolveWeekdayHeaders(this.page);
    const weekRowResolution = await resolveVisibleLocatorList({
      page: calendarRoot,
      candidates: chartCalendarSelectors.weekRowSelectors,
      step: "oasis_calendar_week_rows",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      maxItems: 12,
    });

    const rawDayCells: RawOasisCalendarDayCellInput[] = [];
    const rawTilesSeen = new Set<string>();
    let totalTileCount = 0;
    let firstTileSelectorUsed: string | undefined;

    const rowLocators = weekRowResolution.items.length > 0
      ? weekRowResolution.items
      : [{
          locator: calendarRoot,
          candidate: { description: "calendar root fallback" },
        }];
    const actualWeekRowCount = rowLocators.length;

    for (let rowIndex = 0; rowIndex < rowLocators.length; rowIndex += 1) {
      const rowEntry = rowLocators[rowIndex]!;
      const weekLabel = await inferWeekLabel(rowEntry.locator, rowIndex);
      const dayCellResolution = await resolveVisibleLocatorList({
        page: rowEntry.locator,
        candidates: chartCalendarSelectors.dayCellSelectors,
        step: "oasis_calendar_day_cells",
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
        maxItems: 14,
      });

      for (let cellIndex = 0; cellIndex < dayCellResolution.items.length; cellIndex += 1) {
        const cellEntry = dayCellResolution.items[cellIndex]!;
        const dateLabel = await inferCalendarDateLabel(cellEntry.locator);
        const normalizedDate = await inferCalendarNormalizedDate(cellEntry.locator);
        const weekday = await inferWeekdayFromCell(cellEntry.locator, weekdayHeaders, cellIndex % 7);
        const tileEntries = await resolveTileLocatorsForCell(cellEntry.locator);
        const rawCellText = normalizeWhitespace(await cellEntry.locator.innerText().catch(() => null));
        const safeDateLabel = dateLabel ?? rawCellText.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b\.?\s+\d{1,2}\b/i)?.[0] ?? `Cell ${rowIndex + 1}-${cellIndex + 1}`;
        const rawTileInputs: RawOasisCalendarTileInput[] = [];

        for (let tileIndex = 0; tileIndex < tileEntries.length; tileIndex += 1) {
          const tileEntry = tileEntries[tileIndex]!;
          const rawText = normalizeWhitespace(await tileEntry.locator.innerText().catch(() => null));
          if (!rawText) {
            continue;
          }

          const titleText = await readCalendarTileTitle(tileEntry.locator);
          const tooltipTitles = await readTooltipTitles(tileEntry.locator);
          const titleAttributes = await readCalendarTileTitleAttributes(tileEntry.locator);
          const tileCategory = inferCalendarTileCategory(rawText, titleText, tooltipTitles);
          const markerClues = inferCalendarTileMarkerClues(tooltipTitles, titleAttributes, rawText);
          const href = await tileEntry.locator.getAttribute("href").catch(() => null) ??
            await tileEntry.locator.locator("a[href]").first().getAttribute("href").catch(() => null) ??
            undefined;
          const attributeSummary = [
            ...(await readCalendarTileAttributeSummary(tileEntry.locator)),
            `cellTileIndex=${tileIndex + 1}`,
            `weekLabel=${weekLabel}`,
            `weekday=${weekday ?? "unknown"}`,
            `dateLabel=${safeDateLabel}`,
            ...(normalizedDate ? [`normalizedDate=${normalizedDate}`] : []),
            ...(tileCategory ? [`category=${tileCategory}`] : []),
            ...markerClues.map((marker) => `marker=${marker}`),
          ];
          const classNames = await readTileClassNames(tileEntry.locator);
          const selectorFamily = inferSelectorFamily(tileEntry.selectorUsed);
          const dedupeKey = [
            weekLabel,
            weekday ?? "",
            safeDateLabel,
            titleText ?? "",
            rawText,
            tooltipTitles.join("|"),
            href ?? "",
          ].join("::");
          if (rawTilesSeen.has(dedupeKey)) {
            continue;
          }

          rawTilesSeen.add(dedupeKey);
          if (!firstTileSelectorUsed) {
            firstTileSelectorUsed = tileEntry.selectorUsed;
          }
          totalTileCount += 1;
          rawTileInputs.push({
            titleText,
            rawText,
            tooltipTitles,
            titleAttributes,
            href,
            dateLabel: safeDateLabel,
            attributeSummary,
            selectorFamily,
            classNames,
          });
        }

        if (!dateLabel && rawTileInputs.length === 0) {
          continue;
        }

        rawDayCells.push({
          weekLabel,
          weekday,
          dateLabel: safeDateLabel,
          normalizedDate,
          attributeSummary: [
            `rowSelector=${rowEntry.candidate.description}`,
            `cellSelector=${cellEntry.candidate.description}`,
            `weekday=${weekday ?? "unknown"}`,
            `dateLabel=${safeDateLabel}`,
            ...(normalizedDate ? [`normalizedDate=${normalizedDate}`] : []),
          ],
          tileSelectorUsed: tileEntries[0]?.selectorUsed,
          tiles: rawTileInputs,
        });
      }
    }

    if (rawDayCells.length === 0 || totalTileCount === 0) {
      const debugArtifacts = await capturePageDebugArtifacts({
        page: this.page,
        outputDir: this.options.debugDir,
        step: "oasis-calendar-grid",
        reason: rawDayCells.length === 0 ? "no-usable-day-cells" : "no-visible-calendar-tiles",
        debugConfig: this.options.debugConfig,
        textHints: ["calendar", "oasis", "start of care", "recert", "discharge"],
      });

      stepLogs.push(
        createAutomationStepLog({
          step: "oasis_calendar_scope",
          message: rawDayCells.length === 0
            ? "OASIS calendar scope extraction failed because zero usable calendar day cells were found."
            : "OASIS calendar scope extraction failed because zero visible calendar tiles were found inside parsed calendar cells.",
          urlBefore: chartUrl,
          urlAfter: this.page.url(),
          missing: rawDayCells.length === 0 ? ["usable calendar day cells"] : ["visible calendar tiles"],
          evidence: [
            `Chart URL: ${chartUrl}`,
            `Calendar root selector used: ${calendarRootResolution.matchedCandidate?.description ?? "none"}`,
            `Week row count: ${actualWeekRowCount}`,
            `Day cell count: ${rawDayCells.length}`,
            `Header selector used: ${headerResolution.matchedCandidate?.description ?? "none"}`,
            `Header text: ${rawHeaderText || "none"}`,
            ...pageMarkerResolution.attempts.map(selectorAttemptToEvidence),
            ...calendarRootResolution.attempts.map(selectorAttemptToEvidence),
            ...weekRowResolution.attempts.map(selectorAttemptToEvidence),
            debugArtifacts.summaryPath ? `Debug summary: ${debugArtifacts.summaryPath}` : "",
            debugArtifacts.htmlPath ? `Debug HTML: ${debugArtifacts.htmlPath}` : "",
            debugArtifacts.screenshotPath ? `Debug screenshot: ${debugArtifacts.screenshotPath}` : "",
          ].filter(Boolean),
          safeReadConfirmed: true,
        }),
      );

      throw new Error(rawDayCells.length === 0
        ? "OASIS calendar scope extraction found zero usable calendar day cells on the patient chart page."
        : "OASIS calendar scope extraction found zero visible calendar tiles inside parsed calendar cells.");
    }

    const calendarScope = extractOasisCalendarScope({
      chartUrl,
      rawHeaderText,
      rawDayCells,
      diagnostics: {
        weekRowCount: actualWeekRowCount,
        dayCellCount: rawDayCells.length,
        tileSelectorUsed: firstTileSelectorUsed,
        headerSelectorUsed: headerResolution.matchedCandidate?.description ?? undefined,
        calendarSelectorUsed: calendarRootResolution.matchedCandidate?.description ?? pageMarkerResolution.items[0]?.candidate.description ?? undefined,
        pageMarkersFound,
        warnings: rawHeaderText ? [] : ["Calendar header extraction returned partial data."],
      },
    });

    const calendarScopePath = path.join(outputDirectory, "oasis-calendar-scope.json");
    await writeFile(calendarScopePath, JSON.stringify(calendarScope, null, 2), "utf8");
    const dateCountPayload = buildDateCountPayload(calendarScope);
    const validationWarnings = [
      ...(calendarScope.diagnostics.billingPeriodCellCount === 0 ? ["No billing-period calendar cells were identified after header/grid billing-period detection."] : []),
      ...(calendarScope.diagnostics.visibleTileCount === 0 ? ["No tiles were captured from billing-period calendar cells."] : []),
    ];

    if (validationWarnings.length > 0) {
      this.options.logger?.error(
        {
          chartUrl,
          billingPeriod: calendarScope.billingPeriod,
          billingPeriodCellCount: calendarScope.diagnostics.billingPeriodCellCount,
          visibleTileCount: calendarScope.diagnostics.visibleTileCount,
          dateCounts: dateCountPayload.dates,
          warnings: [...calendarScope.diagnostics.warnings, ...validationWarnings],
        },
        "OASIS calendar extraction validation failed",
      );
    }

    this.options.logger?.info(
      {
        chartUrl,
        headerSummary: calendarScope.header,
      },
      "OASIS calendar header extraction result",
    );
    this.options.logger?.info(
      {
        chartUrl,
        billingPeriod: calendarScope.billingPeriod,
        warnings: calendarScope.diagnostics.warnings,
      },
      "OASIS first billing period detection result",
    );
    this.options.logger?.info(
      {
        chartUrl,
        weekRowCount: calendarScope.diagnostics.weekRowCount,
        dayCellCount: calendarScope.diagnostics.dayCellCount,
        billingPeriodCellCount: calendarScope.diagnostics.billingPeriodCellCount,
      },
      "OASIS calendar grid extraction result",
    );
    this.options.logger?.info(
      {
        chartUrl,
        segments: calendarScope.segments.map((segment) => ({
          segmentNumber: segment.segmentNumber,
          dayRangeLabel: segment.dayRangeLabel,
          startDayNumber: segment.startDayNumber,
          endDayNumber: segment.endDayNumber,
          tileCount: segment.tileCount,
          oasisTileCount: segment.oasisTileCount,
        })),
      },
      "OASIS billing period segment construction result",
    );

    this.options.logger?.info(
      {
        chartUrl,
        headerSummary: calendarScope.header,
        billingPeriod: calendarScope.billingPeriod,
        tileSelectorUsed: calendarScope.diagnostics.tileSelectorUsed,
        visibleTileCount: calendarScope.diagnostics.visibleTileCount,
        firstBillingPeriodTileCount: calendarScope.diagnostics.firstBillingPeriodTileCount,
        oasisTileCount: calendarScope.diagnostics.oasisTileCount,
        billingPeriodCellCount: calendarScope.diagnostics.billingPeriodCellCount,
        warnings: [...calendarScope.diagnostics.warnings, ...validationWarnings],
      },
      "completed OASIS calendar scope extraction",
    );
    this.options.logger?.info(buildAllTileLogPayload(calendarScope), "OASIS calendar tiles captured");
    this.options.logger?.info(dateCountPayload, "OASIS calendar tile counts by billing-period date");
    for (const datePayload of buildDateCellLogPayloads(calendarScope)) {
      this.options.logger?.info(datePayload, "OASIS calendar tiles by billing-period date cell");
    }
    for (const oasisDatePayload of buildOasisDateLogPayloads(calendarScope)) {
      this.options.logger?.info(oasisDatePayload, "OASIS-related calendar tiles by billing-period date cell");
    }
    for (const segmentPayload of buildSegmentLogPayloads(calendarScope)) {
      this.options.logger?.info(segmentPayload, "OASIS calendar tiles by 5-day billing segment");
    }
    for (const oasisSegmentPayload of buildOasisSegmentLogPayloads(calendarScope)) {
      this.options.logger?.info(oasisSegmentPayload, "OASIS-related calendar tiles by 5-day billing segment");
    }

    stepLogs.push(
      createAutomationStepLog({
        step: "oasis_calendar_scope",
        message: `Extracted ${calendarScope.visibleTiles.length} visible calendar tile(s) from the patient chart calendar.`,
        urlBefore: chartUrl,
        urlAfter: this.page.url(),
        selectorUsed: calendarScope.diagnostics.tileSelectorUsed ?? null,
        found: calendarScope.oasisTiles.slice(0, 8).map((tile) => tile.title),
        evidence: [
          `Current chart URL: ${chartUrl}`,
          `Calendar root selector used: ${calendarScope.diagnostics.calendarSelectorUsed ?? "none"}`,
          `Header selector used: ${calendarScope.diagnostics.headerSelectorUsed ?? "none"}`,
          `Header summary extracted: ${JSON.stringify(calendarScope.header)}`,
          `Billing period detected: ${calendarScope.billingPeriod.detected}`,
          `Billing period start/end: ${calendarScope.billingPeriod.startDateText ?? "none"} -> ${calendarScope.billingPeriod.endDateText ?? "none"}`,
          `Week row count: ${calendarScope.diagnostics.weekRowCount}`,
          `Day cell count: ${calendarScope.diagnostics.dayCellCount}`,
          `Billing period cell count: ${calendarScope.diagnostics.billingPeriodCellCount}`,
          `Segment construction result: ${calendarScope.segments.map((segment) => `${segment.segmentNumber}:${segment.dayRangeLabel}:${segment.tileCount}/${segment.oasisTileCount}`).join(" | ") || "none"}`,
          `Tile selector used: ${calendarScope.diagnostics.tileSelectorUsed ?? "none"}`,
          `Visible tile count: ${calendarScope.diagnostics.visibleTileCount}`,
          `First billing period tile count: ${calendarScope.diagnostics.firstBillingPeriodTileCount}`,
          `OASIS tile count: ${calendarScope.diagnostics.oasisTileCount}`,
          `Warnings: ${[...calendarScope.diagnostics.warnings, ...validationWarnings].join(" | ") || "none"}`,
          `Calendar scope result path: ${calendarScopePath}`,
        ],
        safeReadConfirmed: true,
      }),
    );
    const segmentSummary = calendarScope.segments
      .map((segment) => `${segment.segmentNumber}:${segment.dayRangeLabel}:${segment.tileCount}/${segment.oasisTileCount}`)
      .join(" | ") || "none";
    const qaSummaryEvidence = [
      `Current chart URL: ${chartUrl}`,
      `Billing period detected: ${calendarScope.billingPeriod.detected}`,
      `Billing period start/end: ${calendarScope.billingPeriod.startDateText ?? "none"} -> ${calendarScope.billingPeriod.endDateText ?? "none"}`,
      `Extraction path used: ${calendarScope.diagnostics.headerSelectorUsed ? "header_or_header+grid_fallback" : "grid_fallback"}`,
      `Billing period cell count: ${calendarScope.diagnostics.billingPeriodCellCount}`,
      `Visible tile count: ${calendarScope.diagnostics.visibleTileCount}`,
      `OASIS tile count: ${calendarScope.diagnostics.oasisTileCount}`,
      `Counts by date: ${dateCountPayload.dates.map((entry) => `${entry.normalizedDate ?? entry.dateLabel}:${entry.tileCount}/${entry.oasisTileCount}`).join(" | ") || "none"}`,
      `Segment counts: ${segmentSummary}`,
      `Warnings: ${[...calendarScope.diagnostics.warnings, ...validationWarnings].join(" | ") || "none"}`,
      `Calendar scope result path: ${calendarScopePath}`,
    ];
    stepLogs.push(
      createAutomationStepLog({
        step: "qa_summary",
        message: `Calendar QA summary captured with ${calendarScope.diagnostics.billingPeriodCellCount} billing-period cell(s), ${calendarScope.diagnostics.visibleTileCount} tile(s), and ${calendarScope.diagnostics.oasisTileCount} OASIS-related tile(s).`,
        urlBefore: chartUrl,
        urlAfter: this.page.url(),
        selectorUsed: calendarScope.diagnostics.tileSelectorUsed ?? null,
        found: [
          `billing_period_detected:${calendarScope.billingPeriod.detected}`,
          `billing_period_cells:${calendarScope.diagnostics.billingPeriodCellCount}`,
          `visible_tiles:${calendarScope.diagnostics.visibleTileCount}`,
          `oasis_tiles:${calendarScope.diagnostics.oasisTileCount}`,
          ...calendarScope.segments.map((segment) => `segment_${segment.segmentNumber}:${segment.tileCount}/${segment.oasisTileCount}`),
        ],
        missing: calendarScope.diagnostics.billingPeriodCellCount > 0 && calendarScope.diagnostics.visibleTileCount > 0
          ? []
          : [
          ...(calendarScope.billingPeriod.detected ? [] : ["billing period detection"]),
          ...(calendarScope.diagnostics.billingPeriodCellCount > 0 ? [] : ["billing-period calendar cells"]),
          ...(calendarScope.diagnostics.visibleTileCount > 0 ? [] : ["billing-period calendar tiles"]),
          ...validationWarnings,
        ],
        evidence: qaSummaryEvidence,
        safeReadConfirmed: true,
      }),
    );
    this.options.logger?.info(
      {
        chartUrl,
        billingPeriod: calendarScope.billingPeriod,
        billingPeriodCellCount: calendarScope.diagnostics.billingPeriodCellCount,
        visibleTileCount: calendarScope.diagnostics.visibleTileCount,
        oasisTileCount: calendarScope.diagnostics.oasisTileCount,
        segmentSummary,
        warnings: [...calendarScope.diagnostics.warnings, ...validationWarnings],
      },
      "qa_summary emitted",
    );

    return {
      calendarScope,
      calendarScopePath,
      stepLogs,
    };
  }

  private async ensureDocumentsSectionVisible(): Promise<{
    log: AutomationStepLog | null;
  }> {
    const resolution = await resolveFirstVisibleLocator({
      page: this.page,
      candidates: chartDocumentSelectors.documentsTabSelectors,
      step: "documents_tab",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      settle: async () => waitForPortalPageSettled(this.page, this.options.debugConfig),
    });

    if (!resolution.locator) {
      const debugArtifacts = await capturePageDebugArtifacts({
        page: this.page,
        outputDir: this.options.debugDir,
        step: "chart-documents",
        reason: "documents-tab-missing",
        debugConfig: this.options.debugConfig,
        textHints: ["documents", "attachments", "clinical"],
      });

      return {
        log: createAutomationStepLog({
          step: "documents_tab",
          message: "Documents tab or section toggle was not found; continuing with visible chart content.",
          urlBefore: this.page.url(),
          urlAfter: this.page.url(),
          missing: ["documents tab"],
          evidence: [
            ...resolution.attempts.map(selectorAttemptToEvidence),
            ...(await summarizeButtons(this.page)).map((entry) => `Button: ${entry}`),
            ...(await summarizeInteractiveElements(this.page)).map((entry) => `Interactive: ${entry}`),
            ...(await summarizeTables(this.page)).map((entry) => `Table: ${entry}`),
            debugArtifacts.summaryPath ? `Debug summary: ${debugArtifacts.summaryPath}` : "",
            debugArtifacts.htmlPath ? `Debug HTML: ${debugArtifacts.htmlPath}` : "",
            debugArtifacts.screenshotPath ? `Debug screenshot: ${debugArtifacts.screenshotPath}` : "",
          ].filter(Boolean),
          safeReadConfirmed: true,
        }),
      };
    }

    assertReadOnlyActionAllowed({
      safety: this.safety,
      actionClass: "READ_NAV",
      description: "open chart documents section",
    });
    await resolution.locator.click().catch(() => undefined);
    await waitForPortalPageSettled(this.page, this.options.debugConfig);

    return {
      log: createAutomationStepLog({
        step: "documents_tab",
        message: "Opened documents section in read-only mode.",
        urlBefore: this.page.url(),
        urlAfter: this.page.url(),
        selectorUsed: resolution.matchedCandidate?.description ?? null,
        evidence: resolution.attempts.map(selectorAttemptToEvidence),
        safeReadConfirmed: true,
      }),
    };
  }

  private async collectDocumentCandidates(): Promise<{
    candidates: ChartDiscoveryCandidate[];
    rejected: RejectedChartDiscoveryCandidate[];
  }> {
    const candidates: ChartDiscoveryCandidate[] = [];
    const rejected: RejectedChartDiscoveryCandidate[] = [];
    const seen = new Set<string>();
    const resolution = await resolveVisibleLocatorList({
      page: this.page,
      candidates: chartDocumentSelectors.candidateSelectors,
      step: "document_candidates",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      maxItems: 40,
    });

    for (const result of resolution.items) {
      const label = await readLocatorLabel(result.locator);
      if (!label || label.length > 240) {
        continue;
      }

      const href = await result.locator.getAttribute("href").catch(() => null);
      const target = await result.locator.getAttribute("target").catch(() => null);
      const download = await result.locator.getAttribute("download").catch(() => null);
      const contextText = normalizeWhitespace(
        await result.locator.locator("xpath=ancestor-or-self::*[self::tr or self::*[@role='row']][1]").textContent().catch(() => null),
      );
      const candidate: DocumentInventoryCandidate = {
        label,
        href,
        contextText,
        target,
        download,
      };
      const evaluation = evaluateDocumentInventoryCandidate(candidate);
      if (!evaluation.accepted) {
        rejected.push({
          rawLabel: label,
          href,
          contextText,
          selectorUsed: result.candidate.description,
          rejectionReason: evaluation.rejectionReason ?? "Candidate was rejected by document classifier.",
        });
        continue;
      }

      const item = evaluation.item;
      const key = `${item.normalizedType}:${item.sourceLabel}:${item.sourceUrl ?? ""}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push({
        item,
        locator: result.locator,
        selectorUsed: result.candidate.description,
        rawLabel: label,
        href,
        contextText,
        openBehaviorGuess: evaluation.openBehaviorGuess,
      });
    }

    if (candidates.length === 0 && this.options.debugDir) {
      const debugArtifacts = await capturePageDebugArtifacts({
        page: this.page,
        outputDir: this.options.debugDir,
        step: "chart-candidates",
        reason: "no-document-candidates",
        debugConfig: this.options.debugConfig,
        textHints: ["oasis", "plan of care", "visit note", "order", "document"],
      });
      await pauseOnFailureIfRequested(this.page, this.options.debugConfig);

      if (debugArtifacts.summaryPath && this.options.logger) {
        this.options.logger.warn(
          {
            summaryPath: debugArtifacts.summaryPath,
            url: this.page.url(),
          },
          "no document candidates found on patient chart",
        );
      }
    }

    return {
      candidates,
      rejected,
    };
  }

  private selectEvidenceCandidates(candidates: ChartDiscoveryCandidate[]): ChartDiscoveryCandidate[] {
    const selected = new Map<DocumentInventoryItem["normalizedType"], ChartDiscoveryCandidate>();

    for (const candidate of candidates.sort((left, right) => right.item.confidence - left.item.confidence)) {
      if (candidate.item.normalizedType === "OTHER" || candidate.item.confidence < 0.8) {
        continue;
      }

      if (!selected.has(candidate.item.normalizedType)) {
        selected.set(candidate.item.normalizedType, candidate);
      }
    }

    return [...selected.values()];
  }

  private async captureCandidateEvidence(
    candidate: ChartDiscoveryCandidate,
    outputDirectory: string,
  ): Promise<OpenCaptureResult> {
    if (!candidate.locator) {
      return {
        openBehavior: "NONE",
        sourcePath: null,
        openedUrl: candidate.item.sourceUrl ?? null,
        textEvidence: candidate.item.evidence,
      };
    }

    assertReadOnlyActionAllowed({
      safety: this.safety,
      actionClass: "READ_OPEN_DOC",
      description: `open document candidate ${candidate.item.sourceLabel}`,
    });

    const urlBefore = this.page.url();
    const newPagePromise = this.page.context().waitForEvent("page", {
      timeout: this.options.debugConfig?.stepTimeoutMs ?? 6_000,
    }).catch(() => null);
    const downloadPromise = this.page.waitForEvent("download", {
      timeout: this.options.debugConfig?.stepTimeoutMs ?? 6_000,
    }).catch(() => null);

    await candidate.locator.click().catch(() => undefined);
    await waitForPortalPageSettled(this.page, this.options.debugConfig);

    const openedPage = await newPagePromise;
    const download = await downloadPromise;

    if (download) {
      const outputPath = path.join(
        outputDirectory,
        `${slugify(candidate.item.normalizedType)}-${slugify(candidate.item.sourceLabel)}${path.extname(download.suggestedFilename()) || ".bin"}`,
      );
      await download.saveAs(outputPath).catch(() => undefined);
      return {
        openBehavior: "DOWNLOAD",
        sourcePath: outputPath,
        openedUrl: this.page.url(),
        textEvidence: [...candidate.item.evidence, `Downloaded artifact to ${outputPath}`],
      };
    }

    if (openedPage) {
      await waitForPortalPageSettled(openedPage, this.options.debugConfig);
      const text = normalizeWhitespace(await openedPage.textContent("body").catch(() => null));
      const outputPath = path.join(
        outputDirectory,
        `${slugify(candidate.item.normalizedType)}-${slugify(candidate.item.sourceLabel)}.txt`,
      );
      if (text) {
        await writeFile(outputPath, text, "utf8");
      }
      const openedUrl = openedPage.url();
      await openedPage.close().catch(() => undefined);
      return {
        openBehavior: "NEW_TAB",
        sourcePath: text ? outputPath : null,
        openedUrl,
        textEvidence: text ? [...candidate.item.evidence, text.slice(0, 200)] : candidate.item.evidence,
      };
    }

    const modalResolution = await resolveFirstVisibleLocator({
      page: this.page,
      candidates: chartDocumentSelectors.modalSelectors,
      step: "document_modal",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
    });

    if (modalResolution.locator) {
      const text = normalizeWhitespace(await modalResolution.locator.textContent().catch(() => null));
      const outputPath = path.join(
        outputDirectory,
        `${slugify(candidate.item.normalizedType)}-${slugify(candidate.item.sourceLabel)}.txt`,
      );
      if (text) {
        await writeFile(outputPath, text, "utf8");
      }

      const closeResolution = await resolveFirstVisibleLocator({
        page: this.page,
        candidates: chartDocumentSelectors.modalCloseSelectors,
        step: "document_modal_close",
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
      });
      if (closeResolution.locator) {
        await closeResolution.locator.click().catch(() => undefined);
      } else {
        await this.page.keyboard.press("Escape").catch(() => undefined);
      }
      await waitForPortalPageSettled(this.page, this.options.debugConfig);

      return {
        openBehavior: "MODAL",
        sourcePath: text ? outputPath : null,
        openedUrl: this.page.url(),
        textEvidence: text ? [...candidate.item.evidence, text.slice(0, 200)] : candidate.item.evidence,
      };
    }

    if (this.page.url() !== urlBefore) {
      const text = normalizeWhitespace(await this.page.textContent("body").catch(() => null));
      const outputPath = path.join(
        outputDirectory,
        `${slugify(candidate.item.normalizedType)}-${slugify(candidate.item.sourceLabel)}.txt`,
      );
      if (text) {
        await writeFile(outputPath, text, "utf8");
      }
      const openedUrl = this.page.url();
      await this.page.goBack({ waitUntil: "domcontentloaded" }).catch(() => undefined);
      await waitForPortalPageSettled(this.page, this.options.debugConfig);
      return {
        openBehavior: "SAME_PAGE",
        sourcePath: text ? outputPath : null,
        openedUrl,
        textEvidence: text ? [...candidate.item.evidence, text.slice(0, 200)] : candidate.item.evidence,
      };
    }

    return {
      openBehavior: "NONE",
      sourcePath: null,
      openedUrl: this.page.url(),
      textEvidence: candidate.item.evidence,
    };
  }

  private async buildFallbackInventoryFromPageText(): Promise<DocumentInventoryItem[]> {
    const pageText = normalizeWhitespace(await this.page.textContent("body").catch(() => null));
    return artifactTypes.flatMap((artifactType) => {
      const keywords = selectorRegistry.chartArtifacts[artifactType];
      const matchedKeyword = keywords.find((keyword) => pageText.toUpperCase().includes(keyword.toUpperCase()));
      if (!matchedKeyword) {
        return [];
      }

      return [{
        sourceLabel: matchedKeyword,
        normalizedType: artifactType === "PLAN_OF_CARE"
          ? "POC"
          : artifactType === "VISIT_NOTES"
            ? "VISIT_NOTE"
            : artifactType === "PHYSICIAN_ORDERS"
              ? "ORDER"
              : artifactType === "COMMUNICATION_NOTES"
                ? "COMMUNICATION"
                : artifactType === "MISSED_VISITS"
                  ? "MISSED_VISIT"
                  : artifactType === "THIRTY_SIXTY_DAY_SUMMARIES"
                    ? "SUMMARY_30"
                    : artifactType === "DISCHARGE_SUMMARY"
                      ? "DC_SUMMARY"
                      : artifactType === "SUPERVISORY_VISITS"
                        ? "SUPERVISORY"
                        : artifactType === "INFECTION_AND_FALL_REPORTS"
                          ? "FALL_REPORT"
                          : "OASIS",
        discipline: "UNKNOWN",
        confidence: 0.6,
        evidence: [`Matched chart page keyword '${matchedKeyword}'.`],
        sourceUrl: this.page.url(),
        sourcePath: null,
        discoveredAt: new Date().toISOString(),
        openBehavior: "NONE",
      } satisfies DocumentInventoryItem];
    });
  }
}
