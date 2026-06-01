import { z } from "zod";

export const conciseQaIssueDomainSchema = z.enum(["oasis", "visit_notes", "referral"]);

export type ConciseQaIssueDomain = z.infer<typeof conciseQaIssueDomainSchema>;

export const conciseQaIssueSeveritySchema = z.enum(["critical", "high", "medium", "low"]);

export type ConciseQaIssueSeverity = z.infer<typeof conciseQaIssueSeveritySchema>;

export const conciseQaIssueSchema = z.object({
  issueId: z.string().min(1),
  domain: conciseQaIssueDomainSchema,
  section: z.string().min(1),
  itemId: z.string().min(1).nullable().default(null),
  severity: conciseQaIssueSeveritySchema,
  problemSummary: z.string().min(1),
  recommendedFix: z.string().min(1),
  evidenceSnippet: z.string().min(1).nullable().default(null),
  source: z.string().min(1),
});

export type ConciseQaIssue = z.infer<typeof conciseQaIssueSchema>;

