import type { Page } from "@playwright/test";
import type { AutomationStepLog } from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import type { PatientPortalContext } from "../../portal/context/patientPortalContext";
import { createAutomationStepLog } from "../../portal/utils/automationLog";
import {
  dumpTopVisibleText,
  summarizeButtons,
  summarizeInteractiveElements,
} from "../../portal/utils/pageDiagnostics";
import { createWorkflowRunId } from "../../workflows/patientWorkflowRunState";
import {
  resolveQaDocumentRouteCandidates,
  selectQaDocumentRouteCandidate,
  summarizeQaSelectedRoute,
} from "./qaDocumentRouteResolver";
import { detectQaLockStatus, resolveQaDiagnosisRoute } from "./qaDiagnosisRouteResolver";
import { resolveQaOasisRoute } from "./qaOasisRouteResolver";
import type { QaPrefetchResult } from "../types/qaPrefetchResult";

export interface QaChartDiscoveryServiceParams {
  page: Page;
  context: PatientPortalContext;
  logger: Logger;
}

export interface QaChartDiscoveryServiceResult {
  result: QaPrefetchResult;
  stepLogs: AutomationStepLog[];
}

export class QaChartDiscoveryService {
  constructor(private readonly params: QaChartDiscoveryServiceParams) {}

  async discover(): Promise<QaChartDiscoveryServiceResult> {
    const currentUrl = this.params.page.url();
    const sidebarLabels = await collectVisibleTexts(this.params.page, [
      "fin-sidebar-menu-root span",
      "fin-sidebar span",
      "nav.fin-sidebar__wrapper span",
      ".fin-sidebar__wrapper span",
      "aside a",
    ]);
    const topVisibleText = splitVisibleText(await dumpTopVisibleText(this.params.page, 2200));
    const buttonLabels = await summarizeButtons(this.params.page);
    const interactiveLabels = await summarizeInteractiveElements(this.params.page);

    const routeCandidates = resolveQaDocumentRouteCandidates({
      currentUrl,
      sidebarLabels,
      topVisibleText,
    });
    const selectedRoute = selectQaDocumentRouteCandidate(routeCandidates);
    const routeWarnings = buildRouteWarnings(routeCandidates, selectedRoute);

    const oasisRoute = resolveQaOasisRoute({
      currentUrl,
      sidebarLabels,
      topVisibleText,
      buttonLabels,
    });
    const diagnosisRoute = resolveQaDiagnosisRoute({
      currentUrl,
      sidebarLabels,
      topVisibleText,
      interactiveLabels,
    });
    const lockStatus = detectQaLockStatus({
      currentUrl,
      buttonLabels,
      interactiveLabels,
      topVisibleText,
    });

    const warnings = [
      ...routeWarnings,
      ...oasisRoute.warnings,
      ...diagnosisRoute.warnings,
      ...(lockStatus.status === "unknown" ? ["OASIS lock state was not visible from the current QA prefetch surface."] : []),
    ];
    const status = warnings.length > 0 ? "COMPLETED_WITH_WARNINGS" : "COMPLETED";
    const createdAt = new Date().toISOString();
    const selectedRouteSummary = summarizeQaSelectedRoute(selectedRoute);
    const workflowRunId = createWorkflowRunId(this.params.context.patientRunId, "qa");

    const stepLogs = buildStepLogs({
      context: this.params.context,
      currentUrl,
      sidebarLabels,
      routeCandidates,
      selectedRouteSummary,
      oasisRoute,
      diagnosisRoute,
      lockStatus,
      warnings,
    });

    this.params.logger.info(
      {
        workflowDomain: "qa",
        patientRunId: this.params.context.patientRunId,
        workflowRunId,
        stepName: "qa_prefetch_result_persisted",
        currentUrl,
        outcome: status,
        routeClassification: selectedRoute?.classification ?? "unknown",
        warnings,
      },
      "qa prefetch discovery completed",
    );

    return {
      result: {
        workflowDomain: "qa",
        workflowRunId,
        patientRunId: this.params.context.patientRunId,
        patientName: this.params.context.patientName,
        patientId: this.params.context.patientId ?? null,
        chartUrl: this.params.context.chartUrl,
        dashboardUrl: this.params.context.dashboardUrl ?? null,
        resolvedAt: this.params.context.resolvedAt,
        status,
        routeDiscovery: {
          currentUrl,
          sidebarLabels,
          topVisibleText: topVisibleText.slice(0, 12),
          routeCandidates,
          selectedRoute,
          warnings: routeWarnings,
        },
        oasisRoute,
        diagnosisRoute,
        lockStatus,
        selectedRouteSummary,
        warningCount: warnings.length,
        topWarning: warnings[0] ?? null,
        warnings,
        createdAt,
      },
      stepLogs,
    };
  }
}

async function collectVisibleTexts(page: Page, selectors: string[]): Promise<string[]> {
  const results = new Set<string>();

  for (const selector of selectors) {
    const texts = await page.locator(selector).evaluateAll((elements) =>
      elements
        .map((element) => (element.textContent ?? "").trim())
        .filter((value) => value.length > 0)
        .slice(0, 40),
    ).catch(() => [] as string[]);

    for (const text of texts) {
      results.add(text.replace(/\s+/g, " "));
    }
  }

  return [...results].slice(0, 30);
}

function splitVisibleText(text: string): string[] {
  return text
    .split(/\r?\n+/)
    .map((value) => value.trim().replace(/\s+/g, " "))
    .filter((value) => value.length > 0)
    .slice(0, 40);
}

