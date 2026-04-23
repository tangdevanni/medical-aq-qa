import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page, Response } from "@playwright/test";
import type { AutomationStepLog } from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import type { PortalSelectorCandidate } from "../selectors/types";
import {
  resolveFirstVisibleLocator,
  resolveVisibleLocatorList,
  selectorAttemptToEvidence,
  waitForPortalPageSettled,
  type PortalDebugConfig,
} from "../utils/locatorResolution";

export type ChartDocumentCaptureTargetType =
  | "admission_order"
  | "file_upload_document";

export type ChartDocumentCaptureMethod =
  | "download"
  | "print"
  | "viewer"
  | "dom";

export interface CapturedChartDocument {
  targetType: ChartDocumentCaptureTargetType;
  sourceLabel: string;
  sourceType: string;
  captureMethod: ChartDocumentCaptureMethod;
  evidenceDirectory: string;
  sourcePdfPath?: string;
  printedPdfPath?: string;
  htmlPath?: string;
  sourceMetaPath?: string;
  extractionResultPath?: string;
  extractedTextPath?: string;
  openedUrl?: string;
  downloaded: boolean;
  warnings: string[];
  notes: string[];
}

interface MatchedSourceDocument {
  label: string;
  normalizedLabel: string;
  score: number;
}

type FileUploadsTraversalMode = "folder_view" | "file_list_view" | "mixed" | "unknown";

export interface ChartDocumentCaptureResult {
  capturedDocument: CapturedChartDocument | null;
  fileUploadsAccessible: boolean;
  fileUploadsUrl: string | null;
  visibleUploadedDocuments: string[];
  admissionOrderAccessible: boolean;
  admissionOrderTitle: string | null;
  sourcePdfPath: string | null;
  printedPdfPath: string | null;
  sourceMetaPath: string | null;
  extractedTextPath: string | null;
  extractionResultPath: string | null;
  rawTextCandidates: string[];
  fileUploadsSelectorUsed: string | null;
  admissionOrderSelectorUsed: string | null;
  matchedFileUploadsLabel: string | null;
  matchedFileUploadsHref: string | null;
  fileUploadsSidebarClickSucceeded: boolean;
  patientFileUploadsRouteDetected: boolean;
  genericProviderDocumentsRouteDetected: boolean;
  fileUploadsTraversalMode: FileUploadsTraversalMode;
  fileUploadsPageComponentDetected: boolean;
  usedChartDocumentsFallback: boolean;
  referralFolderSelected: boolean;
  referralFolderLabel: string | null;
  referralFileLabel: string | null;
  normalizedFileLabels: string[];
  matchedSourceDocuments: MatchedSourceDocument[];
  selectedSourceFile: string | null;
  selectedSourceFileNormalized: string | null;
  viewerDetected: boolean;
  viewerMarkerSamples: string[];
  printButtonDetected: boolean;
  printButtonVisible: boolean;
  printButtonSelectorUsed: string | null;
  printClickSucceeded: boolean;
  pdfResponseDetected: boolean;
  pdfResponseUrl: string | null;
  pdfContentType: string | null;
  pdfSavedPath: string | null;
  pdfByteSize: number;
  printAcquisitionMethodUsed: string;
  extractionMethodUsed: "click" | "preview" | "metadata" | null;
  postClickMarkerSamples: string[];
  evidence: string[];
}

