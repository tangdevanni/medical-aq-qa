import { type Page } from "@playwright/test";
import { type DocumentKind, type RuntimeDiagnostic } from "@medical-ai-qa/shared-types";
import { WORKFLOW_ACTION_SELECTORS } from "../portal/selectors/workflow-action.selectors";
import { WRITE_FIELD_SELECTORS } from "../portal/selectors/write-field.selectors";

function getWorkflowSelectors(): string[] {
  return Object.values(WORKFLOW_ACTION_SELECTORS)
    .flatMap((definition) => Object.values(definition))
    .flatMap((value) => ("selectors" in value ? [...value.selectors] : []));
}

function getWriteFieldSelectors(): string[] {
  return Object.values(WRITE_FIELD_SELECTORS).flatMap((entry) => [...entry.selectors]);
}

function toDiagnostic(input: {
  documentKind: DocumentKind | null;
  selectorUsed: string;
  label: string;
}): RuntimeDiagnostic {
  return {
    timestamp: new Date().toISOString(),
    severity: "WARNING",
    category: "PORTAL_SAFETY",
    code: "DANGEROUS_CONTROL_DETECTED",
    message: `Potential write-capable control detected in read-only flow: ${input.label}`,
    phase: "QUEUE_PIPELINE",
    documentKind: input.documentKind,
    action: null,
    targetField: null,
    selectorName: input.selectorUsed,
    metadata: {
      label: input.label,
      selectorUsed: input.selectorUsed,
    },
  };
}

export async function detectDangerousControls(input: {
  page: Page;
  documentKind: DocumentKind | null;
}): Promise<RuntimeDiagnostic[]> {
  const diagnostics: RuntimeDiagnostic[] = [];
  const seen = new Set<string>();

  for (const selector of [...getWorkflowSelectors(), ...getWriteFieldSelectors(), 'input[type="file"]', '[contenteditable="true"]']) {
    const locator = input.page.locator(selector).first();
    if (!(await locator.isVisible().catch(() => false))) {
      continue;
    }

    const label = (
      (await locator.getAttribute("aria-label").catch(() => null)) ??
      (await locator.getAttribute("title").catch(() => null)) ??
      (await locator.textContent().catch(() => null)) ??
      selector
    ).replace(/\s+/g, " ").trim();
    const key = `${selector}:${label}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    diagnostics.push(
      toDiagnostic({
        documentKind: input.documentKind,
        selectorUsed: selector,
        label,
      }),
    );
  }

  return diagnostics;
}
