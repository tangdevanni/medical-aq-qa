import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { PatientEpisodeWorkItem, PatientMatchResult } from "@medical-ai-qa/shared-types";
import {
  AmbiguousPatientMemoryIdentityError,
  PatientMemoryService,
} from "../services/patientMemoryService";

function createFixture() {
  const storageRoot = mkdtempSync(path.join(os.tmpdir(), "patient-memory-service-"));
  return {
    storageRoot,
    service: new PatientMemoryService(storageRoot),
    cleanup: () => rmSync(storageRoot, { recursive: true, force: true }),
  };
}

function createWorkItem(overrides: Partial<PatientEpisodeWorkItem> = {}): PatientEpisodeWorkItem {
  return {
    id: "work-item-1",
    subsidiaryId: "star-home-health",
    patientIdentity: {
      displayName: "Jane Patient",
      normalizedName: "JANE PATIENT",
      medicareNumber: "1EG4-TE5-MK73",
    },
    episodeContext: {
      episodeDate: "2026-05-01",
      socDate: "2026-04-15",
      episodePeriod: "2026-04",
      billingPeriod: "2026-05",
      payer: null,
      assignedStaff: null,
      clinician: null,
      qaSpecialist: null,
      rfa: null,
    },
    workflowTypes: ["SOC"],
    sourceSheets: ["OASIS Tracking Report"],
    timingMetadata: {
      trackingDays: 16,
      daysInPeriod: 16,
      daysLeft: 14,
      daysLeftBeforeOasisDueDate: 14,
      rawTrackingValues: ["16"],
      rawDaysInPeriodValues: ["16"],
      rawDaysLeftValues: ["14"],
    },
    codingReviewStatus: "NOT_STARTED",
    oasisQaStatus: "NOT_STARTED",
    pocQaStatus: "NOT_STARTED",
    visitNotesQaStatus: "NOT_STARTED",
    billingPrepStatus: "NOT_STARTED",
    sourceRemarks: [],
    sourceRowReferences: [],
    sourceValues: [],
    importWarnings: [],
    ...overrides,
  };
}

function exactMatch(overrides: Partial<PatientMatchResult> = {}): PatientMatchResult {
  return {
    status: "EXACT",
    searchQuery: "Jane Patient",
    portalPatientId: "portal-123",
    portalDisplayName: "Jane Patient",
    candidateNames: ["Jane Patient"],
    note: null,
    ...overrides,
  };
}

