import { z } from "zod";

export const portalDomSourceAreaSchema = z.enum(["oasis", "visit_notes"]);
export type PortalDomSourceArea = z.infer<typeof portalDomSourceAreaSchema>;

export const portalDomSourceKindSchema = z.enum([
  "input",
  "textarea",
  "select",
  "ngSelect",
  "radio",
  "checkbox",
  "table",
  "visibleText",
  "unknown",
]);
export type PortalDomSourceKind = z.infer<typeof portalDomSourceKindSchema>;

export const portalDomExtractionConfidenceSchema = z.enum(["high", "medium", "low"]);
export type PortalDomExtractionConfidence = z.infer<typeof portalDomExtractionConfidenceSchema>;

export const portalDomExtractedFieldSchema = z.object({
  section: z.string().min(1).optional(),
  itemCode: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  key: z.string().min(1).optional(),
  inputType: z.string().min(1).optional(),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  checked: z.boolean().optional(),
  selectedText: z.string().min(1).optional(),
  selectedValue: z.string().min(1).optional(),
  sourceKind: portalDomSourceKindSchema,
  confidence: portalDomExtractionConfidenceSchema,
  evidenceText: z.string().min(1).optional(),
});
export type PortalDomExtractedField = z.infer<typeof portalDomExtractedFieldSchema>;

export const portalDomExtractedTableSchema = z.object({
  section: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
});
export type PortalDomExtractedTable = z.infer<typeof portalDomExtractedTableSchema>;

export const portalDomSectionStatusSchema = z.enum([
  "success",
  "degraded",
  "failed",
  "skipped_duplicate",
  "skipped_deferred",
]);
export type PortalDomSectionStatus = z.infer<typeof portalDomSectionStatusSchema>;

export const portalDomExtractedSectionSchema = z.object({
  title: z.string(),
  status: portalDomSectionStatusSchema.optional(),
  fields: z.array(portalDomExtractedFieldSchema),
  tables: z.array(portalDomExtractedTableSchema),
  visibleTextDigest: z.string().optional(),
  fallbackReasons: z.array(z.string()).optional(),
});
export type PortalDomExtractedSection = z.infer<typeof portalDomExtractedSectionSchema>;

export const portalDomExtractedStateSchema = z.object({
  artifactType: z.literal("portal_dom_extracted_state"),
  sourceArea: portalDomSourceAreaSchema,
  extractionVersion: z.string().min(1),
  extractedAt: z.string().min(1),
  sections: z.array(portalDomExtractedSectionSchema),
  coverage: z.object({
    sectionCount: z.number().int().nonnegative(),
    fieldCount: z.number().int().nonnegative(),
    nonEmptyFieldCount: z.number().int().nonnegative(),
    tableCount: z.number().int().nonnegative(),
    confidence: portalDomExtractionConfidenceSchema,
    fallbackRecommended: z.boolean(),
    fallbackReasons: z.array(z.string()),
  }),
  diagnostics: z.object({
    inputSource: z.enum([
      "dom_state_primary",
      "dom_state_plus_raw_fallback",
      "ocr_text_fallback",
      "pdf_capture_fallback",
      "insufficient_evidence",
    ]),
    ocrUsed: z.boolean(),
    pdfCaptureUsed: z.boolean(),
    routePattern: z.string().min(1).optional(),
    sectionOptionLabels: z.array(z.string()).optional(),
    skippedDeferredSections: z.array(z.string()).optional(),
  }),
  contentHash: z.string().min(1),
  textDigest: z.string(),
});
export type PortalDomExtractedState = z.infer<typeof portalDomExtractedStateSchema>;

export const oasisDomAcquisitionStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "ready_for_qa",
  "qa_completed",
  "qa_stale_due_to_oasis_change",
  "blocked_dom_extraction_failed",
  "fallback_to_ocr_required",
  "insufficient_evidence",
]);
export type OasisDomAcquisitionStatus = z.infer<typeof oasisDomAcquisitionStatusSchema>;

export const oasisDomAcquisitionFieldStatusSchema = z.enum([
  "filled",
  "empty",
  "not_applicable",
  "missing",
  "ambiguous",
  "changed",
  "regressed",
]);
export type OasisDomAcquisitionFieldStatus = z.infer<typeof oasisDomAcquisitionFieldStatusSchema>;

export const oasisDomAcquisitionSectionStatusSchema = z.enum([
  "captured",
  "not_seen_this_run",
  "deferred",
  "degraded",
  "failed",
]);
export type OasisDomAcquisitionSectionStatus = z.infer<typeof oasisDomAcquisitionSectionStatusSchema>;

export const oasisDomReadinessReasonSchema = z.enum([
  "ready_for_qa",
  "pending_missing_required_sections",
  "pending_low_field_coverage",
  "pending_low_nonempty_coverage",
  "pending_failed_high_priority_sections",
  "pending_document_not_complete",
  "blocked_extraction_failed",
  "fallback_to_ocr_required",
]);
export type OasisDomReadinessReason = z.infer<typeof oasisDomReadinessReasonSchema>;

export const oasisDomAcquisitionFieldSchema = z.object({
  sectionKey: z.string().min(1),
  fieldKey: z.string().min(1),
  oasisItemCode: z.string().min(1).optional(),
  label: z.string().optional(),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  normalizedValue: z.string(),
  status: oasisDomAcquisitionFieldStatusSchema,
  firstSeenAt: z.string().min(1),
  lastSeenAt: z.string().min(1),
  lastChangedAt: z.string().min(1),
  sourceKind: portalDomSourceKindSchema,
  confidence: portalDomExtractionConfidenceSchema,
  contentHash: z.string().min(1),
  seenInLatestScrape: z.boolean().optional(),
});
export type OasisDomAcquisitionField = z.infer<typeof oasisDomAcquisitionFieldSchema>;

export const oasisDomAcquisitionSectionSchema = z.object({
  sectionKey: z.string().min(1),
  title: z.string(),
  status: oasisDomAcquisitionSectionStatusSchema,
  firstSeenAt: z.string().min(1),
  lastSeenAt: z.string().min(1),
  fieldCount: z.number().int().nonnegative(),
  nonEmptyFieldCount: z.number().int().nonnegative(),
  itemCodeCount: z.number().int().nonnegative(),
  fields: z.array(oasisDomAcquisitionFieldSchema),
  fallbackReasons: z.array(z.string()).optional(),
});
export type OasisDomAcquisitionSection = z.infer<typeof oasisDomAcquisitionSectionSchema>;

export const oasisDomAcquisitionStateSchema = z.object({
  artifactType: z.literal("oasis_dom_acquisition_state"),
  patientRunId: z.string().min(1).optional(),
  patientId: z.string().min(1).optional(),
  oasisDocumentId: z.string().min(1).optional(),
  sourceKey: z.string().min(1).optional(),
  firstSeenAt: z.string().min(1),
  lastScrapedAt: z.string().min(1),
  lastCompletedAt: z.string().min(1).optional(),
  acquisitionStatus: oasisDomAcquisitionStatusSchema,
  overallContentHash: z.string().min(1),
  lastQaInputHash: z.string().min(1).optional(),
  sections: z.array(oasisDomAcquisitionSectionSchema),
  missingRequiredSections: z.array(z.string()),
  missingRequiredFields: z.array(z.string()),
  changedFields: z.array(z.string()),
  regressedFields: z.array(z.string()),
  readinessReasons: z.array(oasisDomReadinessReasonSchema),
  fallbackReasons: z.array(z.string()),
});
export type OasisDomAcquisitionState = z.infer<typeof oasisDomAcquisitionStateSchema>;
