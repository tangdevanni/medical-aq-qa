import { type DocumentKind, type FinalizeAction } from "@medical-ai-qa/shared-types";
import { WORKFLOW_ACTION_SELECTORS } from "../portal/selectors/workflow-action.selectors";
import {
  type ResolvedWorkflowActionTarget,
  type WorkflowActionSelectorDefinition,
  type WorkflowPageLike,
} from "../types/workflowSteps";

const WORKFLOW_SELECTOR_REGISTRY: WorkflowActionSelectorDefinition[] = [
  {
    targetDocumentKind: "VISIT_NOTE",
    action: "SAVE_PAGE",
    candidates: [
      ...WORKFLOW_ACTION_SELECTORS.visitNote.savePage.selectors.map((selector) => ({
        kind: "selector" as const,
        selector,
        description: selector,
      })),
      ...WORKFLOW_ACTION_SELECTORS.visitNote.savePage.buttonNames.map((name) => ({
        kind: "button" as const,
        name,
        exact: true,
        description: name,
      })),
    ],
    successSelectors: WORKFLOW_ACTION_SELECTORS.visitNote.savePage.successSelectors,
    dirtySelectors: WORKFLOW_ACTION_SELECTORS.visitNote.savePage.dirtySelectors,
    routePatterns: WORKFLOW_ACTION_SELECTORS.visitNote.routePatterns,
  },
  {
    targetDocumentKind: "VISIT_NOTE",
    action: "VALIDATE_PAGE",
    candidates: [
      ...WORKFLOW_ACTION_SELECTORS.visitNote.validatePage.selectors.map((selector) => ({
        kind: "selector" as const,
        selector,
        description: selector,
      })),
      ...WORKFLOW_ACTION_SELECTORS.visitNote.validatePage.buttonNames.map((name) => ({
        kind: "button" as const,
        name,
        exact: true,
        description: name,
      })),
    ],
    successSelectors: WORKFLOW_ACTION_SELECTORS.visitNote.validatePage.successSelectors,
    dirtySelectors: WORKFLOW_ACTION_SELECTORS.visitNote.validatePage.dirtySelectors,
    routePatterns: WORKFLOW_ACTION_SELECTORS.visitNote.routePatterns,
  },
  {
    targetDocumentKind: "VISIT_NOTE",
    action: "LOCK_RECORD",
    candidates: [
      ...WORKFLOW_ACTION_SELECTORS.visitNote.lockRecord.selectors.map((selector) => ({
        kind: "selector" as const,
        selector,
        description: selector,
      })),
      ...WORKFLOW_ACTION_SELECTORS.visitNote.lockRecord.buttonNames.map((name) => ({
        kind: "button" as const,
        name,
        exact: true,
        description: name,
      })),
    ],
    successSelectors: WORKFLOW_ACTION_SELECTORS.visitNote.lockRecord.successSelectors,
    dirtySelectors: WORKFLOW_ACTION_SELECTORS.visitNote.lockRecord.dirtySelectors,
    routePatterns: WORKFLOW_ACTION_SELECTORS.visitNote.routePatterns,
  },
  {
    targetDocumentKind: "VISIT_NOTE",
    action: "MARK_QA_COMPLETE",
    candidates: [
      ...WORKFLOW_ACTION_SELECTORS.visitNote.markQaComplete.selectors.map((selector) => ({
        kind: "selector" as const,
        selector,
        description: selector,
      })),
      ...WORKFLOW_ACTION_SELECTORS.visitNote.markQaComplete.buttonNames.map((name) => ({
        kind: "button" as const,
        name,
        exact: true,
        description: name,
      })),
    ],
    successSelectors: WORKFLOW_ACTION_SELECTORS.visitNote.markQaComplete.successSelectors,
    dirtySelectors: WORKFLOW_ACTION_SELECTORS.visitNote.markQaComplete.dirtySelectors,
    routePatterns: WORKFLOW_ACTION_SELECTORS.visitNote.routePatterns,
  },
  {
    targetDocumentKind: "OASIS",
    action: "SAVE_PAGE",
    candidates: [
      ...WORKFLOW_ACTION_SELECTORS.oasis.savePage.selectors.map((selector) => ({
        kind: "selector" as const,
        selector,
        description: selector,
      })),
      ...WORKFLOW_ACTION_SELECTORS.oasis.savePage.buttonNames.map((name) => ({
        kind: "button" as const,
        name,
        exact: true,
        description: name,
      })),
    ],
    successSelectors: WORKFLOW_ACTION_SELECTORS.oasis.savePage.successSelectors,
    dirtySelectors: WORKFLOW_ACTION_SELECTORS.oasis.savePage.dirtySelectors,
    routePatterns: WORKFLOW_ACTION_SELECTORS.oasis.routePatterns,
  },
  {
    targetDocumentKind: "OASIS",
    action: "VALIDATE_PAGE",
    candidates: [
      ...WORKFLOW_ACTION_SELECTORS.oasis.validatePage.selectors.map((selector) => ({
        kind: "selector" as const,
        selector,
        description: selector,
      })),
      ...WORKFLOW_ACTION_SELECTORS.oasis.validatePage.buttonNames.map((name) => ({
        kind: "button" as const,
        name,
        exact: true,
        description: name,
      })),
    ],
    successSelectors: WORKFLOW_ACTION_SELECTORS.oasis.validatePage.successSelectors,
    dirtySelectors: WORKFLOW_ACTION_SELECTORS.oasis.validatePage.dirtySelectors,
    routePatterns: WORKFLOW_ACTION_SELECTORS.oasis.routePatterns,
  },
  {
    targetDocumentKind: "PLAN_OF_CARE",
    action: "SAVE_PAGE",
    candidates: [
      ...WORKFLOW_ACTION_SELECTORS.planOfCare.savePage.selectors.map((selector) => ({
        kind: "selector" as const,
        selector,
        description: selector,
      })),
      ...WORKFLOW_ACTION_SELECTORS.planOfCare.savePage.buttonNames.map((name) => ({
        kind: "button" as const,
        name,
        exact: true,
        description: name,
      })),
    ],
    successSelectors: WORKFLOW_ACTION_SELECTORS.planOfCare.savePage.successSelectors,
    dirtySelectors: WORKFLOW_ACTION_SELECTORS.planOfCare.savePage.dirtySelectors,
    routePatterns: WORKFLOW_ACTION_SELECTORS.planOfCare.routePatterns,
  },
  {
    targetDocumentKind: "PLAN_OF_CARE",
    action: "VALIDATE_PAGE",
    candidates: [
      ...WORKFLOW_ACTION_SELECTORS.planOfCare.validatePage.selectors.map((selector) => ({
        kind: "selector" as const,
        selector,
        description: selector,
      })),
      ...WORKFLOW_ACTION_SELECTORS.planOfCare.validatePage.buttonNames.map((name) => ({
        kind: "button" as const,
        name,
        exact: true,
        description: name,
      })),
    ],
    successSelectors: WORKFLOW_ACTION_SELECTORS.planOfCare.validatePage.successSelectors,
    dirtySelectors: WORKFLOW_ACTION_SELECTORS.planOfCare.validatePage.dirtySelectors,
    routePatterns: WORKFLOW_ACTION_SELECTORS.planOfCare.routePatterns,
  },
  {
    targetDocumentKind: "ADMISSION_ORDER",
    action: "SAVE_PAGE",
    candidates: [
      ...WORKFLOW_ACTION_SELECTORS.admissionOrder.savePage.selectors.map((selector) => ({
        kind: "selector" as const,
        selector,
        description: selector,
      })),
      ...WORKFLOW_ACTION_SELECTORS.admissionOrder.savePage.buttonNames.map((name) => ({
        kind: "button" as const,
        name,
        exact: true,
        description: name,
      })),
    ],
    successSelectors: WORKFLOW_ACTION_SELECTORS.admissionOrder.savePage.successSelectors,
    dirtySelectors: WORKFLOW_ACTION_SELECTORS.admissionOrder.savePage.dirtySelectors,
    routePatterns: WORKFLOW_ACTION_SELECTORS.admissionOrder.routePatterns,
  },
  {
    targetDocumentKind: "PHYSICIAN_ORDER",
    action: "SAVE_PAGE",
    candidates: [
      ...WORKFLOW_ACTION_SELECTORS.physicianOrder.savePage.selectors.map((selector) => ({
        kind: "selector" as const,
        selector,
        description: selector,
      })),
      ...WORKFLOW_ACTION_SELECTORS.physicianOrder.savePage.buttonNames.map((name) => ({
        kind: "button" as const,
        name,
        exact: true,
        description: name,
      })),
    ],
    successSelectors: WORKFLOW_ACTION_SELECTORS.physicianOrder.savePage.successSelectors,
    dirtySelectors: WORKFLOW_ACTION_SELECTORS.physicianOrder.savePage.dirtySelectors,
    routePatterns: WORKFLOW_ACTION_SELECTORS.physicianOrder.routePatterns,
  },
];

