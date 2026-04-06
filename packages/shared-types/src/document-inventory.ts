import { z } from "zod";

export const documentInventoryNormalizedTypeSchema = z.enum([
  "OASIS",
  "POC",
  "VISIT_NOTE",
  "ORDER",
  "COMMUNICATION",
  "SUMMARY_30",
  "SUMMARY_60",
  "DC_SUMMARY",
  "SUPERVISORY",
  "MISSED_VISIT",
  "INFECTION_REPORT",
  "FALL_REPORT",
  "OTHER",
]);

export type DocumentInventoryNormalizedType = z.infer<typeof documentInventoryNormalizedTypeSchema>;

export const documentInventoryDisciplineSchema = z.enum([
  "SN",
  "PT",
  "OT",
  "ST",
  "HHA",
  "RD",
  "MSW",
  "UNKNOWN",
]);

export type DocumentInventoryDiscipline = z.infer<typeof documentInventoryDisciplineSchema>;

export const documentOpenBehaviorSchema = z.enum([
  "SAME_PAGE",
  "NEW_TAB",
  "MODAL",
  "DOWNLOAD",
  "NONE",
  "UNKNOWN",
]);

export type DocumentOpenBehavior = z.infer<typeof documentOpenBehaviorSchema>;

export const documentInventoryItemSchema = z.object({
  sourceLabel: z.string().min(1),
  normalizedType: documentInventoryNormalizedTypeSchema,
  discipline: documentInventoryDisciplineSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1)),
  sourceUrl: z.string().min(1).nullable().optional(),
  sourcePath: z.string().min(1).nullable().optional(),
  discoveredAt: z.string().min(1).nullable().optional(),
  openBehavior: documentOpenBehaviorSchema.default("UNKNOWN"),
});

export type DocumentInventoryItem = z.infer<typeof documentInventoryItemSchema>;