export interface CaptureChartDocumentParams {
  page: Page;
  logger?: Logger;
  debugConfig?: PortalDebugConfig;
  chartUrl: string;
  outputDirectory: string;
  targetType: ChartDocumentCaptureTargetType;
  ensureDocumentsSectionVisible?: () => Promise<{
    log: AutomationStepLog | null;
  }>;
}

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
  {
    strategy: "css",
    selector: 'a:has(.fin-sidebar__label:has-text("Intake/Referral")), span.fin-sidebar__label:has-text("Intake/Referral")',
    description: "patient Intake/Referral sidebar label by fin-sidebar__label",
  },
  {
    strategy: "css",
    selector: 'fin-sidebar-menu-root a:has(.fin-sidebar__label:has-text("Intake/Referral"))',
    description: "patient Intake/Referral fin-sidebar-menu-root anchor",
  },
  {
    strategy: "css",
    selector: "li.notes-sub-menu #documents span:has-text('Intake/Referral')",
    description: "Intake/Referral sidebar label in notes-sub-menu #documents",
  },
  {
    strategy: "css",
    selector: "li.notes-sub-menu span:has-text('Intake/Referral')",
    description: "Intake/Referral sidebar label in notes-sub-menu",
  },
  {
    strategy: "text",
    value: /^Intake\s*\/\s*Referral$/i,
    description: "Intake/Referral exact label text",
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
    strategy: "css",
    selector: "a:has-text('Intake/Referral'), [role='treeitem']:has-text('Intake/Referral'), a:has-text('root/Intake/Referral')",
    description: "File Uploads intake/referral folder markers",
  },
  {
    strategy: "text",
    value: /Admission\s+Order|Admission\s+Info|Admission\s+Packets|Doc Uploads|root\s*\/\s*Referral|root\s*\/\s*Intake\s*\/\s*Referral|Intake\s*\/\s*Referral|Referral/i,
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
    selector: "a:has-text('Intake/Referral'), [role='button']:has-text('Intake/Referral'), [role='treeitem']:has-text('Intake/Referral')",
    description: "File Uploads intake/referral click targets outside table rows",
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
    selector: "a:has-text('root/Intake/Referral'), button:has-text('root/Intake/Referral'), [role='button']:has-text('root/Intake/Referral')",
    description: "File Uploads root/Intake/Referral folder target",
  },
  {
    strategy: "css",
    selector: "a:has-text('Referral'), button:has-text('Referral'), [role='button']:has-text('Referral')",
    description: "File Uploads Referral folder target",
  },
  {
    strategy: "css",
    selector: "a:has-text('Intake/Referral'), button:has-text('Intake/Referral'), [role='button']:has-text('Intake/Referral')",
    description: "File Uploads Intake/Referral folder target",
  },
  {
    strategy: "text",
    value: /root\s*\/\s*referral/i,
    description: "File Uploads root/Referral folder text marker",
  },
  {
    strategy: "text",
    value: /root\s*\/\s*intake\s*\/\s*referral/i,
    description: "File Uploads root/Intake/Referral folder text marker",
  },
  {
    strategy: "text",
    value: /^Referral$/i,
    description: "File Uploads Referral folder exact label",
  },
  {
    strategy: "text",
    value: /^Intake\s*\/\s*Referral$/i,
    description: "File Uploads Intake/Referral exact label",
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

const FILE_UPLOADS_ACCESS_LABEL_PATTERN = /^(?:File Uploads|Intake\s*\/\s*Referral)$/i;
const REFERRAL_FOLDER_LABEL_PATTERN = /(?:root\s*\/\s*)?(?:intake\s*\/\s*)?referral(?:\s+files?)?/i;

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

function normalizeWhitespace(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
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

export function scoreReferralOrAdmissionUploadLabel(value: string | null | undefined): number {
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

export function isFileUploadsAccessLabel(value: string | null | undefined): boolean {
  return FILE_UPLOADS_ACCESS_LABEL_PATTERN.test(normalizeWhitespace(value));
}

export function isReferralDocumentsFolderLabel(value: string | null | undefined): boolean {
  return REFERRAL_FOLDER_LABEL_PATTERN.test(normalizeWhitespace(value));
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

export async function captureChartDocument(
  params: CaptureChartDocumentParams,
): Promise<ChartDocumentCaptureResult> {
  const evidence: string[] = [];
  params.logger?.info(
    {
      chartUrl: params.chartUrl,
      currentUrl: params.page.url(),
      targetType: params.targetType,
      outputDirectory: params.outputDirectory,
    },
    "chart document capture started",
  );

  await waitForPortalPageSettled(params.page, params.debugConfig);
  let fileUploadsSelectorUsed: string | null = null;
  let matchedFileUploadsLabel: string | null = null;
  let matchedFileUploadsHref: string | null = null;
  let fileUploadsSidebarClickSucceeded = false;
  let admissionOrderSelectorUsed: string | null = null;
  let fileUploadsAccessible = false;
  let fileUploadsTraversalMode: FileUploadsTraversalMode = "unknown";
  let fileUploadsPageComponentDetected = false;
  let admissionOrderAccessible = false;
  let admissionOrderTitle: string | null = null;
  let sourcePdfPath: string | null = null;
  let printedPdfPath: string | null = null;
  let sourceMetaPath: string | null = null;
  let extractedTextPath: string | null = null;
  let extractionResultPath: string | null = null;
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
  let usedDocUploadsFallback = false;
  let usedChartDocumentsFallback = false;
  let referralFolderSelected = false;
  let referralFolderLabel: string | null = null;
  let referralFileLabel: string | null = null;
  const normalizedFileLabels = new Set<string>();
  const matchedSourceDocuments: MatchedSourceDocument[] = [];
  const visibleUploadedDocuments: string[] = [];
  const rawTextCandidates = new Set<string>();
  let patientFileUploadsRouteDetected = false;
  let genericProviderDocumentsRouteDetected = false;
  const viewerMarkerSamples: string[] = [];
  const postClickMarkerSamples: string[] = [];

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
      params.page.locator(
        "fini-sidebar span, fin-sidebar span, nav.fin-sidebar__wrapper span, .fin-sidebar__wrapper span",
      ),
      120,
    ).catch(() => []);
    const bodyTextSample = normalizeWhitespace(
      await params.page.locator("body").innerText().catch(() => ""),
    ).slice(0, 1200);
    const pageTitle = await params.page.title().catch(() => "unknown");
    const fileUploadRootCount = await params.page.locator("app-client-file-upload").count().catch(() => 0);
    evidence.push(`Current page URL during File Uploads detection: ${params.page.url()}`);
    evidence.push(`Current page title during File Uploads detection: ${pageTitle}`);
    evidence.push(`app-client-file-upload count during File Uploads detection: ${fileUploadRootCount}`);
    evidence.push(`Visible sidebar labels during File Uploads detection: ${sidebarMenuTexts.join(" | ") || "none"}`);
    evidence.push(`Body text sample during File Uploads detection: ${bodyTextSample || "none"}`);
  };

  const sidebarContainers = params.page.locator("fini-sidebar, fin-sidebar, nav.fin-sidebar__wrapper, .fin-sidebar__wrapper");
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
    const fileUploadsLabelCount = await candidate.locator("span").filter({ hasText: FILE_UPLOADS_ACCESS_LABEL_PATTERN }).count().catch(() => 0);
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
        logger: params.logger,
        debugConfig: params.debugConfig,
        settle: () => waitForPortalPageSettled(params.page, params.debugConfig),
      });

    fileUploadsLabelResolution = await resolveFileUploadsLabel("file_uploads_sidebar_label_initial");
    evidence.push(...fileUploadsLabelResolution.attempts.map(selectorAttemptToEvidence));

    if (!fileUploadsLabelResolution.locator) {
      await sidebarRoot.evaluate((element) => {
        (element as { scrollTop?: number }).scrollTop = 0;
      }).catch(() => undefined);
      await waitForPortalPageSettled(params.page, params.debugConfig);
      await sidebarRoot.evaluate((element) => {
        const target = element as { scrollTop?: number; scrollHeight?: number };
        target.scrollTop = target.scrollHeight ?? 0;
      }).catch(() => undefined);
      await waitForPortalPageSettled(params.page, params.debugConfig);
      fileUploadsLabelResolution = await resolveFileUploadsLabel("file_uploads_sidebar_label_after_scroll");
      evidence.push(...fileUploadsLabelResolution.attempts.map(selectorAttemptToEvidence));
    }

    if (!fileUploadsLabelResolution.locator) {
      const globalFallback = await resolveFirstVisibleLocator({
        page: params.page,
        candidates: FILE_UPLOADS_SIDEBAR_LABEL_SELECTORS,
        step: "file_uploads_sidebar_label_global_fallback",
        logger: params.logger,
        debugConfig: params.debugConfig,
        settle: () => waitForPortalPageSettled(params.page, params.debugConfig),
      });
      evidence.push(...globalFallback.attempts.map(selectorAttemptToEvidence));
      if (globalFallback.locator && globalFallback.matchedCandidate) {
        fileUploadsLabelResolution = globalFallback;
      }
    }

    if (!fileUploadsLabelResolution.locator || !fileUploadsLabelResolution.matchedCandidate) {
      await collectSidebarDebugSnapshot();
      const docUploadsFallback = await resolveFirstVisibleLocator({
        page: params.page,
        candidates: SOC_DOC_UPLOADS_TRIGGER_SELECTORS,
        step: "soc_doc_uploads_trigger_when_sidebar_file_uploads_missing",
        logger: params.logger,
        debugConfig: params.debugConfig,
        settle: () => waitForPortalPageSettled(params.page, params.debugConfig),
      });
      evidence.push(...docUploadsFallback.attempts.map(selectorAttemptToEvidence));
      if (docUploadsFallback.locator && docUploadsFallback.matchedCandidate) {
        await clickReadOnlyTarget({
          locator: docUploadsFallback.locator,
          page: params.page,
          debugConfig: params.debugConfig,
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
    const documentsFallback = await params.ensureDocumentsSectionVisible?.();
    usedChartDocumentsFallback = true;
    fileUploadsSelectorUsed = fileUploadsSelectorUsed ?? "wrong_context_generic_documents_fallback";
    evidence.push("Attempted chart Documents section fallback because File Uploads menu item was unavailable.");
    if (documentsFallback?.log) {
      evidence.push(`Documents fallback step: ${documentsFallback.log.message}`);
      evidence.push(...documentsFallback.log.evidence.slice(0, 12));
    }
    await collectSidebarDebugSnapshot();
  }

  let fileUploadsUrlBeforeClick = params.page.url();
  if (!usedDocUploadsFallback && fileUploadsLabelResolution?.locator && fileUploadsLabelResolution?.matchedCandidate) {
    const resolvedFileUploadsTarget = fileUploadsLabelResolution.locator;
    const resolvedTagName = await resolvedFileUploadsTarget.evaluate((element) =>
      element.tagName.toLowerCase()).catch(() => "");
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
    fileUploadsUrlBeforeClick = params.page.url();

    await clickReadOnlyTarget({
      locator: fileUploadsClickTarget,
      page: params.page,
      debugConfig: params.debugConfig,
    });
    await waitForPortalPageSettled(params.page, params.debugConfig);
    fileUploadsSidebarClickSucceeded = isPatientSpecificFileUploadsUrl(params.page.url()) ||
      await params.page.locator("app-client-file-upload").count().catch(() => 0) > 0;
    evidence.push(`Matched File Uploads sidebar label: ${matchedFileUploadsLabel ?? "none"}`);
    evidence.push(`Matched File Uploads sidebar href: ${matchedFileUploadsHref ?? "none"}`);
    evidence.push(`File Uploads sidebar click succeeded: ${fileUploadsSidebarClickSucceeded}`);
    evidence.push(`File Uploads URL after sidebar click: ${params.page.url()}`);
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
    traversalMode: FileUploadsTraversalMode;
    folderLabels: string[];
    fileLabels: string[];
    url: string;
    urlChanged: boolean;
    readyAttemptCount: number;
    ready: boolean;
  }> => {
    let markers: string[] = [];
    let markerResolution = await resolveVisibleLocatorList({
      page: params.page,
      candidates: FILE_UPLOADS_PAGE_MARKERS,
      step: `${stepPrefix}_markers_attempt_1`,
      logger: params.logger,
      debugConfig: params.debugConfig,
      maxItems: 20,
    });
    let anchorResolution = await resolveVisibleLocatorList({
      page: params.page,
      candidates: FILE_UPLOADS_DOCUMENT_ANCHOR_SELECTORS,
      step: `${stepPrefix}_anchors_attempt_1`,
      logger: params.logger,
      debugConfig: params.debugConfig,
      maxItems: 80,
    });
    let anchorLocators = anchorResolution.items.map((item) => item.locator);
    let pageComponentDetected = false;
    let traversalMode: FileUploadsTraversalMode = "unknown";
    let folderLabels: string[] = [];
    let fileLabels: string[] = [];
    let url = params.page.url();
    let urlChanged = url !== fileUploadsUrlBeforeClick;
    let readyAttemptCount = 1;
    let ready = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await waitForPortalPageSettled(params.page, params.debugConfig);
      markerResolution = await resolveVisibleLocatorList({
        page: params.page,
        candidates: FILE_UPLOADS_PAGE_MARKERS,
        step: `${stepPrefix}_markers_attempt_${attempt}`,
        logger: params.logger,
        debugConfig: params.debugConfig,
        maxItems: 20,
      });
      anchorResolution = await resolveVisibleLocatorList({
        page: params.page,
        candidates: FILE_UPLOADS_DOCUMENT_ANCHOR_SELECTORS,
        step: `${stepPrefix}_anchors_attempt_${attempt}`,
        logger: params.logger,
        debugConfig: params.debugConfig,
        maxItems: 80,
      });
      anchorLocators = anchorResolution.items.map((item) => item.locator);
      const fileUploadRoot = params.page.locator("app-client-file-upload");
      const fileUploadRootCount = await fileUploadRoot.count().catch(() => 0);
      const fileUploadRootVisible = fileUploadRootCount > 0 && await fileUploadRoot.first().isVisible().catch(() => false);
      pageComponentDetected = fileUploadRootVisible;
      folderLabels = await collectVisibleLabels(params.page.locator("app-client-file-upload .folder-label, .folder-item .folder-label, .folder-label"));
      fileLabels = await collectVisibleLabels(params.page.locator("app-client-file-upload .file-label, .file-item .file-label, .file-label"));
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
      url = params.page.url();
      urlChanged = url !== fileUploadsUrlBeforeClick;
      readyAttemptCount = attempt;
      const patientRoute = isPatientSpecificFileUploadsUrl(url);
      const genericRoute = isGenericProviderDocumentsUrl(url);
      const admissionMarkerVisible = markers.some((marker) =>
        /Admission\s+Order|Admission\s+Info|Admission\s+Packets/i.test(marker),
      );
      ready =
        pageComponentDetected ||
        folderLabels.length > 0 ||
        fileLabels.length > 0 ||
        (patientRoute && anchorLocators.length > 0) ||
        admissionMarkerVisible ||
        patientRoute;
      evidence.push(
        `File Uploads ready attempt=${attempt} url=${url} urlChanged=${urlChanged} patientFileUploadsRouteDetected=${patientRoute} genericProviderDocumentsRouteDetected=${genericRoute} pageComponentDetected=${pageComponentDetected} traversalMode=${traversalMode} folderCount=${folderLabels.length} fileCount=${fileLabels.length} markers=${markers.join(" | ") || "none"} anchorCount=${anchorLocators.length}`,
      );
      if (ready) {
        break;
      }
      if (attempt < maxAttempts) {
        await params.page.waitForTimeout(waitMs);
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
      page: params.page,
      candidates: SOC_DOC_UPLOADS_TRIGGER_SELECTORS,
      step: "soc_doc_uploads_trigger_fallback",
      logger: params.logger,
      debugConfig: params.debugConfig,
      settle: () => waitForPortalPageSettled(params.page, params.debugConfig),
    });
    evidence.push(...docUploadsFallback.attempts.map(selectorAttemptToEvidence));
    if (docUploadsFallback.locator && docUploadsFallback.matchedCandidate) {
      await clickReadOnlyTarget({
        locator: docUploadsFallback.locator,
        page: params.page,
        debugConfig: params.debugConfig,
      });
      evidence.push(`Doc Uploads fallback clicked via ${docUploadsFallback.matchedCandidate.description}`);
      fileUploadsState = await verifyFileUploadsContent("file_uploads_page_after_doc_uploads_fallback", 5, 350);
      evidence.push(...fileUploadsState.markerResolution.attempts.map(selectorAttemptToEvidence));
      evidence.push(...fileUploadsState.anchorResolution.attempts.map(selectorAttemptToEvidence));
    }
  }

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
      page: params.page,
      candidates: REFERRAL_FOLDER_SELECTORS,
      step: "file_uploads_referral_folder_target",
      logger: params.logger,
      debugConfig: params.debugConfig,
      settle: () => waitForPortalPageSettled(params.page, params.debugConfig),
    });
    evidence.push(...referralFolderResolution.attempts.map(selectorAttemptToEvidence));
    if (referralFolderResolution.locator && referralFolderResolution.matchedCandidate) {
      referralFolderLabel = normalizeWhitespace(
        await referralFolderResolution.locator.textContent().catch(() => null),
      ) || referralFolderResolution.matchedCandidate.description;
      const normalizedReferralLabel = referralFolderLabel.toUpperCase();
      const looksLikeFile = /\.(PDF|DOC|DOCX|TXT|RTF|XLS|XLSX|PNG|JPG|JPEG)\b/i.test(referralFolderLabel);
      const looksLikeRootReferralFolder = /ROOT\s*\/\s*REFERRAL/.test(normalizedReferralLabel);
      const looksLikeRootIntakeReferralFolder = /ROOT\s*\/\s*INTAKE\s*\/\s*REFERRAL/.test(normalizedReferralLabel);
      const looksLikeGenericReferralFolder = /\bREFERRAL\b/.test(normalizedReferralLabel) && !looksLikeFile;
      const looksLikeReferralFilesFolder = /REFERRAL\s+FILES/.test(normalizedReferralLabel) && !looksLikeFile;
      const referralFolderIsFolder =
        looksLikeRootReferralFolder ||
        looksLikeRootIntakeReferralFolder ||
        looksLikeGenericReferralFolder ||
        looksLikeReferralFilesFolder ||
        (isReferralDocumentsFolderLabel(referralFolderLabel) && !looksLikeFile);

      if (referralFolderIsFolder) {
        const referralFolderClickTarget = referralFolderResolution.locator
          .locator("xpath=ancestor::*[contains(@class,'folder-item')][1]")
          .first();
        const referralFolderClickCount = await referralFolderClickTarget.count().catch(() => 0);
        await clickReadOnlyTarget({
          locator: referralFolderClickCount > 0 ? referralFolderClickTarget : referralFolderResolution.locator,
          page: params.page,
          debugConfig: params.debugConfig,
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
  patientFileUploadsRouteDetected = isPatientSpecificFileUploadsUrl(fileUploadsUrl);
  genericProviderDocumentsRouteDetected = isGenericProviderDocumentsUrl(fileUploadsUrl);
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
    const fileRowContainer = anchor.locator("xpath=ancestor::*[contains(@class,'file-item')][1]").first();
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

  let capturedDocument: CapturedChartDocument | null = null;
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
      resolvePatientDocumentsDirectory(params.outputDirectory),
      slugify(selectedSourceFileNormalized || selectedSourceFile || "source-document") || "source-document",
    );
    await mkdir(documentDirectory, { recursive: true });
    sourceMetaPath = path.join(documentDirectory, "source-meta.json");
    sourcePdfPath = path.join(documentDirectory, "source.pdf");
    extractedTextPath = path.join(documentDirectory, "extracted-text.txt");
    extractionResultPath = path.join(documentDirectory, "extraction-result.json");
    printedPdfPath = path.join(documentDirectory, "printed-source.pdf");

    params.logger?.info(
      {
        targetType: params.targetType,
        selectedSourceFile,
        selectedSourceFileNormalized,
        documentDirectory,
        selectorUsed: admissionOrderSelectorUsed,
      },
      "chart document capture target selected",
    );

    const urlBeforeAdmissionClick = params.page.url();
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
    params.page.on("response", onResponse);
    await clickReadOnlyTarget({
      locator: chosen.anchor,
      page: params.page,
      debugConfig: params.debugConfig,
    });
    extractionMethodUsed = "click";
    await waitForPortalPageSettled(params.page, params.debugConfig);

    const viewerMarkers = await resolveVisibleLocatorList({
      page: params.page,
      candidates: FILE_UPLOADS_VIEWER_MARKERS,
      step: "file_uploads_viewer_markers_after_source_click",
      logger: params.logger,
      debugConfig: params.debugConfig,
      maxItems: 12,
    });
    evidence.push(...viewerMarkers.attempts.map(selectorAttemptToEvidence));
    viewerMarkerSamples.push(...(
      await Promise.all(
        viewerMarkers.items.slice(0, 6).map(async (item) =>
          readLocatorLabel(item.locator) ?? item.candidate.description),
      )
    ).filter((value): value is string => Boolean(value)));
    viewerDetected = viewerMarkers.items.length > 0;

    await params.page.waitForTimeout(1200).catch(() => undefined);
    await Promise.all(capturePdfResponses).catch(() => undefined);
    params.page.off("response", onResponse);

    const printButton = params.page
      .locator("pdf-print #printButton, #printButton, pdf-shy-button[primarytoolbarid='printButton'] button")
      .first();
    const printButtonCount = await printButton.count().catch(() => 0);
    printButtonDetected = printButtonCount > 0;
    printButtonVisible = printButtonDetected && await printButton.isVisible().catch(() => false);
    printButtonSelectorUsed = printButtonDetected
      ? "pdf-print #printButton, #printButton, pdf-shy-button[primarytoolbarid='printButton'] button"
      : null;

    if (!pdfResponseDetected && printButtonVisible) {
      await params.page.evaluate(() => {
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
        page: params.page,
        debugConfig: params.debugConfig,
      }).then(() => {
        printClickSucceeded = true;
      }).catch(() => {
        printClickSucceeded = false;
      });

      if (printClickSucceeded) {
        printClickSucceeded = await params.page.evaluate(() => {
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
        await params.page.pdf({
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
      page: params.page,
      candidates: ADMISSION_ORDER_OPEN_MARKERS,
      step: "admission_order_open_markers",
      logger: params.logger,
      debugConfig: params.debugConfig,
      maxItems: 10,
    });
    evidence.push(...postClickMarkers.attempts.map(selectorAttemptToEvidence));
    postClickMarkerSamples.push(...(
      await Promise.all(
        postClickMarkers.items.slice(0, 6).map(async (item) => readLocatorLabel(item.locator) ?? item.candidate.description),
      )
    ).filter((value): value is string => Boolean(value)));
    admissionOrderAccessible =
      viewerDetected ||
      printButtonDetected ||
      postClickMarkers.items.length > 0 ||
      params.page.url() !== urlBeforeAdmissionClick;

    const pushAdmissionText = (value: string | null | undefined) => {
      const normalized = normalizeWhitespace(value ?? "");
      if (normalized.length >= 30) {
        rawTextCandidates.add(normalized);
      }
    };

    pushAdmissionText(chosen.rowText);
    pushAdmissionText(chosen.anchorText);
    for (const item of postClickMarkers.items.slice(0, 8)) {
      pushAdmissionText(await item.locator.innerText().catch(() => null));
    }
    const admissionSpecificWrappers = params.page.locator(
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

    const captureMethod: ChartDocumentCaptureMethod =
      pdfResponseDetected
        ? "download"
        : printedPdfPath
        ? "print"
        : viewerDetected
        ? "viewer"
        : "dom";
    const warnings: string[] = [];
    const notes: string[] = [
      `selectedSourceFile:${selectedSourceFile ?? "none"}`,
      `selectedSourceFileNormalized:${selectedSourceFileNormalized ?? "none"}`,
      `printAcquisitionMethodUsed:${printAcquisitionMethodUsed}`,
      `rawTextCandidateCount:${rawTextCandidates.size}`,
    ];
    if (usedChartDocumentsFallback) {
      warnings.push("chart_documents_fallback_used");
    }
    if (!pdfResponseDetected && !printedPdfPath) {
      warnings.push("no_pdf_file_captured");
    }
    if (viewerDetected && !printClickSucceeded && !pdfResponseDetected) {
      warnings.push("viewer_detected_without_completed_print_capture");
    }

    capturedDocument = {
      targetType: params.targetType,
      sourceLabel: selectedSourceFile ?? chosen.anchorText,
      sourceType: params.targetType === "admission_order" ? "ORDER" : "DOCUMENT",
      captureMethod,
      evidenceDirectory: documentDirectory,
      sourcePdfPath: pdfSavedPath ?? undefined,
      printedPdfPath: printedPdfPath ?? undefined,
      sourceMetaPath: sourceMetaPath ?? undefined,
      extractionResultPath: extractionResultPath ?? undefined,
      extractedTextPath: extractedTextPath ?? undefined,
      openedUrl: params.page.url(),
      downloaded: Boolean(pdfSavedPath || printedPdfPath),
      warnings,
      notes,
    };

    await writeFile(
      sourceMetaPath,
      JSON.stringify(
        {
          targetType: params.targetType,
          selectedSourceFile,
          selectedSourceFileNormalized,
          admissionOrderTitle,
          admissionOrderSelectorUsed,
          sourceUrlBeforeClick: urlBeforeAdmissionClick,
          sourceUrlAfterClick: params.page.url(),
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
          captureMethod,
          downloaded: capturedDocument.downloaded,
          openedUrl: capturedDocument.openedUrl,
          rawTextCandidateCount: rawTextCandidates.size,
          warnings,
          notes,
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
    evidence.push(`Capture method used: ${captureMethod}`);
    evidence.push(`Downloaded artifact available: ${capturedDocument.downloaded}`);
    evidence.push(`Admission Order title: ${admissionOrderTitle}`);
    evidence.push(`Admission Order URL after click: ${params.page.url()}`);
    evidence.push(`Admission Order markers: ${postClickMarkerSamples.join(" | ") || "none"}`);

    params.logger?.info(
      {
        targetType: params.targetType,
        selectedSourceFile,
        selectedSourceFileNormalized,
        captureMethod,
        openedUrl: params.page.url(),
        sourcePdfPath: pdfSavedPath,
        printedPdfPath,
        sourceMetaPath,
        extractedTextPath,
        extractionResultPath,
        pdfResponseDetected,
        pdfResponseUrl,
        pdfContentType,
        pdfByteSize,
        printButtonDetected,
        printClickSucceeded,
        viewerDetected,
        warnings,
      },
      "chart document raw artifacts written",
    );
  } else {
    evidence.push("No admission/referral document candidate was selected from File Uploads.");
  }

  params.logger?.info(
    {
      targetType: params.targetType,
      fileUploadsAccessible,
      fileUploadsUrl,
      visibleUploadedDocuments: visibleUploadedDocuments.slice(0, 20),
      matchedSourceDocuments: matchedSourceDocuments.slice(0, 20),
      selectedSourceFile,
      selectedSourceFileNormalized,
      capturedDocument,
    },
    capturedDocument ? "chart document capture completed" : "chart document capture completed without usable document",
  );

  return {
    capturedDocument,
    fileUploadsAccessible,
    fileUploadsUrl,
    visibleUploadedDocuments,
    admissionOrderAccessible,
    admissionOrderTitle,
    sourcePdfPath,
    printedPdfPath,
    sourceMetaPath,
    extractedTextPath,
    extractionResultPath,
    rawTextCandidates: [...rawTextCandidates],
    fileUploadsSelectorUsed,
    admissionOrderSelectorUsed,
    matchedFileUploadsLabel,
    matchedFileUploadsHref,
    fileUploadsSidebarClickSucceeded,
    patientFileUploadsRouteDetected,
    genericProviderDocumentsRouteDetected,
    fileUploadsTraversalMode,
    fileUploadsPageComponentDetected,
    usedChartDocumentsFallback,
    referralFolderSelected,
    referralFolderLabel,
    referralFileLabel,
    normalizedFileLabels: Array.from(normalizedFileLabels),
    matchedSourceDocuments,
    selectedSourceFile,
    selectedSourceFileNormalized,
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
    extractionMethodUsed,
    postClickMarkerSamples,
    evidence,
  };
}
