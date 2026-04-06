import { type DriftSignal, type SelectorHealthRecord, type SupportMatrixDiagnostic } from "../types/runtimeDiagnostics";
import { type DocumentKind } from "../types/documentKinds";

export function buildDriftSignalsFromSelectorHealth(input: {
  selectorHealth: SelectorHealthRecord[];
  supportMatrixDiagnostics?: SupportMatrixDiagnostic[];
  routePath?: string | null;
  documentKind: DocumentKind;
}): DriftSignal[] {
  const supportByAction = new Map<string, SupportMatrixDiagnostic>();
  for (const diagnostic of input.supportMatrixDiagnostics ?? []) {
    const key = `${diagnostic.action ?? "NO_ACTION"}:${diagnostic.targetField ?? "NO_FIELD"}`;
    supportByAction.set(key, diagnostic);
  }

  return input.selectorHealth.flatMap((entry) => {
    const supportDiagnostic = supportByAction.get(`${entry.action ?? "NO_ACTION"}:${entry.targetField ?? "NO_FIELD"}`);
    const driftEligible = supportDiagnostic?.driftEligible ?? entry.supportDisposition === "EXECUTABLE";

    if (!driftEligible) {
      return [];
    }

    if (entry.status === "MISSING") {
      return [buildDriftSignal({
        type: "SELECTOR_MISSING",
        documentKind: input.documentKind,
        selectorName: entry.name,
        action: entry.action,
        targetField: entry.targetField ?? null,
        routePath: input.routePath ?? null,
        supportLevel: entry.supportLevel ?? null,
        supportDisposition: entry.supportDisposition ?? "EXECUTABLE",
        reason: `Expected executable selector missing for ${entry.name}.`,
      })];
    }

    if (entry.status === "AMBIGUOUS") {
      return [buildDriftSignal({
        type: "SELECTOR_AMBIGUOUS",
        documentKind: input.documentKind,
        selectorName: entry.name,
        action: entry.action,
        targetField: entry.targetField ?? null,
        routePath: input.routePath ?? null,
        supportLevel: entry.supportLevel ?? null,
        supportDisposition: entry.supportDisposition ?? "EXECUTABLE",
        reason: `Executable selector became ambiguous for ${entry.name}.`,
      })];
    }

    return [];
  });
}

export function buildRouteDriftSignal(input: {
  documentKind: DocumentKind;
  reason: string;
  routePath: string | null;
  supportLevel?: DriftSignal["supportLevel"];
  supportDisposition?: DriftSignal["supportDisposition"];
}): DriftSignal {
  return buildDriftSignal({
    type: "ROUTE_PATTERN_CHANGED",
    documentKind: input.documentKind,
    selectorName: null,
    action: null,
    targetField: null,
    routePath: input.routePath,
    supportLevel: input.supportLevel ?? null,
    supportDisposition: input.supportDisposition ?? "EXECUTABLE",
    reason: input.reason,
  });
}

export function buildPostStepDriftSignal(input: {
  documentKind: DocumentKind;
  selectorName: string | null;
  action: DriftSignal["action"];
  targetField?: string | null;
  supportLevel?: DriftSignal["supportLevel"];
  supportDisposition?: DriftSignal["supportDisposition"];
  reason: string;
}): DriftSignal {
  return buildDriftSignal({
    type: "POST_STEP_SIGNAL_MISSING",
    documentKind: input.documentKind,
    selectorName: input.selectorName,
    action: input.action ?? null,
    targetField: input.targetField ?? null,
    routePath: null,
    supportLevel: input.supportLevel ?? null,
    supportDisposition: input.supportDisposition ?? "EXECUTABLE",
    reason: input.reason,
  });
}

function buildDriftSignal(input: {
  type: DriftSignal["type"];
  documentKind: DocumentKind;
  selectorName: string | null;
  action: DriftSignal["action"];
  targetField: string | null;
  routePath: string | null;
  supportLevel: DriftSignal["supportLevel"];
  supportDisposition: DriftSignal["supportDisposition"];
  reason: string;
}): DriftSignal {
  return {
    timestamp: new Date().toISOString(),
    type: input.type,
    severity: "ERROR",
    documentKind: input.documentKind,
    selectorName: input.selectorName,
    action: input.action ?? null,
    targetField: input.targetField,
    supportLevel: input.supportLevel ?? null,
    supportDisposition: input.supportDisposition ?? "EXECUTABLE",
    routePath: input.routePath,
    reason: input.reason,
  };
}
