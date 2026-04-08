import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ArtifactRecord,
  AutomationStepLog,
  DocumentInventoryItem,
  PatientEpisodeWorkItem,
  PatientMatchResult,
  PatientRun,
  PortalSafetyConfig,
} from "@medical-ai-qa/shared-types";
import { loadEnv } from "../config/env";
import { createAutomationStepLog } from "../portal/utils/automationLog";
import {
  ReadOnlyViolationError,
  assertReadOnlyActionAllowed,
} from "../portal/safety/readOnlySafety";
import { runFinaleBatch, type RunFinaleBatchResult } from "../services/batchRunService";
import type { OasisExecutionActionPerformed } from "../services/oasisDiagnosisExecutionService";
import type { OasisInputActionPlan } from "../services/oasisInputActionPlanService";
import { intakeWorkbook } from "../services/workbookIntakeService";
import type { BatchPortalAutomationClient } from "../workers/playwrightBatchQaWorker";
import type { OasisDiagnosisPageSnapshot } from "../portal/utils/oasisDiagnosisInspector";
import type { OasisLockStateSnapshot } from "../portal/utils/oasisLockStateDetector";

const DEMO_READ_ONLY_SAFETY: PortalSafetyConfig = {
  safetyMode: "READ_ONLY",
  allowAuthSubmit: true,
  allowSearchAndFilterInput: true,
  allowArtifactDownloads: true,
  enforceDangerousControlDetection: true,
};

const DEFAULT_LIMIT = 1;

export interface OasisDemoHarnessResult {
  outputDir: string;
  workbookPath: string;
  liveMode: boolean;
  availablePatientCount: number;
  eligiblePatientCount: number;
  selectedPatientCount: number;
  selectionReason: string;
  parserExceptionCount: number;
  result: RunFinaleBatchResult;
  patientRun: PatientRun;
  demoSummary: OasisDemoSummary;
  demoSummaryJsonPath: string;
  demoSummaryMarkdownPath: string;
}

export interface OasisDemoSummary {
  fixtureLabel: string;
  liveMode: boolean;
  workbookPath: string;
  availablePatientCount: number;
  eligiblePatientCount: number;
  selectedPatientCount: number;
  selectionReason: string;
  parserExceptionCount: number;
  patientName: string;
  workItemId: string;
  patientMatchStatus: PatientMatchResult["status"];
  urgency: PatientRun["oasisQaSummary"]["urgency"];
  daysInPeriod: number | null;
  daysLeft: number | null;
  overallStatus: PatientRun["oasisQaSummary"]["overallStatus"];
  blockerCount: number;
  blockers: string[];
  documentInventory: Array<{
    sourceLabel: string;
    normalizedType: DocumentInventoryItem["normalizedType"];
    discipline: DocumentInventoryItem["discipline"];
    confidence: number;
    evidence: string[];
  }>;
  qaSections: Array<{
    key: string;
    status: string;
    blockerCount: number;
    evidenceSamples: string[];
  }>;
  stepLogCount: number;
  stepNames: string[];
  evidenceFiles: string[];
  logPath: string | null;
  resultBundlePath: string | null;
  portal: {
    loginStatus: "SUCCESS" | "FAILED" | "NOT_ATTEMPTED";
    loginMessage: string | null;
    patientSearchStatus: PatientMatchResult["status"];
    patientSearchNote: string | null;
    chartOpened: boolean;
    chartOpenMessage: string | null;
  };
  futureWritePoints: string[];
  safety: {
    safetyMode: PortalSafetyConfig["safetyMode"];
    dangerousControlsDetected: string[];
    dangerousWriteAttemptBlocked: boolean;
    writeExecutorUsed: boolean;
    workflowExecutorUsed: boolean;
  };
}

function resolveDefaultWorkbookPath(): string {
  return path.resolve(process.cwd(), "finale-export.xlsx");
}

