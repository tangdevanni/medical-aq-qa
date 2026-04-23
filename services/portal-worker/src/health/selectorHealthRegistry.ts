import { DOCUMENT_EXTRACTION_SELECTORS } from "../portal/selectors/document-extraction.selectors";
import { type DiagnosticAction, type DiagnosticPhase, type SupportDisposition } from "../types/runtimeDiagnostics";
import { type DocumentKind } from "../types/documentKinds";
import { listWorkflowActionDefinitions } from "../workflows/workflowSelectorRegistry";
import { listTargetFieldMappings } from "../writes/fieldSelectorRegistry";

export interface SelectorHealthRegistryEntry {
  name: string;
  documentKind: DocumentKind;
  phase: DiagnosticPhase;
  expectedCardinality: "ONE" | "AT_LEAST_ONE";
  required: boolean;
  targetField: string | null;
  action: DiagnosticAction | null;
  candidates: ReadonlyArray<{
    kind: "selector" | "label" | "button";
    value: string | RegExp;
    description: string;
  }>;
  supportDisposition: SupportDisposition;
  routePatterns?: readonly RegExp[];
}

const EXTRACTION_DOCUMENT_KINDS: DocumentKind[] = [
  "VISIT_NOTE",
  "OASIS",
  "PLAN_OF_CARE",
  "ADMISSION_ORDER",
  "PHYSICIAN_ORDER",
];

const EXTRACTION_SELECTOR_HEALTH_REGISTRY: SelectorHealthRegistryEntry[] = EXTRACTION_DOCUMENT_KINDS.flatMap((documentKind) => [
  {
    name: `${documentKind}.pageTitle`,
    documentKind,
    phase: "EXTRACTION" as const,
    expectedCardinality: "AT_LEAST_ONE" as const,
    required: true,
    targetField: null,
    action: null,
    candidates: DOCUMENT_EXTRACTION_SELECTORS.pageTitleSelectors.map((selector) => ({
      kind: "selector" as const,
      value: selector,
      description: selector,
    })),
    supportDisposition: "UNKNOWN" as const,
  },
  {
    name: `${documentKind}.sectionRoots`,
    documentKind,
    phase: "EXTRACTION" as const,
    expectedCardinality: "AT_LEAST_ONE" as const,
    required: true,
    targetField: null,
    action: null,
    candidates: DOCUMENT_EXTRACTION_SELECTORS.sectionRootSelectors.map((selector) => ({
      kind: "selector" as const,
      value: selector,
      description: selector,
    })),
    supportDisposition: "UNKNOWN" as const,
  },
]);

const WRITE_SELECTOR_HEALTH_REGISTRY: SelectorHealthRegistryEntry[] = listTargetFieldMappings().map((mapping) => ({
  name: `${mapping.targetDocumentKind}.${mapping.targetField}.writeTarget`,
  documentKind: mapping.targetDocumentKind,
  phase: "WRITE_EXECUTION",
  expectedCardinality: "ONE",
  required: true,
  targetField: mapping.targetField,
  action: null,
  candidates: mapping.candidates.map((candidate) => ({
    kind: candidate.kind,
    value: candidate.kind === "selector" ? candidate.selector : candidate.label,
    description: candidate.description,
  })),
  supportDisposition: "UNKNOWN",
}));

const WORKFLOW_SELECTOR_HEALTH_REGISTRY: SelectorHealthRegistryEntry[] = listWorkflowActionDefinitions().map((definition) => ({
  name: `${definition.targetDocumentKind}.${definition.action}.workflowAction`,
  documentKind: definition.targetDocumentKind,
  phase: "WORKFLOW_EXECUTION",
  expectedCardinality: "ONE",
  required: true,
  targetField: null,
  action: definition.action,
  candidates: definition.candidates.map((candidate) => ({
    kind: candidate.kind,
    value: candidate.kind === "selector"
      ? candidate.selector
      : candidate.name,
    description: candidate.description,
  })),
  supportDisposition: "UNKNOWN",
  routePatterns: definition.routePatterns,
}));

export function listSelectorHealthRegistryEntries(): readonly SelectorHealthRegistryEntry[] {
  return [
    ...EXTRACTION_SELECTOR_HEALTH_REGISTRY,
    ...WRITE_SELECTOR_HEALTH_REGISTRY,
    ...WORKFLOW_SELECTOR_HEALTH_REGISTRY,
  ];
}

export function listSelectorHealthEntriesForDocument(input: {
  documentKind: DocumentKind;
  phase?: DiagnosticPhase;
  targetField?: string | null;
  action?: DiagnosticAction | null;
}): SelectorHealthRegistryEntry[] {
  return listSelectorHealthRegistryEntries().filter((entry) => {
    if (entry.documentKind !== input.documentKind) {
      return false;
    }

    if (input.phase && entry.phase !== input.phase) {
      return false;
    }

    if (typeof input.targetField === "string" && entry.targetField !== input.targetField) {
      return false;
    }

    if (input.action && entry.action !== input.action) {
      return false;
    }

    return true;
  });
}
