import { z } from "zod";

export const qaChecklistStatusSchema = z.enum([
  "PASS",
  "FAIL",
  "MISSING",
  "NEEDS_REVIEW",
  "NOT_APPLICABLE",
]);

export type QaChecklistStatus = z.infer<typeof qaChecklistStatusSchema>;

export const oasisQaSectionKeySchema = z.enum([
  "timing",
  "coding",
  "oasis",
  "poc",
  "visit_notes",
  "technical_review",
  "final_check",
]);

export type OasisQaSectionKey = z.infer<typeof oasisQaSectionKeySchema>;

export const oasisQaSectionStatusSchema = z.enum([
  "PASS",
  "FAIL",
  "MISSING",
  "NEEDS_REVIEW",
]);

export type OasisQaSectionStatus = z.infer<typeof oasisQaSectionStatusSchema>;

export const oasisQaOverallStatusSchema = z.enum([
  "READY_FOR_BILLING",
  "NEEDS_QA",
  "BLOCKED",
  "IN_PROGRESS",
]);

export type OasisQaOverallStatus = z.infer<typeof oasisQaOverallStatusSchema>;

export const oasisQaUrgencySchema = z.enum([
  "OVERDUE",
  "DUE_SOON",
  "ON_TRACK",
]);

export type OasisQaUrgency = z.infer<typeof oasisQaUrgencySchema>;

export const qaChecklistItemSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  status: qaChecklistStatusSchema,
  notes: z.string().min(1).nullable(),
  evidence: z.array(z.string().min(1)),
});

export type QaChecklistItem = z.infer<typeof qaChecklistItemSchema>;

export const oasisQaSectionSchema = z.object({
  key: oasisQaSectionKeySchema,
  label: z.string().min(1),
  status: oasisQaSectionStatusSchema,
  items: z.array(qaChecklistItemSchema),
});

export type OasisQaSection = z.infer<typeof oasisQaSectionSchema>;

export const oasisQaSummarySchema = z.object({
  overallStatus: oasisQaOverallStatusSchema,
  urgency: oasisQaUrgencySchema,
  daysInPeriod: z.number().int().nullable(),
  daysLeft: z.number().int().nullable(),
  sections: z.array(oasisQaSectionSchema),
  blockers: z.array(z.string().min(1)),
});

export type OasisQaSummary = z.infer<typeof oasisQaSummarySchema>;

export const emptyOasisQaSummary: OasisQaSummary = {
  overallStatus: "IN_PROGRESS",
  urgency: "ON_TRACK",
  daysInPeriod: null,
  daysLeft: null,
  sections: [],
  blockers: [],
};