export function listWorkflowActionDefinitions(): readonly WorkflowActionSelectorDefinition[] {
  return WORKFLOW_SELECTOR_REGISTRY;
}

export function getWorkflowActionDefinition(
  targetDocumentKind: DocumentKind | null | undefined,
  action: FinalizeAction,
): WorkflowActionSelectorDefinition | null {
  if (!targetDocumentKind) {
    return null;
  }

  return WORKFLOW_SELECTOR_REGISTRY.find((entry) =>
    entry.targetDocumentKind === targetDocumentKind &&
    entry.action === action,
  ) ?? null;
}

export async function resolveWorkflowActionTarget(
  page: WorkflowPageLike,
  definition: WorkflowActionSelectorDefinition,
): Promise<{
  status: "FOUND" | "NOT_FOUND" | "AMBIGUOUS";
  selectorUsed: string | null;
  target: ResolvedWorkflowActionTarget | null;
}> {
  for (const candidate of definition.candidates) {
    const locator = candidate.kind === "selector"
      ? page.locator(candidate.selector)
      : page.getByRole("button", {
        name: candidate.name,
        exact: candidate.exact,
      });
    const visibleMatches = await collectVisibleMatches(locator);

    if (visibleMatches.length > 1) {
      return {
        status: "AMBIGUOUS",
        selectorUsed: candidate.description,
        target: null,
      };
    }

    if (visibleMatches.length === 1) {
      return {
        status: "FOUND",
        selectorUsed: candidate.description,
        target: {
          selectorUsed: candidate.description,
          locator: visibleMatches[0],
        },
      };
    }
  }

  return {
    status: "NOT_FOUND",
    selectorUsed: null,
    target: null,
  };
}

export function routeMatchesWorkflowDefinition(
  currentUrl: string,
  definition: WorkflowActionSelectorDefinition,
): boolean {
  return definition.routePatterns.some((pattern) => pattern.test(currentUrl));
}

async function collectVisibleMatches(locator: ReturnType<WorkflowPageLike["locator"]>) {
  const count = Math.min(await locator.count(), 5);
  const matches: Array<ReturnType<typeof locator.nth>> = [];

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      matches.push(candidate);
    }
  }

  return matches;
}
