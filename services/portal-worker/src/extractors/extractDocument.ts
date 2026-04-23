import { type DocumentExtraction } from "@medical-ai-qa/shared-types";
import { type Page } from "@playwright/test";
import { type DocumentExtractorOptions } from "../types/documentExtraction";
import { detectDocumentKind } from "./detectDocumentKind";
import { extractAdmissionOrderDocument } from "./admissionOrderDocumentExtractor";
import { extractOasisDocument } from "./oasisDocumentExtractor";
import { extractPhysicianOrderDocument } from "./physicianOrderDocumentExtractor";
import { extractPlanOfCareDocument } from "./planOfCareDocumentExtractor";
import { extractVisitNoteDocument } from "./visitNoteDocumentExtractor";
import { buildDocumentMetadata, buildNormalizedDocumentResult, waitForDocumentReady } from "./shared/extractionHelpers";

export async function extractDocument(
  page: Page,
  options: DocumentExtractorOptions = {},
): Promise<DocumentExtraction> {
  await waitForDocumentReady(page);
  const detection = await detectDocumentKind(page, options);

  switch (detection.documentKind) {
    case "VISIT_NOTE":
      return extractVisitNoteDocument(page, detection, options);
    case "OASIS":
      return extractOasisDocument(page, detection, options);
    case "PLAN_OF_CARE":
      return extractPlanOfCareDocument(page, detection, options);
    case "ADMISSION_ORDER":
      return extractAdmissionOrderDocument(page, detection, options);
    case "PHYSICIAN_ORDER":
      return extractPhysicianOrderDocument(page, detection, options);
    case "UNKNOWN":
    default: {
      const warnings = [...detection.warnings];
      const metadata = await buildDocumentMetadata(page, warnings, options);
      return buildNormalizedDocumentResult({
        page,
        detection,
        metadata,
        sections: [],
        warnings,
        options,
      });
    }
  }
}
