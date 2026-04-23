import { z } from "zod";

export const automationStepLogSchema = z.object({
  timestamp: z.string().min(1),
  step: z.string().min(1),
  message: z.string().min(1),
  patientName: z.string().min(1).nullable(),
  urlBefore: z.string().min(1).nullable(),
  urlAfter: z.string().min(1).nullable(),
  selectorUsed: z.string().min(1).nullable(),
  found: z.array(z.string().min(1)),
  missing: z.array(z.string().min(1)),
  openedDocumentLabel: z.string().min(1).nullable(),
  openedDocumentUrl: z.string().min(1).nullable(),
  evidence: z.array(z.string().min(1)),
  retryCount: z.number().int().nonnegative(),
  safeReadConfirmed: z.boolean(),
});

export type AutomationStepLog = z.infer<typeof automationStepLogSchema>;
