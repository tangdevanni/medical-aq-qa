import { DOCUMENT_EXTRACTION_SELECTORS } from "../portal/selectors/document-extraction.selectors";
import { type DiagnosticSeverity, type SelectorHealthStatus } from "../types/runtimeDiagnostics";
import { type DocumentKind } from "../types/documentKinds";
import { type WorkflowActionSelectorDefinition, type WorkflowLocatorLike } from "../types/workflowSteps";
import { type WriteLocatorLike } from "../types/writeTargets";

export async function countVisibleMatches(
  locatorFactory: () => WorkflowLocatorLike | WriteLocatorLike,
): Promise<number> {
  const locator = locatorFactory();
  const count = Math.min(await locator.count().catch(() => 0), 5);
  let visibleMatches = 0;

  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) {
      visibleMatches += 1;
    }
  }

  return visibleMatches;
}

export function deriveSelectorHealthStatus(input: {
  matchedCount: number;
  required: boolean;
}): SelectorHealthStatus {
  if (input.matchedCount > 1) {
    return "AMBIGUOUS";
  }

  if (input.matchedCount === 1) {
    return "HEALTHY";
  }

  return input.required ? "MISSING" : "DEGRADED";
}

export function severityForSelectorHealthStatus(status: SelectorHealthStatus): DiagnosticSeverity {
  switch (status) {
    case "HEALTHY":
      return "INFO";
    case "DEGRADED":
    case "UNSUPPORTED":
      return "WARNING";
    case "MISSING":
    case "AMBIGUOUS":
      return "ERROR";
  }
}

export function expectedDocumentRoutePatterns(documentKind: DocumentKind): readonly RegExp[] {
  switch (documentKind) {
    case "VISIT_NOTE":
      return [DOCUMENT_EXTRACTION_SELECTORS.visitNoteUrlPattern];
    case "OASIS":
      return [DOCUMENT_EXTRACTION_SELECTORS.oasisUrlPattern];
    case "PLAN_OF_CARE":
      return [DOCUMENT_EXTRACTION_SELECTORS.planOfCareUrlPattern];
    case "ADMISSION_ORDER":
      return [DOCUMENT_EXTRACTION_SELECTORS.admissionOrderUrlPattern];
    case "PHYSICIAN_ORDER":
      return [DOCUMENT_EXTRACTION_SELECTORS.physicianOrderUrlPattern];
    case "UNKNOWN":
    default:
      return [];
  }
}

export function routeMatchesExpectedDocumentKind(url: string, documentKind: DocumentKind): boolean {
  const patterns = expectedDocumentRoutePatterns(documentKind);
  return patterns.length === 0 || patterns.some((pattern) => pattern.test(url));
}

export function routeMatchesWorkflowDefinition(
  url: string,
  definition: WorkflowActionSelectorDefinition | null,
): boolean {
  return !definition || definition.routePatterns.some((pattern) => pattern.test(url));
}
