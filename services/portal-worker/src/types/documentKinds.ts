import { type DocumentKind, type DocumentPageType } from "@medical-ai-qa/shared-types";

export type { DocumentKind, DocumentPageType };

export const READABLE_DOCUMENT_KINDS: readonly DocumentKind[] = [
  "VISIT_NOTE",
  "OASIS",
  "PLAN_OF_CARE",
  "ADMISSION_ORDER",
  "PHYSICIAN_ORDER",
] as const;

export function isReadableDocumentKind(value: DocumentKind): boolean {
  return READABLE_DOCUMENT_KINDS.includes(value);
}
