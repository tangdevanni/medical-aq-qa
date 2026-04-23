import { type Page } from "@playwright/test";
import { type DiagnosticAction, type RuntimeDiagnostic, type SelectorHealthRecord, type SupportDisposition, type SupportMatrixDiagnostic } from "../types/runtimeDiagnostics";
import { type DocumentKind } from "../types/documentKinds";
import { getWorkflowActionDefinition } from "../workflows/workflowSelectorRegistry";
import { checkSelectorHealth } from "./checkSelectorHealth";
import { buildDriftSignalsFromSelectorHealth, buildRouteDriftSignal } from "./driftSignalDetector";
import { listSelectorHealthEntriesForDocument, type SelectorHealthRegistryEntry } from "./selectorHealthRegistry";
import { routeMatchesExpectedDocumentKind, routeMatchesWorkflowDefinition, severityForSelectorHealthStatus } from "./selectorHealthHelpers";

type SupportAwareSelectorHealthEntry = SelectorHealthRegistryEntry & {
  supportLevel: SelectorHealthRecord["supportLevel"];
};

export async function runSelectorHealthChecks(input: {
  page: Page;
  documentKind: DocumentKind;
  phase: "EXTRACTION" | "WRITE_EXECUTION" | "WORKFLOW_EXECUTION";
  targetField?: string | null;
  action?: DiagnosticAction | null;
  supportDisposition?: SupportDisposition;
  supportDiagnostics?: SupportMatrixDiagnostic[];
}): Promise<{
  selectorHealth: SelectorHealthRecord[];
  runtimeDiagnostics: RuntimeDiagnostic[];
  driftSignals: ReturnType<typeof buildDriftSignalsFromSelectorHealth>;
}> {
  const entries = listSelectorHealthEntriesForDocument({
    documentKind: input.documentKind,
    phase: input.phase,
    targetField: input.targetField,
    action: input.action,
  }).map((entry) => applySupportContext(entry, input.supportDiagnostics, input.supportDisposition));

  const selectorHealth = await Promise.all(entries.map((entry) => {
    if (shouldSkipSelectorProbe(entry)) {
      return buildUnsupportedSelectorHealthRecord(entry);
    }

    return checkSelectorHealth({
      page: input.page,
      entry,
    });
  }));
  const runtimeDiagnostics: RuntimeDiagnostic[] = selectorHealth
    .filter((entry) => entry.status !== "HEALTHY" && entry.status !== "UNSUPPORTED")
    .map((entry) => ({
    timestamp: new Date().toISOString(),
    severity: severityForSelectorHealthStatus(entry.status),
    category: "SELECTOR_HEALTH",
    code: `SELECTOR_${entry.status}`,
    message: entry.reason ?? `Selector health evaluated as ${entry.status}.`,
    phase: entry.phase,
    documentKind: entry.documentKind,
    action: entry.action ?? null,
    targetField: entry.targetField ?? null,
    selectorName: entry.name,
    supportLevel: entry.supportLevel ?? null,
    supportDisposition: entry.supportDisposition ?? null,
  }));
  const routeMismatch = !routeMatchesExpectedDocumentKind(input.page.url(), input.documentKind);
  const driftSignals = buildDriftSignalsFromSelectorHealth({
    selectorHealth,
    supportMatrixDiagnostics: input.supportDiagnostics,
    routePath: safePathname(input.page.url()),
    documentKind: input.documentKind,
  });

  if (routeMismatch) {
    runtimeDiagnostics.push({
      timestamp: new Date().toISOString(),
      severity: "ERROR",
      category: "PAGE_STATE",
      code: "PAGE_KIND_MISMATCH",
      message: `Current route no longer matches the expected ${input.documentKind} pattern.`,
      phase: input.phase,
      documentKind: input.documentKind,
      action: input.action ?? null,
      targetField: input.targetField ?? null,
      selectorName: null,
      supportLevel: effectiveSupportLevel(entries) ?? null,
      supportDisposition: effectiveSupportDisposition(entries, input.supportDisposition) ?? null,
    });
    if (shouldRaiseRouteDrift(entries, input.phase)) {
      driftSignals.push(buildRouteDriftSignal({
        documentKind: input.documentKind,
        reason: `Current route no longer matches the expected ${input.documentKind} pattern.`,
        routePath: safePathname(input.page.url()),
        supportLevel: effectiveSupportLevel(entries) ?? null,
        supportDisposition: effectiveSupportDisposition(entries, input.supportDisposition) ?? "EXECUTABLE",
      }));
    }
  }

  if (input.phase === "WORKFLOW_EXECUTION" && input.action) {
    const definition = getWorkflowActionDefinition(input.documentKind, input.action);
    if (!routeMatchesWorkflowDefinition(input.page.url(), definition)) {
      runtimeDiagnostics.push({
        timestamp: new Date().toISOString(),
        severity: "ERROR",
        category: "PAGE_STATE",
        code: "PAGE_KIND_MISMATCH",
        message: `Workflow route did not match the expected ${input.action} route pattern.`,
        phase: input.phase,
        documentKind: input.documentKind,
        action: input.action,
        targetField: input.targetField ?? null,
        selectorName: null,
        supportLevel: null,
        supportDisposition: input.supportDisposition ?? null,
      });
    }
  }

  return {
    selectorHealth,
    runtimeDiagnostics,
    driftSignals,
  };
}

function safePathname(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function applySupportContext(
  entry: SelectorHealthRegistryEntry,
  supportDiagnostics: SupportMatrixDiagnostic[] | undefined,
  fallbackDisposition: SupportDisposition | undefined,
): SupportAwareSelectorHealthEntry {
  const supportDiagnostic = supportDiagnostics?.find((diagnostic) =>
    diagnostic.action === entry.action &&
    diagnostic.targetField === entry.targetField,
  );

  return {
    ...entry,
    supportLevel: supportDiagnostic?.supportLevel ?? null,
    supportDisposition: supportDiagnostic?.supportDisposition ?? fallbackDisposition ?? entry.supportDisposition,
  };
}

function shouldSkipSelectorProbe(entry: SupportAwareSelectorHealthEntry): boolean {
  return entry.phase !== "EXTRACTION" && entry.supportDisposition !== "EXECUTABLE" && entry.supportDisposition !== "DRY_RUN_ONLY";
}

function buildUnsupportedSelectorHealthRecord(entry: SupportAwareSelectorHealthEntry): SelectorHealthRecord {
  return {
    ...entry,
    status: "UNSUPPORTED",
    matchedCount: 0,
    selectorUsed: null,
    reason: entry.supportDisposition === "REVIEW_GATED"
      ? "Selector probe skipped because the action is intentionally review-gated."
      : entry.supportDisposition === "PLANNED_ONLY"
        ? "Selector probe skipped because the action is planned-only."
        : "Selector probe skipped because the action is not currently executable.",
  };
}

function effectiveSupportDisposition(
  entries: SupportAwareSelectorHealthEntry[],
  fallbackDisposition: SupportDisposition | undefined,
): SupportDisposition | undefined {
  return entries[0]?.supportDisposition ?? fallbackDisposition;
}

function effectiveSupportLevel(entries: SupportAwareSelectorHealthEntry[]) {
  return entries[0]?.supportLevel ?? null;
}

function shouldRaiseRouteDrift(
  entries: SupportAwareSelectorHealthEntry[],
  phase: "EXTRACTION" | "WRITE_EXECUTION" | "WORKFLOW_EXECUTION",
): boolean {
  if (phase === "EXTRACTION") {
    return false;
  }

  return entries.some((entry) => entry.supportDisposition === "EXECUTABLE");
}
