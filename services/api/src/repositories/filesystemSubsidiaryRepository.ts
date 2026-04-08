import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import type { SubsidiaryRecord } from "@medical-ai-qa/shared-types";
import { subsidiaryRecordSchema } from "../../../../packages/shared-types/src/subsidiary";
import { readJsonFile, writeJsonFile } from "../utils/jsonFile";

function sanitizeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export class FilesystemSubsidiaryRepository {
  constructor(private readonly storageRoot: string) {}

  private get subsidiariesRoot(): string {
    return path.join(this.storageRoot, "subsidiaries");
  }

  private getMetadataPath(subsidiaryId: string): string {
    return path.join(this.subsidiariesRoot, `${sanitizeFileName(subsidiaryId)}.json`);
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.subsidiariesRoot, { recursive: true });
  }

  async saveSubsidiary(subsidiary: SubsidiaryRecord): Promise<void> {
    await writeJsonFile(
      this.getMetadataPath(subsidiary.id),
      subsidiaryRecordSchema.parse(subsidiary),
    );
  }

  async getSubsidiary(subsidiaryId: string): Promise<SubsidiaryRecord | null> {
    try {
      return subsidiaryRecordSchema.parse(
        await readJsonFile<SubsidiaryRecord>(this.getMetadataPath(subsidiaryId)),
      );
    } catch {
      return null;
    }
  }

  async listSubsidiaries(): Promise<SubsidiaryRecord[]> {
    await this.ensureReady();
    const entries = await readdir(this.subsidiariesRoot, { withFileTypes: true });
    const subsidiaries = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          try {
            return subsidiaryRecordSchema.parse(
              await readJsonFile<SubsidiaryRecord>(path.join(this.subsidiariesRoot, entry.name)),
            );
          } catch {
            return null;
          }
        }),
    );

    return subsidiaries
      .filter((subsidiary): subsidiary is SubsidiaryRecord => subsidiary !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
  }
}
