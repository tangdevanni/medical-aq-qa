import { z } from "zod";

export const workflowDomainSchema = z.enum(["coding", "qa"]);

export type WorkflowDomain = z.infer<typeof workflowDomainSchema>;

export const workflowRunStatusSchema = z.enum([
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLETED",
  "BLOCKED",
  "FAILED",
  "PLACEHOLDER",
]);

export type WorkflowRunStatus = z.infer<typeof workflowRunStatusSchema>;

export const patientWorkflowRunSchema = z.object({
  workflowRunId: z.string().min(1),
  workflowDomain: workflowDomainSchema,
  status: workflowRunStatusSchema,
  stepName: z.string().min(1),
  message: z.string().min(1).nullable().optional(),
  chartUrl: z.string().min(1).nullable().optional(),
  startedAt: z.string().min(1).nullable(),
  completedAt: z.string().min(1).nullable(),
  lastUpdatedAt: z.string().min(1),
  workflowResultPath: z.string().min(1).nullable().optional(),
  workflowLogPath: z.string().min(1).nullable().optional(),
});

export type PatientWorkflowRun = z.infer<typeof patientWorkflowRunSchema>;
