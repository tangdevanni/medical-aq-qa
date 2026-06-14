import { createHash } from "node:crypto";
import { access, copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  IdentityConfidence,
  PatientEpisodeWorkItem,
  PatientMatchResult,
  PatientMemoryCurrentMetadata,
  PatientMemoryIndex,
  PatientMemoryRecord,
  PatientRunDeltaPlan,
} from "@medical-ai-qa/shared-types";
import {
  patientMemoryIndexSchema,
  patientMemoryRecordSchema,
  patientRunDeltaPlanSchema,
} from "@medical-ai-qa/shared-types";
import { readJsonFile, writeJsonFile } from "../utils/jsonFile";
import { buildWorkItemFingerprint } from "../utils/workItemFingerprint";

const PATIENT_MEMORY_INDEX_FILE_NAME = "patient-memory-index.json";
const PATIENT_MEMORY_RECORD_FILE_NAME = "patient-memory-record.json";
const PATIENT_RUN_DELTA_PLAN_FILE_NAME = "patient-run-delta-plan.json";
const PATIENT_MEMORY_SEED_PLAN_FILE_NAME = "patient-memory-seed-plan.json";
const WORK_ITEM_FINGERPRINT_FILE_NAME = "work-item-fingerprint.json";

const DEFAULT_CURRENT_ARTIFACTS = [
  WORK_ITEM_FINGERPRINT_FILE_NAME,
  "patient-dashboard-state.json",
  "coding-input.json",
  "document-text.json",
  "document-fact-pack.json",
  "qa-prefetch-result.json",
  path.join("referral-document-processing", "patient-qa-reference.json"),
  path.join("referral-document-processing", "qa-document-summary.json"),
  path.join("referral-document-processing", "field-map-snapshot.json"),
  path.join("referral-document-processing", "extracted-facts.json"),
  "printed-note-chart-values.json",
  "oasis-printed-note-review.json",
  "oasis-dom-extracted-state.json",
  "oasis-dom-acquisition-state.json",
  "oasis-dom-vs-existing-extraction-comparison.json",
  "oasis-dom-section-processing-manifest.json",
  "oasis-dom-section-outputs.json",
  "oasis-assessment-processing-manifest.json",
  "oasis-mgg-field-snapshot.json",
  "canonical-oasis-document.json",
  "canonical-oasis-section-index.json",
  "canonical-oasis-section-hashes.json",
  "canonical-oasis-structured.json",
  "source-clinical-fact-pack.json",
  "oasis-clinical-fact-pack.json",
  "clinical-fact-pack-manifest.json",
  "clinical-contradiction-analysis.json",
  "plan-of-care-review-draft.json",
  "plan-of-care-review-summary.json",
  "generated-plan-of-care.json",
  "visit-notes-discovery.json",
  "visit-note-processing-manifest.json",
  "visit-note-fact-pack.json",
  "visit-note-qa-review.json",
  "patient-run-cache-summary.json",
] as const;

export class AmbiguousPatientMemoryIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbiguousPatientMemoryIdentityError";
  }
}

export type PatientMemoryResolution = {
  patientMemoryId: string;
  record: PatientMemoryRecord;
  index: PatientMemoryIndex;
  created: boolean;
  identityConfidence: IdentityConfidence;
};

export type ResolvePatientMemoryInput = {
  agencySlug: string;
  workItem: PatientEpisodeWorkItem;
  matchResult?: PatientMatchResult | null;
  now?: Date;
};

export type PromotePatientMemoryInput = {
  agencySlug: string;
  patientMemoryId: string;
  sourcePatientArtifactsDirectory: string;
  workItem?: PatientEpisodeWorkItem | null;
  matchResult?: PatientMatchResult | null;
  batchId?: string | null;
  runId?: string | null;
  artifactRelativePaths?: string[];
  now?: Date;
};

export type SeedPatientMemoryInput = {
  agencySlug: string;
  patientMemoryId: string;
  targetPatientArtifactsDirectory: string;
  artifactRelativePaths?: string[];
  overwrite?: boolean;
  now?: Date;
};

type IdentityResolution = {
  confidence: IdentityConfidence;
  identityKeys: string[];
  displayName: string;
  normalizedName: string;
  medicareNumber: string | null;
  socDate: string | null;
  portalPatientId: string | null;
  portalDisplayName: string | null;
};