describe("PatientMemoryService", () => {
  it("resolves a stable patient memory id and writes the agency index", async () => {
    const fixture = createFixture();

    try {
      const workItem = createWorkItem();
      const first = await fixture.service.resolvePatientMemory({
        agencySlug: "Star Home Health",
        workItem,
        matchResult: exactMatch(),
        now: new Date("2026-05-01T12:00:00.000Z"),
      });
      const second = await fixture.service.resolvePatientMemory({
        agencySlug: "star-home-health",
        workItem,
        matchResult: exactMatch(),
        now: new Date("2026-05-02T12:00:00.000Z"),
      });
      const index = await fixture.service.readIndex("star-home-health");

      assert.equal(first.patientMemoryId, second.patientMemoryId);
      assert.equal(first.created, true);
      assert.equal(second.created, false);
      assert.equal(index.identityAliases["portal:portal-123"], first.patientMemoryId);
      assert.equal(index.records[first.patientMemoryId]?.identity.identityConfidence, "portal_id");
      assert.equal(
        await readFile(
          path.join(fixture.storageRoot, "agencies", "star-home-health", "patient-memory-index.json"),
          "utf8",
        ).then((content) => content.includes(first.patientMemoryId)),
        true,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("blocks ambiguous portal matches and conflicting identity aliases", async () => {
    const fixture = createFixture();

    try {
      await assert.rejects(
        fixture.service.resolvePatientMemory({
          agencySlug: "default",
          workItem: createWorkItem(),
          matchResult: exactMatch({
            status: "AMBIGUOUS",
            portalPatientId: null,
            portalDisplayName: null,
            candidateNames: ["Jane Patient", "Jane A Patient"],
          }),
        }),
        AmbiguousPatientMemoryIdentityError,
      );

      const first = await fixture.service.resolvePatientMemory({
        agencySlug: "default",
        workItem: createWorkItem(),
        matchResult: exactMatch({ portalPatientId: "portal-a" }),
      });
      const index = await fixture.service.readIndex("default");
      index.identityAliases["name-soc:JANE PATIENT:2026-04-15"] = "different-patient-memory-id";
      await fixture.service.writeIndex({
        ...index,
        records: {
          ...index.records,
          "different-patient-memory-id": {
            ...first.record,
            patientMemoryId: "different-patient-memory-id",
            identity: {
              ...first.record.identity,
              portalPatientId: "portal-b",
              identityKeys: ["portal:portal-b", "name-soc:JANE PATIENT:2026-04-15"],
            },
          },
        },
      });

      await assert.rejects(
        fixture.service.resolvePatientMemory({
          agencySlug: "default",
          workItem: createWorkItem(),
          matchResult: exactMatch({ portalPatientId: "portal-a" }),
        }),
        AmbiguousPatientMemoryIdentityError,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("promotes current artifacts, records history, and seeds a new patient artifact directory", async () => {
    const fixture = createFixture();

    try {
      const workItem = createWorkItem();
      const resolution = await fixture.service.resolvePatientMemory({
        agencySlug: "default",
        workItem,
        matchResult: exactMatch(),
        now: new Date("2026-05-01T12:00:00.000Z"),
      });
      const sourceDirectory = path.join(fixture.storageRoot, "batches", "batch-1", "outputs", "patients", workItem.id);
      await mkdir(path.join(sourceDirectory, "referral-document-processing"), { recursive: true });
      await writeFile(
        path.join(sourceDirectory, "patient-dashboard-state.json"),
        JSON.stringify({ patientId: workItem.id, source: "batch" }, null, 2),
      );
      await writeFile(
        path.join(sourceDirectory, "referral-document-processing", "patient-qa-reference.json"),
        JSON.stringify({ reference: "current" }, null, 2),
      );

      const promotion = await fixture.service.promoteCurrentArtifacts({
        agencySlug: "default",
        patientMemoryId: resolution.patientMemoryId,
        sourcePatientArtifactsDirectory: sourceDirectory,
        workItem,
        matchResult: exactMatch(),
        batchId: "batch-1",
        runId: "batch-1-work-item-1",
        artifactRelativePaths: [
          "patient-dashboard-state.json",
          path.join("referral-document-processing", "patient-qa-reference.json"),
          "generated-plan-of-care.json",
        ],
        now: new Date("2026-05-01T12:05:00.000Z"),
      });
      const indexAfterPromotion = await fixture.service.readIndex("default");
      const record = indexAfterPromotion.records[resolution.patientMemoryId];
      const currentDirectory = path.join(
        fixture.storageRoot,
        "agencies",
        "default",
        "patients",
        resolution.patientMemoryId,
        "current",
      );

      assert.equal(promotion.actions.filter((action) => action.copied).length, 2);
      assert.equal(promotion.actions.find((action) => action.relativePath === "generated-plan-of-care.json")?.reason, "source_missing");
      assert.ok(promotion.historySnapshotPath);
      assert.equal(record?.current?.batchId, "batch-1");
      assert.deepEqual(Object.keys(record?.current?.artifacts ?? {}).sort(), [
        path.join("referral-document-processing", "patient-qa-reference.json"),
        "patient-dashboard-state.json",
      ].sort());
      assert.equal(
        JSON.parse(await readFile(path.join(currentDirectory, "patient-dashboard-state.json"), "utf8")).source,
        "batch",
      );
      assert.equal(record?.history.length, 1);

      const seededDirectory = path.join(fixture.storageRoot, "batches", "batch-2", "outputs", "patients", workItem.id);
      const seed = await fixture.service.seedPatientArtifacts({
        agencySlug: "default",
        patientMemoryId: resolution.patientMemoryId,
        targetPatientArtifactsDirectory: seededDirectory,
        now: new Date("2026-05-02T12:00:00.000Z"),
      });

      assert.equal(seed.actions.filter((action) => action.copied).length, 2);
      assert.equal(
        JSON.parse(await readFile(path.join(seededDirectory, "patient-dashboard-state.json"), "utf8")).source,
        "batch",
      );
      assert.equal(
        JSON.parse(
          await readFile(
            path.join(seededDirectory, "referral-document-processing", "patient-qa-reference.json"),
            "utf8",
          ),
        ).reference,
        "current",
      );
      assert.equal(await readFile(path.join(seededDirectory, "patient-memory-seed-plan.json"), "utf8").then(Boolean), true);
    } finally {
      fixture.cleanup();
    }
  });
});