function normalizePatientSelector(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function resolveWorkbookPath(workbookPath?: string): string {
  const resolvedPath = path.resolve(workbookPath ?? resolveDefaultWorkbookPath());
  if (!existsSync(resolvedPath)) {
    throw new Error(
      `Workbook not found at ${resolvedPath}. Place the real workbook at services/finale-workbook-intake/finale-export.xlsx or pass --workbook <path>.`,
    );
  }

  return resolvedPath;
}

function ensureLivePortalConfiguration(): void {
  const env = loadEnv();
  const hasAuthState = Boolean(env.PORTAL_AUTH_STATE_PATH && existsSync(path.resolve(env.PORTAL_AUTH_STATE_PATH)));

  if (!env.PORTAL_BASE_URL) {
    throw new Error("Live demo mode requires PORTAL_BASE_URL to be configured.");
  }

  if (!hasAuthState && (!env.PORTAL_USERNAME || !env.PORTAL_PASSWORD)) {
    throw new Error(
      "Live demo mode requires either PORTAL_AUTH_STATE_PATH or both PORTAL_USERNAME and PORTAL_PASSWORD.",
    );
  }
}

function evaluateDemoEligibility(workItem: PatientEpisodeWorkItem): {
  eligible: boolean;
  reasons: string[];
  score: number;
} {
  const reasons: string[] = [];
  let score = 0;

  if (workItem.patientIdentity.displayName && workItem.patientIdentity.normalizedName) {
    reasons.push("patient identity present");
    score += 3;
  }

  if (
    workItem.patientIdentity.medicareNumber ||
    workItem.episodeContext.socDate ||
    workItem.episodeContext.episodeDate ||
    workItem.episodeContext.billingPeriod ||
    workItem.episodeContext.episodePeriod
  ) {
    reasons.push("episode context present");
    score += 2;
  }

  const workflowSignals = [
    workItem.codingReviewStatus,
    workItem.oasisQaStatus,
    workItem.pocQaStatus,
    workItem.visitNotesQaStatus,
    workItem.billingPrepStatus,
  ].filter((status) => status !== "NOT_STARTED");
  if (workflowSignals.length > 0) {
    reasons.push(`workflow signals: ${workflowSignals.join(", ")}`);
    score += workflowSignals.length;
  }

  if (workItem.sourceSheets.length > 0) {
    reasons.push(`source sheets: ${workItem.sourceSheets.join(", ")}`);
    score += Math.min(workItem.sourceSheets.length, 3);
  }

  return {
    eligible: score >= 6,
    reasons,
    score,
  };
}

function selectDemoWorkItems(input: {
  workItems: PatientEpisodeWorkItem[];
  patient?: string;
  limit?: number;
  all?: boolean;
}): {
  eligibleWorkItems: PatientEpisodeWorkItem[];
  selectedWorkItems: PatientEpisodeWorkItem[];
  selectionReason: string;
} {
  const normalizedPatientSelector = input.patient
    ? normalizePatientSelector(input.patient)
    : null;
  const eligible = input.workItems
    .map((workItem) => ({
      workItem,
      eligibility: evaluateDemoEligibility(workItem),
    }))
    .filter((entry) => entry.eligibility.eligible)
    .sort((left, right) =>
      right.eligibility.score - left.eligibility.score ||
      left.workItem.patientIdentity.displayName.localeCompare(right.workItem.patientIdentity.displayName),
    );
  const eligibleWorkItems = eligible.map((entry) => entry.workItem);
  const filtered = normalizedPatientSelector
    ? eligible.filter((entry) => {
        const haystacks = [
          entry.workItem.patientIdentity.displayName,
          entry.workItem.patientIdentity.normalizedName,
        ]
          .filter((value): value is string => Boolean(value))
          .map(normalizePatientSelector);

        return haystacks.some((value) => value.includes(normalizedPatientSelector));
      })
    : eligible;

  if (filtered.length === 0) {
    const reason = input.patient
      ? `No normalized patient work items matched selector '${input.patient}'.`
      : "Workbook intake did not produce any demo-eligible patient work items.";
    throw new Error(reason);
  }

  const filteredWorkItems = filtered.map((entry) => entry.workItem);
  if (input.all) {
    return {
      eligibleWorkItems,
      selectedWorkItems: filteredWorkItems,
      selectionReason: input.patient
        ? `Selected all ${filteredWorkItems.length} demo-eligible work items matching patient selector '${input.patient}'.`
        : `Selected all ${filteredWorkItems.length} demo-eligible work items from the real workbook.`,
    };
  }

  const limit = input.limit ?? DEFAULT_LIMIT;
  const selectedEntries = filtered.slice(0, limit);
  const selectedWorkItems = selectedEntries.map((entry) => entry.workItem);
  const primaryReasons = selectedEntries[0]?.eligibility.reasons.join("; ") ?? "no eligibility reasons recorded";

  return {
    eligibleWorkItems,
    selectedWorkItems,
    selectionReason: input.patient
      ? `Selected ${selectedWorkItems.length} demo-eligible work item(s) matching '${input.patient}'. Primary selection reason: ${primaryReasons}.`
      : `Selected the highest-ranked demo-eligible patient(s) using identity completeness, workflow signals, and source-sheet coverage. Primary selection reason: ${primaryReasons}.`,
  };
}

class DemoReadOnlyPortalClient implements BatchPortalAutomationClient {
  readonly safetyMode = DEMO_READ_ONLY_SAFETY.safetyMode;
  readonly dangerousControlsDetected = ["Save", "Validate", "Mark Ready For Billing"];
  writeExecutorUsed = false;
  workflowExecutorUsed = false;
  dangerousWriteAttemptBlocked = false;
  private loginRecorded = false;

  async initialize(): Promise<void> {
    assert.equal(this.safetyMode, "READ_ONLY");
  }

  async resolvePatient(workItem: PatientEpisodeWorkItem): Promise<{
    matchResult: PatientMatchResult;
    stepLogs: AutomationStepLog[];
  }> {
    const stepLogs: AutomationStepLog[] = [];

    if (!this.loginRecorded) {
      stepLogs.push(
        createAutomationStepLog({
          step: "login",
          message: "Authenticated to the portal using the read-only reviewer path.",
          patientName: workItem.patientIdentity.displayName,
          urlBefore: "https://demo.portal/login",
          urlAfter: "https://demo.portal/dashboard",
          selectorUsed: 'button[type="submit"]',
          found: ["dashboard_marker"],
          evidence: ["Login completed through AUTH_ONLY flow."],
          safeReadConfirmed: true,
        }),
      );
      this.loginRecorded = true;
    }

    stepLogs.push(
      createAutomationStepLog({
        step: "patient_search",
        message: `Resolved patient search for ${workItem.patientIdentity.displayName}.`,
        patientName: workItem.patientIdentity.displayName,
        urlBefore: "https://demo.portal/dashboard",
        urlAfter: "https://demo.portal/search?query=Jane%20Doe",
        selectorUsed: 'input[placeholder="Search patients"]',
        found: [workItem.patientIdentity.displayName],
        evidence: [`Search query: ${workItem.patientIdentity.displayName}`],
        safeReadConfirmed: true,
      }),
    );
    stepLogs.push(
      createAutomationStepLog({
        step: "chart_open",
        message: "Opened the patient chart in read-only mode.",
        patientName: workItem.patientIdentity.displayName,
        urlBefore: "https://demo.portal/search?query=Jane%20Doe",
        urlAfter: "https://demo.portal/patients/PT-1001/chart",
        selectorUsed: '[data-testid="patient-chart-link"]',
        found: ["chart_header", "documents_tab"],
        evidence: ["Chart route resolved to patient PT-1001."],
        safeReadConfirmed: true,
      }),
    );

    return {
      matchResult: {
        status: "EXACT",
        searchQuery: workItem.patientIdentity.displayName,
        portalPatientId: "PT-1001",
        portalDisplayName: workItem.patientIdentity.displayName,
        candidateNames: [workItem.patientIdentity.displayName],
        note: null,
      },
      stepLogs,
    };
  }

  async discoverArtifacts(
    workItem: PatientEpisodeWorkItem,
    evidenceDir: string,
  ): Promise<{
    artifacts: ArtifactRecord[];
    documentInventory: DocumentInventoryItem[];
    stepLogs: AutomationStepLog[];
  }> {
    await mkdir(evidenceDir, { recursive: true });
    this.confirmDangerousWriteBlocked();

    const files = {
      oasis: path.join(evidenceDir, "oasis.txt"),
      poc: path.join(evidenceDir, "plan-of-care.txt"),
      visitNote: path.join(evidenceDir, "visit-note-sn.txt"),
      order: path.join(evidenceDir, "physician-order.txt"),
      communication: path.join(evidenceDir, "communication-note.txt"),
      summary30: path.join(evidenceDir, "summary-30.txt"),
      supervisory: path.join(evidenceDir, "supervisory-note.txt"),
      missedVisit: path.join(evidenceDir, "missed-visit.txt"),
      fallReport: path.join(evidenceDir, "fall-report.txt"),
    };

    await writeFile(
      files.oasis,
      "OASIS assessment confirms medical necessity for continued home health services. Patient is homebound due to weakness and requires assistance to leave the home. Comprehensive health assessment completed during the visit. Skilled interventions performed by skilled nursing for wound care and medication teaching.",
      "utf8",
    );
    await writeFile(
      files.poc,
      "Plan of care diagnosis list includes ICD-10 codes and diagnoses. Goals and interventions reviewed. Visit frequency is SN 2W4. Condition exacerbation monitoring for CHF and COPD is included.",
      "utf8",
    );
    await writeFile(
      files.visitNote,
      "Skilled nursing visit performed. Skilled need requires skilled nursing for wound care. Interventions performed: wound care and medication teaching provided. Patient response tolerated well. Progress toward goals noted. Changes in condition addressed with improvement documented. Vitals: blood pressure and heart rate documented. Medications reviewed with no changes. Documentation supports billed services and remains consistent with OASIS diagnoses and plan of care. Physical therapy follow-up is coordinated for mobility support.",
      "utf8",
    );
    await writeFile(
      files.order,
      "Physician order reviewed for home health continuation and skilled nursing frequency.",
      "utf8",
    );
    await writeFile(
      files.communication,
      "Communication note documenting coordination with physician office regarding medication clarification.",
      "utf8",
    );
    await writeFile(
      files.summary30,
      "30-day summary documenting skilled nursing progress and current condition status.",
      "utf8",
    );
    await writeFile(
      files.supervisory,
      "LVN supervisory visit completed and documented.",
      "utf8",
    );
    await writeFile(
      files.missedVisit,
      "Missed visit note documenting reschedule request and patient contact.",
      "utf8",
    );
    await writeFile(
      files.fallReport,
      "Fall report completed with incident details and follow-up actions.",
      "utf8",
    );

    const discoveredAt = new Date().toISOString();
    const artifacts: ArtifactRecord[] = [
      {
        artifactType: "OASIS",
        status: "DOWNLOADED",
        portalLabel: "OASIS Assessment",
        locatorUsed: '[data-testid="oasis-doc"]',
        discoveredAt,
        downloadPath: files.oasis,
        extractedFields: {},
        notes: [],
      },
      {
        artifactType: "PLAN_OF_CARE",
        status: "DOWNLOADED",
        portalLabel: "Plan of Care",
        locatorUsed: '[data-testid="poc-doc"]',
        discoveredAt,
        downloadPath: files.poc,
        extractedFields: {},
        notes: [],
      },
      {
        artifactType: "VISIT_NOTES",
        status: "DOWNLOADED",
        portalLabel: "SN Visit Note",
        locatorUsed: '[data-testid="visit-note-doc"]',
        discoveredAt,
        downloadPath: files.visitNote,
        extractedFields: {},
        notes: [],
      },
      {
        artifactType: "PHYSICIAN_ORDERS",
        status: "DOWNLOADED",
        portalLabel: "Physician Order",
        locatorUsed: '[data-testid="order-doc"]',
        discoveredAt,
        downloadPath: files.order,
        extractedFields: {},
        notes: [],
      },
      {
        artifactType: "COMMUNICATION_NOTES",
        status: "DOWNLOADED",
        portalLabel: "Communication Note",
        locatorUsed: '[data-testid="communication-doc"]',
        discoveredAt,
        downloadPath: files.communication,
        extractedFields: {},
        notes: [],
      },
      {
        artifactType: "THIRTY_SIXTY_DAY_SUMMARIES",
        status: "DOWNLOADED",
        portalLabel: "30-Day Summary",
        locatorUsed: '[data-testid="summary-doc"]',
        discoveredAt,
        downloadPath: files.summary30,
        extractedFields: {},
        notes: [],
      },
      {
        artifactType: "SUPERVISORY_VISITS",
        status: "DOWNLOADED",
        portalLabel: "Supervisory Visit",
        locatorUsed: '[data-testid="supervisory-doc"]',
        discoveredAt,
        downloadPath: files.supervisory,
        extractedFields: {},
        notes: [],
      },
      {
        artifactType: "MISSED_VISITS",
        status: "DOWNLOADED",
        portalLabel: "Missed Visit",
        locatorUsed: '[data-testid="missed-visit-doc"]',
        discoveredAt,
        downloadPath: files.missedVisit,
        extractedFields: {},
        notes: [],
      },
      {
        artifactType: "INFECTION_AND_FALL_REPORTS",
        status: "DOWNLOADED",
        portalLabel: "Fall Report",
        locatorUsed: '[data-testid="fall-report-doc"]',
        discoveredAt,
        downloadPath: files.fallReport,
        extractedFields: {},
        notes: [],
      },
    ];

    const documentInventory: DocumentInventoryItem[] = [
      {
        sourceLabel: "OASIS Assessment",
        normalizedType: "OASIS",
        discipline: "SN",
        confidence: 0.99,
        evidence: ["Matched OASIS Assessment label and extracted OASIS text."],
        sourceUrl: "https://demo.portal/documents/oasis/1",
        sourcePath: files.oasis,
        discoveredAt,
        openBehavior: "DOWNLOAD",
      },
      {
        sourceLabel: "Plan of Care",
        normalizedType: "POC",
        discipline: "SN",
        confidence: 0.97,
        evidence: ["Matched plan-of-care label and POC key phrases."],
        sourceUrl: "https://demo.portal/documents/poc/1",
        sourcePath: files.poc,
        discoveredAt,
        openBehavior: "DOWNLOAD",
      },
      {
        sourceLabel: "SN Visit Note",
        normalizedType: "VISIT_NOTE",
        discipline: "SN",
        confidence: 0.98,
        evidence: ["Matched skilled nursing visit note with SN discipline cues."],
        sourceUrl: "https://demo.portal/documents/visit-note/1",
        sourcePath: files.visitNote,
        discoveredAt,
        openBehavior: "DOWNLOAD",
      },
      {
        sourceLabel: "Physician Order",
        normalizedType: "ORDER",
        discipline: "UNKNOWN",
        confidence: 0.95,
        evidence: ["Matched physician order label."],
        sourceUrl: "https://demo.portal/documents/order/1",
        sourcePath: files.order,
        discoveredAt,
        openBehavior: "DOWNLOAD",
      },
      {
        sourceLabel: "Communication Note",
        normalizedType: "COMMUNICATION",
        discipline: "UNKNOWN",
        confidence: 0.93,
        evidence: ["Matched communication note label."],
        sourceUrl: "https://demo.portal/documents/communication/1",
        sourcePath: files.communication,
        discoveredAt,
        openBehavior: "DOWNLOAD",
      },
      {
        sourceLabel: "30-Day Summary",
        normalizedType: "SUMMARY_30",
        discipline: "SN",
        confidence: 0.92,
        evidence: ["Matched 30-day summary label."],
        sourceUrl: "https://demo.portal/documents/summary/30",
        sourcePath: files.summary30,
        discoveredAt,
        openBehavior: "DOWNLOAD",
      },
      {
        sourceLabel: "Supervisory Visit",
        normalizedType: "SUPERVISORY",
        discipline: "HHA",
        confidence: 0.9,
        evidence: ["Matched supervisory visit label."],
        sourceUrl: "https://demo.portal/documents/supervisory/1",
        sourcePath: files.supervisory,
        discoveredAt,
        openBehavior: "DOWNLOAD",
      },
      {
        sourceLabel: "Missed Visit",
        normalizedType: "MISSED_VISIT",
        discipline: "SN",
        confidence: 0.9,
        evidence: ["Matched missed-visit note label."],
        sourceUrl: "https://demo.portal/documents/missed-visit/1",
        sourcePath: files.missedVisit,
        discoveredAt,
        openBehavior: "DOWNLOAD",
      },
      {
        sourceLabel: "Fall Report",
        normalizedType: "FALL_REPORT",
        discipline: "UNKNOWN",
        confidence: 0.88,
        evidence: ["Matched fall-report label."],
        sourceUrl: "https://demo.portal/documents/fall-report/1",
        sourcePath: files.fallReport,
        discoveredAt,
        openBehavior: "DOWNLOAD",
      },
    ];

    const stepLogs: AutomationStepLog[] = [
      createAutomationStepLog({
        step: "document_discovery",
        message: `Discovered ${documentInventory.length} document candidates in the chart.`,
        patientName: workItem.patientIdentity.displayName,
        urlBefore: "https://demo.portal/patients/PT-1001/chart",
        urlAfter: "https://demo.portal/patients/PT-1001/chart?tab=documents",
        selectorUsed: '[data-testid="documents-tab"]',
        found: documentInventory.map((item) => `${item.normalizedType}:${item.sourceLabel}`),
        evidence: documentInventory.flatMap((item) => item.evidence.slice(0, 1)),
        safeReadConfirmed: true,
      }),
      createAutomationStepLog({
        step: "dangerous_controls_detected",
        message: "Detected write-capable controls and confirmed they were blocked by READ_ONLY enforcement.",
        patientName: workItem.patientIdentity.displayName,
        urlBefore: "https://demo.portal/patients/PT-1001/chart?tab=documents",
        urlAfter: "https://demo.portal/patients/PT-1001/chart?tab=documents",
        found: this.dangerousControlsDetected,
        evidence: ["WRITE_MUTATION action class was blocked before execution."],
        safeReadConfirmed: true,
      }),
    ];

    return {
      artifacts,
      documentInventory,
      stepLogs,
    };
  }

  async executeOasisDiagnosisActionPlan(
    workItem: PatientEpisodeWorkItem,
    _evidenceDir: string,
    options: {
      actionPlan: OasisInputActionPlan;
      lockState: OasisLockStateSnapshot | null;
      writeEnabled: boolean;
      initialSnapshot?: OasisDiagnosisPageSnapshot | null;
    },
  ): Promise<{
    diagnosisPageSnapshot: OasisDiagnosisPageSnapshot | null;
    actionsPerformed: OasisExecutionActionPerformed[];
    insertClicksPerformed: number;
    fieldsUpdatedCount: number;
    executed: boolean;
    warnings: string[];
    stepLogs: AutomationStepLog[];
  }> {
    this.confirmDangerousWriteBlocked();
    return {
      diagnosisPageSnapshot: options.initialSnapshot ?? null,
      actionsPerformed: [],
      insertClicksPerformed: 0,
      fieldsUpdatedCount: 0,
      executed: false,
      warnings: ["executionSkipped", "executionSkipReason:read_only_demo_harness"],
      stepLogs: [
        createAutomationStepLog({
          step: "oasis_diagnosis_execution",
          message: `Skipped OASIS diagnosis execution for ${workItem.patientIdentity.displayName} in the demo read-only harness.`,
          patientName: workItem.patientIdentity.displayName,
          found: [
            "executionSkipped:true",
            `mode:${options.actionPlan.mode}`,
            `writeEnabled:${options.writeEnabled}`,
          ],
          evidence: [
            `lockState:${options.lockState?.oasisLockState ?? options.actionPlan.lockState}`,
          ],
          safeReadConfirmed: true,
        }),
      ],
    };
  }

  async captureFailureArtifacts() {
    return {
      tracePath: null,
      screenshotPaths: [],
      downloadPaths: [],
    };
  }

  async dispose(): Promise<void> {}

  private confirmDangerousWriteBlocked(): void {
    try {
      assertReadOnlyActionAllowed({
        safety: DEMO_READ_ONLY_SAFETY,
        actionClass: "WRITE_MUTATION",
        description: "demo dangerous Save button",
      });
      throw new Error("READ_ONLY enforcement did not block a dangerous write action.");
    } catch (error) {
      if (error instanceof ReadOnlyViolationError) {
        this.dangerousWriteAttemptBlocked = true;
        return;
      }

      throw error;
    }
  }
}

function confirmDangerousWriteBlocked(): boolean {
  try {
    assertReadOnlyActionAllowed({
      safety: DEMO_READ_ONLY_SAFETY,
      actionClass: "WRITE_MUTATION",
      description: "demo future write point",
    });
    return false;
  } catch (error) {
    if (error instanceof ReadOnlyViolationError) {
      return true;
    }

    throw error;
  }
}

function deriveDangerousControlsDetected(patientRun: PatientRun): string[] {
  const detections = new Set<string>();

  for (const log of patientRun.automationStepLogs) {
    if (log.step === "dangerous_controls_detected") {
      log.found.forEach((value) => detections.add(value));
    }

    for (const evidence of log.evidence) {
      const match = evidence.match(/^Dangerous control detected:\s*(.+)$/i);
      if (match?.[1]) {
        detections.add(match[1].trim());
      }
    }
  }

  return [...detections];
}

function derivePortalSummary(patientRun: PatientRun): OasisDemoSummary["portal"] {
  const loginStep = patientRun.automationStepLogs.find((log) => log.step === "login") ?? null;
  const chartOpenStep = [...patientRun.automationStepLogs]
    .reverse()
    .find((log) => log.step === "chart_open") ?? null;

  return {
    loginStatus:
      loginStep === null
        ? "NOT_ATTEMPTED"
        : /fail/i.test(loginStep.message)
          ? "FAILED"
          : "SUCCESS",
    loginMessage: loginStep?.message ?? null,
    patientSearchStatus: patientRun.matchResult.status,
    patientSearchNote: patientRun.matchResult.note ?? null,
    chartOpened:
      patientRun.matchResult.status === "EXACT" &&
      Boolean(chartOpenStep) &&
      !(chartOpenStep?.missing.includes("patient chart") ?? false),
    chartOpenMessage: chartOpenStep?.message ?? null,
  };
}

function collectEvidenceFiles(patientRun: PatientRun): string[] {
  const filePaths = [
    patientRun.resultBundlePath,
    patientRun.logPath,
    ...patientRun.artifacts.map((artifact) => artifact.downloadPath),
  ].filter((value): value is string => Boolean(value));

  return [...new Set(filePaths)];
}

function buildDemoSummary(input: {
  fixtureLabel: string;
  liveMode: boolean;
  workbookPath: string;
  availablePatientCount: number;
  eligiblePatientCount: number;
  selectedPatientCount: number;
  selectionReason: string;
  parserExceptionCount: number;
  patientRun: PatientRun;
  safety: OasisDemoSummary["safety"];
}): OasisDemoSummary {
  const { patientRun } = input;

  return {
    fixtureLabel: input.fixtureLabel,
    liveMode: input.liveMode,
    workbookPath: input.workbookPath,
    availablePatientCount: input.availablePatientCount,
    eligiblePatientCount: input.eligiblePatientCount,
    selectedPatientCount: input.selectedPatientCount,
    selectionReason: input.selectionReason,
    parserExceptionCount: input.parserExceptionCount,
    patientName: patientRun.patientName,
    workItemId: patientRun.workItemId,
    patientMatchStatus: patientRun.matchResult.status,
    urgency: patientRun.oasisQaSummary.urgency,
    daysInPeriod: patientRun.oasisQaSummary.daysInPeriod,
    daysLeft: patientRun.oasisQaSummary.daysLeft,
    overallStatus: patientRun.oasisQaSummary.overallStatus,
    blockerCount: patientRun.oasisQaSummary.blockers.length,
    blockers: [...patientRun.oasisQaSummary.blockers],
    documentInventory: patientRun.documentInventory.map((item) => ({
      sourceLabel: item.sourceLabel,
      normalizedType: item.normalizedType,
      discipline: item.discipline,
      confidence: item.confidence,
      evidence: [...item.evidence],
    })),
    qaSections: patientRun.oasisQaSummary.sections.map((section) => ({
      key: section.key,
      status: section.status,
      blockerCount: section.items.filter((item) => item.status === "FAIL" || item.status === "MISSING").length,
      evidenceSamples: section.items.flatMap((item) => item.evidence).slice(0, 4),
    })),
    stepLogCount: patientRun.automationStepLogs.length,
    stepNames: patientRun.automationStepLogs.map((log) => log.step),
    evidenceFiles: collectEvidenceFiles(patientRun),
    logPath: patientRun.logPath,
    resultBundlePath: patientRun.resultBundlePath,
    portal: derivePortalSummary(patientRun),
    futureWritePoints: [
      "Reviewer note write point is documented only and not executed.",
      "QA status update write point is documented only and not executed.",
      "Ready-for-billing write point is documented only and not executed.",
      "Follow-up task write point is documented only and not executed.",
    ],
    safety: input.safety,
  };
}

function buildDemoMarkdown(summary: OasisDemoSummary): string {
  const documentLines = summary.documentInventory
    .map((item) => `- ${item.normalizedType} (${item.sourceLabel}) confidence=${item.confidence.toFixed(2)}`)
    .join("\n");
  const sectionLines = summary.qaSections
    .map((section) => `- ${section.key}: ${section.status} (${section.blockerCount} blockers)`)
    .join("\n");
  const blockerLines = summary.blockers.length > 0
    ? summary.blockers.map((blocker) => `- ${blocker}`).join("\n")
    : "- None";

  return [
    "# OASIS QA Demo Summary",
    "",
    `- Demo label: ${summary.fixtureLabel}`,
    `- Live portal mode: ${summary.liveMode}`,
    `- Workbook: ${summary.workbookPath}`,
    `- Normalized work items in workbook: ${summary.availablePatientCount}`,
    `- Demo-eligible work items: ${summary.eligiblePatientCount}`,
    `- Work items selected for demo run: ${summary.selectedPatientCount}`,
    `- Selection reason: ${summary.selectionReason}`,
    `- Parser exceptions from intake: ${summary.parserExceptionCount}`,
    `- Patient: ${summary.patientName}`,
    `- Patient match status: ${summary.patientMatchStatus}`,
    `- Portal login status: ${summary.portal.loginStatus}`,
    `- Portal login detail: ${summary.portal.loginMessage ?? "n/a"}`,
    `- Chart opened: ${summary.portal.chartOpened}`,
    `- Chart open detail: ${summary.portal.chartOpenMessage ?? "n/a"}`,
    `- Overall QA status: ${summary.overallStatus}`,
    `- Urgency: ${summary.urgency}`,
    `- Days in period: ${summary.daysInPeriod ?? "n/a"}`,
    `- Days left: ${summary.daysLeft ?? "n/a"}`,
    `- Step log count: ${summary.stepLogCount}`,
    `- Read-only safety mode: ${summary.safety.safetyMode}`,
    `- Dangerous controls detected: ${summary.safety.dangerousControlsDetected.join(", ") || "none detected"}`,
    `- Dangerous write blocked: ${summary.safety.dangerousWriteAttemptBlocked}`,
    "",
    "## Documents Found",
    documentLines,
    "",
    "## QA Sections",
    sectionLines,
    "",
    "## Blockers",
    blockerLines,
    "",
    "## Evidence Files",
    ...summary.evidenceFiles.map((filePath) => `- ${filePath}`),
    "",
    "## Future Write Points",
    ...summary.futureWritePoints.map((entry) => `- ${entry}`),
  ].join("\n");
}

function assertDemoExpectations(input: {
  result: RunFinaleBatchResult;
  patientRun: PatientRun;
  expectedPatientRunCount: number;
  expectedSafetyMode: PortalSafetyConfig["safetyMode"];
  dangerousWriteAttemptBlocked: boolean;
}): void {
  const { result, patientRun, expectedPatientRunCount } = input;
  const stepOrder = patientRun.automationStepLogs.map((log) => log.step);
  const stepNames = new Set(stepOrder);
  const requiredSteps = [
    "login",
    "patient_search",
    "chart_open",
    "qa_summary",
  ];
  const qaSummaryLogs = patientRun.automationStepLogs.filter((log) => log.step === "qa_summary");
  const finalQaSummaryLog = qaSummaryLogs.at(-1);
  const expectedQaSummaryFound = new Set(
    patientRun.oasisQaSummary.sections.map((section) => `${section.key}:${section.status}`),
  );
  const actualQaSummaryFound = new Set(finalQaSummaryLog?.found ?? []);
  const expectedQaSummaryMissing = new Set(patientRun.oasisQaSummary.blockers);
  const actualQaSummaryMissing = new Set(finalQaSummaryLog?.missing ?? []);
  const exactWorkflowRequiredSteps = [
    "document_extraction",
    "admission_document_extract",
    "oasis_extract",
    "poc_extract",
    "visit_note_extract",
    "technical_review_extract",
    "diagnosis_code_extract",
    "coding_input_export",
  ];

  assert.equal(input.expectedSafetyMode, "READ_ONLY");
  assert.equal(input.dangerousWriteAttemptBlocked, true);
  assert.equal(result.patientRuns.length, expectedPatientRunCount);
  assert.ok(patientRun.automationStepLogs.length > 0, "automationStepLogs must not be empty.");
  assert.ok(patientRun.oasisQaSummary.sections.length > 0, "oasisQaSummary sections must be populated.");
  assert.ok(patientRun.logPath, "patient log path must exist.");
  assert.ok(patientRun.resultBundlePath, "patient result bundle path must exist.");
  assert.ok(patientRun.automationStepLogs.every((log) => log.safeReadConfirmed), "all step logs must confirm safe read actions.");
  console.info("current step list before harness validation", {
    stepNames: [...stepNames],
  });
  console.info("qaSummaryEmitted", stepNames.has("qa_summary"));

  for (const requiredStep of requiredSteps) {
    assert.ok(stepNames.has(requiredStep), `automationStepLogs missing required step '${requiredStep}'.`);
  }

  if (patientRun.matchResult.status === "EXACT") {
    console.info("pipeline restored to baseline path", {
      patientSearchEmitted: stepNames.has("patient_search"),
      chartOpenEmitted: stepNames.has("chart_open"),
    });
    console.info("patient_search emitted", stepNames.has("patient_search"));
    console.info("chart_open emitted", stepNames.has("chart_open"));
    console.info("legacy documentInventory validation removed");
    if (!finalQaSummaryLog) {
      assert.fail("automationStepLogs missing final qa_summary log.");
    }
    assert.deepEqual(
      [...actualQaSummaryFound].sort(),
      [...expectedQaSummaryFound].sort(),
      "final qa_summary found signals must mirror oasisQaSummary section statuses.",
    );
    assert.deepEqual(
      [...actualQaSummaryMissing].sort(),
      [...expectedQaSummaryMissing].sort(),
      "final qa_summary missing signals must mirror oasisQaSummary blockers.",
    );
    assert.ok(
      patientRun.oasisQaSummary.blockers.every((blocker) => finalQaSummaryLog.evidence.includes(blocker)),
      "final qa_summary evidence must include each reported blocker.",
    );
    for (const step of exactWorkflowRequiredSteps) {
      assert.ok(
        stepNames.has(step),
        `automationStepLogs missing required exact-match extraction step '${step}'.`,
      );
    }
  } else {
    assert.ok(
      stepNames.has("chart_discovery_skipped"),
      "non-exact patient matches must record that chart discovery was skipped.",
    );
  }

  for (const item of patientRun.documentInventory) {
    assert.ok(item.confidence > 0, `documentInventory item '${item.sourceLabel}' must include confidence.`);
    assert.ok(item.evidence.length > 0, `documentInventory item '${item.sourceLabel}' must include evidence.`);
  }

  for (const section of patientRun.oasisQaSummary.sections) {
    for (const item of section.items) {
      if (item.status === "PASS") {
        assert.ok(
          item.evidence.length > 0,
          `PASS checklist item '${item.label}' must include evidence.`,
        );
      }
    }
  }

  for (const filePath of collectEvidenceFiles(patientRun)) {
    assert.ok(path.isAbsolute(filePath), `evidence path must be absolute: ${filePath}`);
  }
}

export async function runOasisDemoHarness(input: {
  outputDir: string;
  workbookPath?: string;
  patient?: string;
  limit?: number;
  all?: boolean;
  live?: boolean;
}): Promise<OasisDemoHarnessResult> {
  const outputDir = path.resolve(input.outputDir);
  const workbookPath = resolveWorkbookPath(input.workbookPath);
  const liveMode = input.live ?? false;
  const runOutputDir = path.join(outputDir, "run");
  await mkdir(runOutputDir, { recursive: true });

  if (liveMode) {
    ensureLivePortalConfiguration();
  }

  const intake = await intakeWorkbook({
    workbookPath,
    outputDir: runOutputDir,
  });
  const selection = selectDemoWorkItems({
    workItems: intake.workItems,
    patient: input.patient,
    limit: input.limit,
    all: input.all,
  });
  const fixtureLabel = liveMode
    ? "live-portal-read-only-oasis-demo"
    : "simulated-read-only-oasis-demo";
  const portalClient = liveMode ? undefined : new DemoReadOnlyPortalClient();
  const result = await runFinaleBatch({
    manifest: {
      ...intake.manifest,
      totalWorkItems: selection.selectedWorkItems.length,
      automationEligibleWorkItemIds: selection.selectedWorkItems.map((item) => item.id),
    },
    workItems: selection.selectedWorkItems,
    parserExceptions: intake.parserExceptions,
    workbookPath,
    outputDir: runOutputDir,
    portalClient,
  });
  const patientRun = result.patientRuns[0];

  assert.ok(patientRun, "demo run did not produce a patient run.");
  const dangerousWriteAttemptBlocked = portalClient
    ? portalClient.dangerousWriteAttemptBlocked
    : confirmDangerousWriteBlocked();
  const dangerousControlsDetected = portalClient
    ? [...portalClient.dangerousControlsDetected]
    : deriveDangerousControlsDetected(patientRun);
  assertDemoExpectations({
    result,
    patientRun,
    expectedPatientRunCount: selection.selectedWorkItems.length,
    expectedSafetyMode: DEMO_READ_ONLY_SAFETY.safetyMode,
    dangerousWriteAttemptBlocked,
  });

  const demoSummary = buildDemoSummary({
    fixtureLabel,
    liveMode,
    workbookPath,
    availablePatientCount: intake.workItems.length,
    eligiblePatientCount: selection.eligibleWorkItems.length,
    selectedPatientCount: selection.selectedWorkItems.length,
    selectionReason: selection.selectionReason,
    parserExceptionCount: intake.parserExceptions.length,
    patientRun,
    safety: {
      safetyMode: DEMO_READ_ONLY_SAFETY.safetyMode,
      dangerousControlsDetected,
      dangerousWriteAttemptBlocked,
      writeExecutorUsed: false,
      workflowExecutorUsed: false,
    },
  });
  const demoSummaryJsonPath = path.join(outputDir, "demo-summary.json");
  const demoSummaryMarkdownPath = path.join(outputDir, "demo-summary.md");

  await writeFile(demoSummaryJsonPath, JSON.stringify(demoSummary, null, 2), "utf8");
  await writeFile(demoSummaryMarkdownPath, buildDemoMarkdown(demoSummary), "utf8");

  return {
    outputDir,
    workbookPath,
    liveMode,
    availablePatientCount: intake.workItems.length,
    eligiblePatientCount: selection.eligibleWorkItems.length,
    selectedPatientCount: selection.selectedWorkItems.length,
    selectionReason: selection.selectionReason,
    parserExceptionCount: intake.parserExceptions.length,
    result,
    patientRun,
    demoSummary,
    demoSummaryJsonPath,
    demoSummaryMarkdownPath,
  };
}
