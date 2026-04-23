import { z } from "zod";

export const scheduledRunRecordSchema = z.object({
  id: z.string().min(1),
  subsidiaryId: z.string().min(1).default("default"),
  batchId: z.string().min(1),
  workbookPath: z.string().min(1),
  originalFileName: z.string().min(1),
  active: z.boolean().default(true),
  rerunEnabled: z.boolean().default(true),
  intervalHours: z.number().int().positive().default(24),
  timezone: z.string().min(1).default("Asia/Manila"),
  localTimes: z.array(z.string().min(1)).default(["15:00", "23:30"]),
  lastRunAt: z.string().min(1).nullable().default(null),
  nextScheduledRunAt: z.string().min(1).nullable().default(null),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type ScheduledRunRecord = z.infer<typeof scheduledRunRecordSchema>;
