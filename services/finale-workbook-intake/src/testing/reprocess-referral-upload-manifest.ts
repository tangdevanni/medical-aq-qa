import { existsSync } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactRecord, PatientRun } from "@medical-ai-qa/shared-types";
import { loadEnv } from "../config/env";
import { extractDocumentsFromArtifacts, type ExtractedDocument } from "../services/documentExtractionService";
import { writeDocumentTextFile } from "../services/documentTextExportService";
import { buildDocumentFactPack, writeDocumentFactPackFile } from "../services/documentFactPackBuilder";
import { extractDiagnosisCodingContext } from "../services/diagnosisCodingExtractionService";
import { writeCodingInputFile } from "../services/codingInputExportService";
import { runReferralDocumentProcessingPipeline } from "../referralProcessing/pipeline";
import { writePatientDashboardState } from "../services/patientDashboardStateWriter";

const DEFAULT_BATCH_PATH = "C:/dev/medical-aq-qa-dom-first/services/api/data/control-plane/batches/star-home-health/b5/batch.json";
const DEFAULT_PATIENT = "Jean Thompson";

function argValue(name: string, fallback: string): string {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

async function main() {
  const batchPath = path.resolve(argValue("batch", DEFAULT_BATCH_PATH));
  const patientName = argValue("patient", DEFAULT_PATIENT);
  const batch = JSON.parse(await readFile(batchPath, "utf8")) as {
    id: string;
    storage: { outputRoot: string };
    patientRuns: PatientRun[];
  };
  const run = batch.patientRuns.find((candidate) =>
    candidate.patientName.toLowerCase() === patientName.toLowerCase() ||
    candidate.workItemId.toLowerCase().includes(patientName.toLowerCase().replace(/\s+/g, "_")),
  );
  if (!run?.workItemSnapshot) {
    throw new Error(`Patient run was not found in ${batchPath}: ${patientName}`);
  }

  const outputDir = batch.storage.outputRoot;
  const patientDirectory = path.join(outputDir, "patients", run.workItemId);
  const manifestPath = argValue(
    "manifest",
    path.join(patientDirectory, "documents", "all-file-uploads", "manifest.json"),
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    fileUploadsUrl?: string;
    documents?: Array<Record<string, unknown>>;
  };
  const documents = Array.isArray(manifest.documents) ? manifest.documents : [];
  const artifact: ArtifactRecord = {
    artifactType: "OASIS",
    status: documents.some((item) => item.sourcePath || item.extractedTextPath) ? "DOWNLOADED" : "FOUND",
    portalLabel: "All Referral File Uploads",
    locatorUsed: "local all-referral upload manifest",
    discoveredAt: new Date().toISOString(),
    downloadPath: null,
    extractedFields: {
      fileUploadsAccessible: "true",
      fileUploadsUrl: manifest.fileUploadsUrl ?? "",
      visibleUploadedDocuments: documents.map((item) => String(item.sourceLabel ?? "")).filter(Boolean).join(" | "),
      allReferralSourceDocuments: JSON.stringify(documents.filter((item) => item.sourcePath || item.extractedTextPath)),
    },
    notes: [`allReferralUploadManifest:${manifestPath}`],
  };

  const env = loadEnv({
    ...process.env,
    CODE_LLM_ENABLED: process.env.CODE_LLM_ENABLED ?? "true",
  });
  const extractedDocuments = await extractDocumentsFromArtifacts([artifact]);
  const orderDocuments: ExtractedDocument[] = extractedDocuments.filter((document) => document.type === "ORDER");

  await writeDocumentTextFile({
    outputDirectory: outputDir,
    patientId: run.workItemId,
    batchId: batch.id,
    extractedDocuments,
  });
  const factPack = buildDocumentFactPack(extractedDocuments);
  await writeDocumentFactPackFile({
    outputDirectory: outputDir,
    patientId: run.workItemId,
    batchId: batch.id,
    factPack,
  });
  const diagnosisContext = await extractDiagnosisCodingContext({
    extractedDocuments,
    env,
  });
  await writeCodingInputFile({
    outputDirectory: outputDir,
    patientId: run.workItemId,
    batchId: batch.id,
    canonical: diagnosisContext.canonical,
  });
  if (orderDocuments.length > 0) {
    await runReferralDocumentProcessingPipeline({
      workItem: run.workItemSnapshot,
      outputDir,
      env,
      logger: console as never,
      extractedDocuments: orderDocuments,
    });
  }

  const localRun: PatientRun = {
    ...run,
    workflowRuns: run.workflowRuns.map((workflow) =>
      workflow.workflowDomain === "coding"
        ? {
            ...workflow,
            workflowResultPath: path.join(patientDirectory, "coding-input.json"),
          }
        : workflow.workflowDomain === "qa"
          ? {
              ...workflow,
              workflowResultPath: path.join(patientDirectory, "qa-prefetch-result.json"),
            }
          : workflow,
    ),
  };
  await writePatientDashboardState({
    outputDirectory: outputDir,
    run: localRun,
    env,
  });

  for (const workflow of run.workflowRuns) {
    if (workflow.workflowDomain !== "coding" || !workflow.workflowResultPath) {
      continue;
    }
    if (existsSync(path.dirname(workflow.workflowResultPath))) {
      await copyFile(path.join(patientDirectory, "coding-input.json"), workflow.workflowResultPath).catch(() => undefined);
    }
  }

  console.log(JSON.stringify({
    patientName,
    manifestPath,
    extractedDocumentCount: extractedDocuments.length,
    orderDocumentCount: orderDocuments.length,
    diagnosisCount: factPack.diagnoses.length,
    medicationCount: factPack.medications.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