function buildRouteWarnings(
  candidates: QaPrefetchResult["routeDiscovery"]["routeCandidates"],
  selectedRoute: QaPrefetchResult["routeDiscovery"]["selectedRoute"],
): string[] {
  if (candidates.length === 0) {
    return ["No route candidates were detected from the patient chart sidebar or visible page text."];
  }

  if (!selectedRoute) {
    return ["Route discovery produced candidates, but no route could be selected."];
  }

  if (selectedRoute.classification === "provider_documents") {
    return ["The strongest document route candidate looks like a provider/global documents page, not a patient-specific route."];
  }

  return [];
}

function buildStepLogs(input: {
  context: PatientPortalContext;
  currentUrl: string;
  sidebarLabels: string[];
  routeCandidates: QaPrefetchResult["routeDiscovery"]["routeCandidates"];
  selectedRouteSummary: string;
  oasisRoute: QaPrefetchResult["oasisRoute"];
  diagnosisRoute: QaPrefetchResult["diagnosisRoute"];
  lockStatus: QaPrefetchResult["lockStatus"];
  warnings: string[];
}): AutomationStepLog[] {
  const base = {
    patientName: input.context.patientName,
    urlBefore: input.context.chartUrl,
    urlAfter: input.currentUrl,
    safeReadConfirmed: true,
  } as const;

  return [
    createAutomationStepLog({
      ...base,
      step: "qa_chart_discovery_start",
      message: "QA branch began real chart discovery from PatientPortalContext.",
      found: [
        `workflowDomain=qa`,
        `patientRunId=${input.context.patientRunId}`,
        `chartUrl=${input.context.chartUrl}`,
      ],
    }),
    createAutomationStepLog({
      ...base,
      step: "qa_sidebar_scan",
      message: "Captured visible sidebar labels from the patient chart.",
      found: input.sidebarLabels.slice(0, 12),
      missing: input.sidebarLabels.length > 0 ? [] : ["sidebar labels"],
      evidence: [`sidebarLabelCount=${input.sidebarLabels.length}`],
    }),
    createAutomationStepLog({
      ...base,
      step: "qa_document_route_candidates",
      message: "Evaluated document route candidates from URL, sidebar labels, and visible page text.",
      found: input.routeCandidates.map((candidate) =>
        `${candidate.classification}:${candidate.source}:${candidate.label}`,
      ).slice(0, 12),
      missing: input.routeCandidates.length > 0 ? [] : ["document route candidates"],
      evidence: [`candidateCount=${input.routeCandidates.length}`],
    }),
    createAutomationStepLog({
      ...base,
      step: "qa_document_route_selected",
      message: "Selected the strongest QA route candidate for downstream prefetch readiness.",
      found: [input.selectedRouteSummary],
      evidence: input.warnings,
    }),
    createAutomationStepLog({
      ...base,
      step: "qa_route_classification",
      message: "Recorded the resolved QA route classification.",
      found: [input.selectedRouteSummary],
      evidence: input.routeCandidates.map((candidate) => `${candidate.classification}:${candidate.matchedValue}`).slice(0, 8),
      missing: input.routeCandidates.length > 0 ? [] : ["route classification"],
    }),
    createAutomationStepLog({
      ...base,
      step: "qa_oasis_route_scan",
      message: input.oasisRoute.found
        ? "Detected OASIS-related route signals during QA prefetch."
        : "No OASIS-related route signals were detected during QA prefetch.",
      found: input.oasisRoute.signals.map((signal) => `${signal.source}:${signal.value}`).slice(0, 8),
      missing: input.oasisRoute.found ? [] : ["OASIS route signals"],
      evidence: input.oasisRoute.warnings,
    }),
    createAutomationStepLog({
      ...base,
      step: "qa_diagnosis_route_scan",
      message: input.diagnosisRoute.found
        ? "Detected diagnosis-related route signals during QA prefetch."
        : "No diagnosis-related route signals were detected during QA prefetch.",
      found: [
        ...input.diagnosisRoute.signals.map((signal) => `${signal.source}:${signal.value}`).slice(0, 6),
        ...input.diagnosisRoute.visibleDiagnoses.map((diagnosis) => diagnosis.text).slice(0, 4),
      ],
      missing: input.diagnosisRoute.found ? [] : ["diagnosis route signals"],
      evidence: input.diagnosisRoute.warnings,
    }),
    createAutomationStepLog({
      ...base,
      step: "qa_lock_status_detected",
      message: `Detected QA lock status as ${input.lockStatus.status}.`,
      found: [
        `lockStatus=${input.lockStatus.status}`,
        ...input.lockStatus.signals.map((signal) => `${signal.source}:${signal.value}`).slice(0, 6),
      ],
      missing: input.lockStatus.status === "unknown" ? ["lock status signal"] : [],
      evidence: input.warnings.filter((warning) => warning.toLowerCase().includes("lock state")),
    }),
    createAutomationStepLog({
      ...base,
      step: "qa_visible_diagnoses_captured",
      message: `Captured ${input.diagnosisRoute.visibleDiagnoses.length} visible diagnosis candidate(s) during QA prefetch.`,
      found: input.diagnosisRoute.visibleDiagnoses.map((diagnosis) => diagnosis.text).slice(0, 8),
      missing: input.diagnosisRoute.visibleDiagnoses.length > 0 ? [] : ["visible diagnosis candidates"],
      evidence: input.diagnosisRoute.signals.map((signal) => `${signal.source}:${signal.value}`).slice(0, 8),
    }),
    createAutomationStepLog({
      ...base,
      step: "qa_prefetch_result_persisted",
      message: "QA prefetch discovery result is ready to persist under the QA workflow domain.",
      found: [
        `selectedRouteSummary=${input.selectedRouteSummary}`,
        `warningCount=${input.warnings.length}`,
      ],
      evidence: input.warnings,
    }),
  ];
}
