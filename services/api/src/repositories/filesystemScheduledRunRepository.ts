import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { ScheduledRunRecord } from "../types/scheduledRun";
import { scheduledRunRecordSchema } from "../types/scheduledRun";
import { readJsonFile, writeJsonFile } from "../utils/jsonFile";

function sanitizeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export class FilesystemScheduledRunRepository {
  constructor(private readonly storageRoot: string) {}

  private get scheduledRunsRoot(): string {
    return path.join(this.storageRoot, "scheduled-runs");
  }

  private getMetadataPath(scheduleId: string): string {
    return path.join(this.scheduledRunsRoot, `${sanitizeFileName(scheduleId)}.json`);
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.scheduledRunsRoot, { recursive: true });
  }

  async saveScheduledRun(schedule: ScheduledRunRecord): Promise<void> {
    await writeJsonFile(
      this.getMetadataPath(schedule.id),
      scheduledRunRecordSchema.parse(schedule),
    );
  }

  async getScheduledRun(scheduleId: string): Promise<ScheduledRunRecord | null> {
    try {
      return scheduledRunRecordSchema.parse(
        await readJsonFile<ScheduledRunRecord>(this.getMetadataPath(scheduleId)),
      );
    } catch {
      return null;
    }
  }

  async listScheduledRuns(): Promise<ScheduledRunRecord[]> {
    await this.ensureReady();
    const entries = await readdir(this.scheduledRunsRoot, { withFileTypes: true });
    const schedules = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          try {
            return scheduledRunRecordSchema.parse(
              await readJsonFile<ScheduledRunRecord>(path.join(this.scheduledRunsRoot, entry.name)),
            );
          } catch {
            return null;
          }
        }),
    );

    return schedules
      .filter((schedule): schedule is ScheduledRunRecord => schedule !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async deleteScheduledRun(scheduleId: string): Promise<void> {
    await rm(this.getMetadataPath(scheduleId), { force: true });
  }
}