function normalizeAgencySlug(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Agency slug is required for patient memory.");
  }
  return normalized.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function normalizeIdentityText(value: string | null | undefined): string | null {
  const normalized = (value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  return normalized || null;
}

function normalizeMedicareNumber(value: string | null | undefined): string | null {
  const normalized = (value ?? "").replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
  return normalized || null;
}

function hashIdentity(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function createPatientMemoryId(agencySlug: string, identityKeys: string[]): string {
  return `pm-${hashIdentity(`${agencySlug}:${identityKeys[0] ?? "unknown"}`)}`;
}

function isoTimestamp(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function createEmptyIndex(agencySlug: string, generatedAt: string): PatientMemoryIndex {
  return {
    schemaVersion: "patient-memory-index.v1",
    agencySlug,
    generatedAt,
    records: {},
    identityAliases: {},
  };
}

function ensureRelativeArtifactPath(relativePath: string): string {
  const normalized = path.normalize(relativePath);
  if (
    path.isAbsolute(normalized) ||
    normalized === "." ||
    normalized.startsWith(`..${path.sep}`) ||
    normalized === ".."
  ) {
    throw new Error(`Invalid patient memory artifact path: ${relativePath}`);
  }
  return normalized;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveIdentity(input: ResolvePatientMemoryInput | PromotePatientMemoryInput): IdentityResolution {
  const workItem = input.workItem;
  if (!workItem) {
    throw new Error("Work item is required to resolve patient memory identity.");
  }

  if (input.matchResult?.status === "AMBIGUOUS") {
    throw new AmbiguousPatientMemoryIdentityError(
      `Ambiguous portal identity match for ${workItem.patientIdentity.displayName}.`,
    );
  }

  const displayName = workItem.patientIdentity.displayName.trim();
  const normalizedName =
    normalizeIdentityText(workItem.patientIdentity.normalizedName) ??
    normalizeIdentityText(displayName) ??
    displayName.toUpperCase();
  const medicareNumber = normalizeMedicareNumber(workItem.patientIdentity.medicareNumber);
  const socDate = workItem.episodeContext.socDate?.trim() || null;
  const portalPatientId =
    input.matchResult?.status === "EXACT" && input.matchResult.portalPatientId
      ? input.matchResult.portalPatientId.trim()
      : null;
  const portalDisplayName =
    input.matchResult?.status === "EXACT" && input.matchResult.portalDisplayName
      ? input.matchResult.portalDisplayName.trim()
      : null;

  const primaryIdentityKeys = [
    portalPatientId ? `portal:${portalPatientId.toLowerCase()}` : null,
    medicareNumber ? `medicare:${medicareNumber}` : null,
    socDate ? `name-soc:${normalizedName}:${socDate}` : null,
  ].filter((value): value is string => value !== null);
  const identityKeys =
    primaryIdentityKeys.length > 0 ? primaryIdentityKeys : [`name-review:${normalizedName}`];

  const confidence: IdentityConfidence = portalPatientId
    ? "portal_id"
    : medicareNumber
      ? "mr_number"
      : socDate
        ? "name_soc"
        : "name_only_review";

  return {
    confidence,
    identityKeys,
    displayName,
    normalizedName,
    medicareNumber,
    socDate,
    portalPatientId,
    portalDisplayName,
  };
}

function findAliasedPatientMemoryIds(
  index: PatientMemoryIndex,
  identityKeys: string[],
): string[] {
  return Array.from(
    new Set(
      identityKeys
        .map((identityKey) => index.identityAliases[identityKey])
        .filter((patientMemoryId): patientMemoryId is string => Boolean(patientMemoryId)),
    ),
  );
}

export class PatientMemoryService {
  constructor(private readonly storageRoot: string) {}

  private agencyRoot(agencySlug: string): string {
    return path.join(this.storageRoot, "agencies", normalizeAgencySlug(agencySlug));
  }

  private indexPath(agencySlug: string): string {
    return path.join(this.agencyRoot(agencySlug), PATIENT_MEMORY_INDEX_FILE_NAME);
  }

  private patientRoot(agencySlug: string, patientMemoryId: string): string {
    return path.join(this.agencyRoot(agencySlug), "patients", patientMemoryId);
  }

  private currentRoot(agencySlug: string, patientMemoryId: string): string {
    return path.join(this.patientRoot(agencySlug, patientMemoryId), "current");
  }

  private recordPath(agencySlug: string, patientMemoryId: string): string {
    return path.join(this.patientRoot(agencySlug, patientMemoryId), PATIENT_MEMORY_RECORD_FILE_NAME);
  }

  async ensureReady(): Promise<void> {
    await mkdir(path.join(this.storageRoot, "agencies"), { recursive: true });
  }

  async writeMigrationSummary(
    agencySlugInput: string,
    migrationId: string,
    summary: unknown,
  ): Promise<string> {
    const agencySlug = normalizeAgencySlug(agencySlugInput);
    const summaryPath = path.join(
      this.agencyRoot(agencySlug),
      "patient-memory-migrations",
      `${safeTimestamp(migrationId)}.json`,
    );
    await writeJsonFile(summaryPath, summary);
    return summaryPath;
  }

  async readIndex(agencySlugInput: string): Promise<PatientMemoryIndex> {
    const agencySlug = normalizeAgencySlug(agencySlugInput);
    const filePath = this.indexPath(agencySlug);
    if (!(await fileExists(filePath))) {
      return createEmptyIndex(agencySlug, isoTimestamp());
    }

    try {
      return patientMemoryIndexSchema.parse(await readJsonFile<PatientMemoryIndex>(filePath));
    } catch {
      const quarantinedPath = `${filePath}.corrupt-${safeTimestamp(isoTimestamp())}`;
      try {
        await copyFile(filePath, quarantinedPath);
      } catch {
        // Best effort only. Returning an empty index lets the run proceed cleanly.
      }
      return createEmptyIndex(agencySlug, isoTimestamp());
    }
  }

  async writeIndex(index: PatientMemoryIndex): Promise<PatientMemoryIndex> {
    const parsed = patientMemoryIndexSchema.parse(index);
    await writeJsonFile(this.indexPath(parsed.agencySlug), parsed);
    await Promise.all(
      Object.values(parsed.records).map((record) =>
        writeJsonFile(this.recordPath(parsed.agencySlug, record.patientMemoryId), patientMemoryRecordSchema.parse(record)),
      ),
    );
    return parsed;
  }

  async resolvePatientMemory(input: ResolvePatientMemoryInput): Promise<PatientMemoryResolution> {
    const agencySlug = normalizeAgencySlug(input.agencySlug);
    const resolvedAt = isoTimestamp(input.now);
    const identity = resolveIdentity({ ...input, agencySlug });
    const index = await this.readIndex(agencySlug);
    const matchingPatientMemoryIds = findAliasedPatientMemoryIds(index, identity.identityKeys);

    if (matchingPatientMemoryIds.length > 1) {
      throw new AmbiguousPatientMemoryIdentityError(
        `Identity keys for ${identity.displayName} map to multiple patient memory records.`,
      );
    }

    const patientMemoryId =
      matchingPatientMemoryIds[0] ?? createPatientMemoryId(agencySlug, identity.identityKeys);
    const existing = index.records[patientMemoryId] ?? null;
    const record: PatientMemoryRecord = {
      schemaVersion: "patient-memory-record.v1",
      agencySlug,
      patientMemoryId,
      createdAt: existing?.createdAt ?? resolvedAt,
      updatedAt: resolvedAt,
      identity: {
        displayName: identity.displayName,
        normalizedName: identity.normalizedName,
        medicareNumber: identity.medicareNumber,
        portalPatientId: identity.portalPatientId ?? existing?.identity.portalPatientId ?? null,
        portalDisplayName: identity.portalDisplayName ?? existing?.identity.portalDisplayName ?? null,
        identityConfidence: identity.confidence,
        identityKeys: Array.from(new Set([...(existing?.identity.identityKeys ?? []), ...identity.identityKeys])),
        lastResolvedAt: resolvedAt,
        lastMatchResult: input.matchResult ?? null,
      },
      current: existing?.current ?? null,
      history: existing?.history ?? [],
    };

    index.records[patientMemoryId] = patientMemoryRecordSchema.parse(record);
    for (const identityKey of record.identity.identityKeys) {
      const aliasedPatientMemoryId = index.identityAliases[identityKey];
      if (aliasedPatientMemoryId && aliasedPatientMemoryId !== patientMemoryId) {
        throw new AmbiguousPatientMemoryIdentityError(
          `Identity key ${identityKey} already belongs to another patient memory record.`,
        );
      }
      index.identityAliases[identityKey] = patientMemoryId;
    }
    index.generatedAt = resolvedAt;

    return {
      patientMemoryId,
      record: index.records[patientMemoryId],
      index: await this.writeIndex(index),
      created: !existing,
      identityConfidence: identity.confidence,
    };
  }

  async promoteCurrentArtifacts(input: PromotePatientMemoryInput): Promise<PatientRunDeltaPlan> {
    const agencySlug = normalizeAgencySlug(input.agencySlug);
    const promotedAt = isoTimestamp(input.now);
    const index = await this.readIndex(agencySlug);
    const existing = index.records[input.patientMemoryId];

    if (!existing) {
      throw new Error(`Patient memory record not found: ${input.patientMemoryId}`);
    }

    if (input.matchResult?.status === "AMBIGUOUS") {
      throw new AmbiguousPatientMemoryIdentityError(
        `Ambiguous portal identity match for patient memory ${input.patientMemoryId}.`,
      );
    }

    const currentDirectory = this.currentRoot(agencySlug, input.patientMemoryId);
    const relativePaths = (input.artifactRelativePaths ?? [...DEFAULT_CURRENT_ARTIFACTS])
      .map(ensureRelativeArtifactPath);
    const snapshotPath = await this.writeHistorySnapshot({
      agencySlug,
      patientMemoryId: input.patientMemoryId,
      current: existing.current,
      createdAt: promotedAt,
      reason: "promote_current_artifacts",
      batchId: input.batchId ?? null,
      runId: input.runId ?? null,
      workItemId: input.workItem?.id ?? existing.current?.workItemId ?? null,
    });

    const artifacts: PatientMemoryCurrentMetadata["artifacts"] = {};
    const actions: PatientRunDeltaPlan["actions"] = [];

    for (const relativePath of relativePaths) {
      const sourcePath = path.join(input.sourcePatientArtifactsDirectory, relativePath);
      const targetPath = path.join(currentDirectory, relativePath);
      if (!(await fileExists(sourcePath))) {
        actions.push({
          name: path.basename(relativePath),
          relativePath,
          sourcePath,
          targetPath,
          action: "promote",
          copied: false,
          reason: "source_missing",
        });
        continue;
      }

      await mkdir(path.dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
      const fileStat = await stat(targetPath);
      artifacts[relativePath] = {
        name: path.basename(relativePath),
        relativePath,
        currentPath: targetPath,
        sourcePath,
        sizeBytes: fileStat.size,
        promotedAt,
      };
      actions.push({
        name: path.basename(relativePath),
        relativePath,
        sourcePath,
        targetPath,
        action: "promote",
        copied: true,
        reason: null,
      });
    }

    const workItemFingerprint = input.workItem ? buildWorkItemFingerprint(input.workItem) : existing.current?.workItemFingerprint ?? null;
    const nextRecord: PatientMemoryRecord = {
      ...existing,
      updatedAt: promotedAt,
      identity: input.workItem
        ? (() => {
            const promotedIdentity = resolveIdentity({ ...input, agencySlug, workItem: input.workItem });
            return {
              displayName: promotedIdentity.displayName,
              normalizedName: promotedIdentity.normalizedName,
              medicareNumber: promotedIdentity.medicareNumber,
              portalPatientId: promotedIdentity.portalPatientId ?? existing.identity.portalPatientId,
              portalDisplayName: promotedIdentity.portalDisplayName ?? existing.identity.portalDisplayName,
              identityConfidence: promotedIdentity.confidence,
              identityKeys: Array.from(
                new Set([...existing.identity.identityKeys, ...promotedIdentity.identityKeys]),
              ),
              lastResolvedAt: promotedAt,
              lastMatchResult: input.matchResult ?? existing.identity.lastMatchResult,
            };
          })()
        : existing.identity,
      current: {
        updatedAt: promotedAt,
        batchId: input.batchId ?? null,
        runId: input.runId ?? null,
        workItemId: input.workItem?.id ?? null,
        sourcePatientArtifactsDirectory: input.sourcePatientArtifactsDirectory,
        workItemFingerprint,
        artifacts,
      },
      history: [
        ...existing.history,
        {
          snapshotId: path.basename(path.dirname(snapshotPath)),
          createdAt: promotedAt,
          reason: "promote_current_artifacts",
          batchId: input.batchId ?? null,
          runId: input.runId ?? null,
          workItemId: input.workItem?.id ?? null,
          snapshotPath,
          artifactNames: Object.keys(artifacts),
        },
      ],
    };

    index.records[input.patientMemoryId] = patientMemoryRecordSchema.parse(nextRecord);
    for (const identityKey of index.records[input.patientMemoryId].identity.identityKeys) {
      index.identityAliases[identityKey] = input.patientMemoryId;
    }
    index.generatedAt = promotedAt;
    await this.writeIndex(index);

    const plan = patientRunDeltaPlanSchema.parse({
      schemaVersion: "patient-run-delta-plan.v1",
      agencySlug,
      patientMemoryId: input.patientMemoryId,
      workItem: input.workItem ?? null,
      identityConfidence: index.records[input.patientMemoryId].identity.identityConfidence,
      workItemFingerprint,
      createdAt: promotedAt,
      sourcePatientArtifactsDirectory: input.sourcePatientArtifactsDirectory,
      targetPatientArtifactsDirectory: null,
      currentDirectory,
      historySnapshotPath: snapshotPath,
      actions,
    });
    await writeJsonFile(path.join(currentDirectory, PATIENT_RUN_DELTA_PLAN_FILE_NAME), plan);
    return plan;
  }

  async seedPatientArtifacts(input: SeedPatientMemoryInput): Promise<PatientRunDeltaPlan> {
    const agencySlug = normalizeAgencySlug(input.agencySlug);
    const seededAt = isoTimestamp(input.now);
    const index = await this.readIndex(agencySlug);
    const record = index.records[input.patientMemoryId];
    if (!record?.current) {
      throw new Error(`Current patient memory is not available: ${input.patientMemoryId}`);
    }

    const requestedPaths = input.artifactRelativePaths?.map(ensureRelativeArtifactPath);
    const currentArtifacts = Object.values(record.current.artifacts).filter((artifact) =>
      requestedPaths ? requestedPaths.includes(artifact.relativePath) : true,
    );
    const currentDirectory = this.currentRoot(agencySlug, input.patientMemoryId);
    const actions: PatientRunDeltaPlan["actions"] = [];

    for (const artifact of currentArtifacts) {
      const sourcePath = artifact.currentPath;
      const targetPath = path.join(input.targetPatientArtifactsDirectory, artifact.relativePath);
      if (!(await fileExists(sourcePath))) {
        actions.push({
          name: artifact.name,
          relativePath: artifact.relativePath,
          sourcePath,
          targetPath,
          action: "seed",
          copied: false,
          reason: "source_missing",
        });
        continue;
      }

      if (!input.overwrite && (await fileExists(targetPath))) {
        actions.push({
          name: artifact.name,
          relativePath: artifact.relativePath,
          sourcePath,
          targetPath,
          action: "seed",
          copied: false,
          reason: "target_exists",
        });
        continue;
      }

      await mkdir(path.dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
      actions.push({
        name: artifact.name,
        relativePath: artifact.relativePath,
        sourcePath,
        targetPath,
        action: "seed",
        copied: true,
        reason: null,
      });
    }

    const plan = patientRunDeltaPlanSchema.parse({
      schemaVersion: "patient-run-delta-plan.v1",
      agencySlug,
      patientMemoryId: input.patientMemoryId,
      workItem: null,
      identityConfidence: record.identity.identityConfidence,
      workItemFingerprint: record.current.workItemFingerprint ?? null,
      createdAt: seededAt,
      sourcePatientArtifactsDirectory: null,
      targetPatientArtifactsDirectory: input.targetPatientArtifactsDirectory,
      currentDirectory,
      historySnapshotPath: null,
      actions,
    });
    await writeJsonFile(path.join(input.targetPatientArtifactsDirectory, PATIENT_MEMORY_SEED_PLAN_FILE_NAME), plan);
    return plan;
  }

  private async writeHistorySnapshot(input: {
    agencySlug: string;
    patientMemoryId: string;
    current: PatientMemoryCurrentMetadata | null;
    createdAt: string;
    reason: string;
    batchId: string | null;
    runId: string | null;
    workItemId: string | null;
  }): Promise<string> {
    const snapshotId = `snapshot-${safeTimestamp(input.createdAt)}`;
    const snapshotPath = path.join(
      this.patientRoot(input.agencySlug, input.patientMemoryId),
      "history",
      snapshotId,
      "snapshot.json",
    );
    await writeJsonFile(snapshotPath, {
      schemaVersion: "patient-memory-history-snapshot.v1",
      snapshotId,
      createdAt: input.createdAt,
      reason: input.reason,
      batchId: input.batchId,
      runId: input.runId,
      workItemId: input.workItemId,
      previousCurrent: input.current,
    });
    return snapshotPath;
  }
}
