import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "../config/env";
import { createPortalSession } from "../browser/context";
import { LoginPage } from "../portal/pages/LoginPage";
import { extractDocumentsFromArtifacts } from "../services/documentExtractionService";
import { writeDocumentTextFile } from "../services/documentTextExportService";
import { buildDocumentFactPack, writeDocumentFactPackFile } from "../services/documentFactPackBuilder";
import { extractDiagnosisCodingContext } from "../services/diagnosisCodingExtractionService";
import { writeCodingInputFile } from "../services/codingInputExportService";
import { runReferralDocumentProcessingPipeline } from "../referralProcessing/pipeline";
import {
  collectReferralSourceDocumentsFromArtifacts,
  filterArtifactsForNonReferralTextExtraction,
} from "../referralProcessing/sourceDocumentHandoff";
import { writePatientDashboardState } from "../services/patientDashboardStateWriter";
import type { ArtifactRecord, PatientRun } from "@medical-ai-qa/shared-types";

const DEFAULT_BATCH_PATH = "C:/dev/medical-aq-qa-dom-first/services/api/data/control-plane/batches/star-home-health/b5/batch.json";
const DEFAULT_PATIENT = "Jean Thompson";

function argValue(name: string, fallback: string): string {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function slugify(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "") || "document";
}

function inferExtension(input: { label: string; contentType?: string | null }): string {
  const labelExtension = path.extname(input.label).toLowerCase();
  if (labelExtension) {
    return labelExtension;
  }
  const contentType = input.contentType ?? "";
  if (/pdf/i.test(contentType)) {
    return ".pdf";
  }
  if (/jpe?g/i.test(contentType)) {
    return ".jpg";
  }
  if (/png/i.test(contentType)) {
    return ".png";
  }
  return ".bin";
}

function isDocumentResponse(input: { url: string; contentType: string }): boolean {
  return (
    /\.(?:pdf|png|jpe?g)(?:$|[?#])/i.test(input.url) ||
    /application\/pdf|image\/(?:png|jpe?g)/i.test(input.contentType) ||
    /\/api\/v\d+\/files\//i.test(input.url)
  );
}

function extractLabelsFromSourceMeta(sourceMeta: unknown): string[] {
  const meta = sourceMeta as {
    visibleUploadedDocuments?: unknown;
    matchedSourceDocuments?: unknown;
    normalizedFileLabels?: unknown;
  };
  const matchedLabels = Array.isArray(meta.matchedSourceDocuments)
    ? meta.matchedSourceDocuments
      .map((entry) => entry && typeof entry === "object" && "label" in entry ? (entry as { label?: unknown }).label : null)
      .filter(Boolean)
    : [];
  const labels = matchedLabels.length > 0
    ? matchedLabels
    : Array.isArray(meta.visibleUploadedDocuments)
    ? meta.visibleUploadedDocuments
    : Array.isArray(meta.normalizedFileLabels)
      ? meta.normalizedFileLabels
      : [];
  return Array.from(new Set(
    labels
      .map((label) => normalizeWhitespace(String(label ?? "")))
      .filter((label) => /\.(?:pdf|png|jpe?g)\b/i.test(label)),
  ));
}

async function readKnownUploadLabels(patientDirectory: string): Promise<string[]> {
  const sourceMetaCandidates = [
    path.join(patientDirectory, "documents", "j-thompson-admission-packet-pdf", "source-meta.json"),
    path.join(patientDirectory, "referral-document-processing", "source-meta.json"),
  ];
  for (const candidate of sourceMetaCandidates) {
    try {
      const labels = extractLabelsFromSourceMeta(JSON.parse(await readFile(candidate, "utf8")));
      if (labels.length > 0) {
        return labels;
      }
    } catch {
      // keep looking
    }
  }
  return [];
}

async function collectVisibleUploadLabels(page: import("@playwright/test").Page): Promise<string[]> {
  const labels = await page.locator(".file-label, .file-item, table tbody tr").evaluateAll((nodes) =>
    nodes
      .map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter((text) => /\.(?:pdf|png|jpe?g)\b/i.test(text)),
  ).catch(() => []);
  return Array.from(new Set(labels.map((label) => normalizeWhitespace(label)).filter(Boolean)));
}

async function findUploadLocator(page: import("@playwright/test").Page, label: string) {
  const candidates = [
    page.locator(".file-item", { hasText: label }).first(),
    page.locator(".file-label", { hasText: label }).first(),
    page.locator("table tbody tr", { hasText: label }).first(),
    page.getByText(label, { exact: true }).first(),
  ];
  for (const locator of candidates) {
    if (await locator.count().catch(() => 0) > 0 && await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function captureUpload(input: {
  page: import("@playwright/test").Page;
  fileUploadsUrl: string;
  label: string;
  outputRoot: string;
}): Promise<{
  sourceLabel: string;
  sourcePath: string | null;
  extractedTextPath: string | null;
  sha256: string | null;
  status: "captured" | "not_found" | "empty_response" | "viewer_text_only";
  notes: string[];
}> {
  const page = input.page;
  await page.goto(input.fileUploadsUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  const locator = await findUploadLocator(page, input.label);
  const documentDirectory = path.join(input.outputRoot, slugify(input.label));
  await mkdir(documentDirectory, { recursive: true });

  if (!locator) {
    return {
      sourceLabel: input.label,
      sourcePath: null,
      extractedTextPath: null,
      sha256: null,
      status: "not_found",
      notes: ["upload label was not visible on the file uploads page"],
    };
  }

  const responseTasks: Array<Promise<{ body: Buffer; contentType: string; url: string } | null>> = [];
  const onResponse = (response: import("@playwright/test").Response) => {
    const contentType = response.headers()["content-type"] ?? "";
    if (!isDocumentResponse({ url: response.url(), contentType })) {
      return;
    }
    responseTasks.push((async () => {
      try {
        const body = await response.body();
        return body.length > 0 ? { body, contentType, url: response.url() } : null;
      } catch {
        return null;
      }
    })());
  };

  page.on("response", onResponse);
  const downloadPromise = page.waitForEvent("download", { timeout: 15_000 }).catch(() => null);
  await locator.click({ timeout: 15_000 }).catch(async () => {
    await locator.click({ force: true, timeout: 15_000 });
  });
  await page.waitForTimeout(2_500);
  page.off("response", onResponse);

  const download = await downloadPromise;
  if (download) {
    const extension = inferExtension({ label: download.suggestedFilename() || input.label });
    const outputPath = path.join(documentDirectory, `source${extension}`);
    await download.saveAs(outputPath);
    const body = await readFile(outputPath);
    return {
      sourceLabel: input.label,
      sourcePath: outputPath,
      extractedTextPath: null,
      sha256: createHash("sha256").update(body).digest("hex"),
      status: body.length > 0 ? "captured" : "empty_response",
      notes: [`download:${download.suggestedFilename()}`],
    };
  }

  const responses = (await Promise.all(responseTasks)).filter((entry): entry is {
    body: Buffer;
    contentType: string;
    url: string;
  } => entry !== null);
  const response = responses.sort((left, right) => right.body.length - left.body.length)[0] ?? null;
  if (response) {
    const extension = inferExtension({ label: input.label, contentType: response.contentType });
    const outputPath = path.join(documentDirectory, `source${extension}`);
    await writeFile(outputPath, response.body);
    return {
      sourceLabel: input.label,
      sourcePath: outputPath,
      extractedTextPath: null,
      sha256: createHash("sha256").update(response.body).digest("hex"),
      status: response.body.length > 0 ? "captured" : "empty_response",
      notes: [`response:${response.contentType || "unknown"}:${response.url}`],
    };
  }

  const text = normalizeWhitespace(await page.locator("body").innerText({ timeout: 5_000 }).catch(() => ""));
  if (text.length > 100) {
    const textPath = path.join(documentDirectory, "source.txt");
    await writeFile(textPath, `${text}\n`, "utf8");
    return {
      sourceLabel: input.label,
      sourcePath: null,
      extractedTextPath: textPath,
      sha256: createHash("sha256").update(text).digest("hex"),
      status: "viewer_text_only",
      notes: ["captured visible viewer text only"],
    };
  }

  return {
    sourceLabel: input.label,
    sourcePath: null,
    extractedTextPath: null,
    sha256: null,
    status: "empty_response",
    notes: ["no document response, download, or visible text was captured"],
  };
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
  const qaPrefetch = JSON.parse(await readFile(path.join(patientDirectory, "qa-prefetch-result.json"), "utf8")) as {
    chartUrl?: string | null;
    matchResult?: { chartUrl?: string | null };
  };
  const chartUrl = qaPrefetch.chartUrl ?? qaPrefetch.matchResult?.chartUrl;
  if (!chartUrl) {
    throw new Error(`No chart URL found for ${patientName}`);
  }
  const fileUploadsUrl = chartUrl.replace(/\/intake\/[^/]+\/calendar(?:$|[?#].*)/i, "/file-uploads");
  const acquisitionRoot = path.join(patientDirectory, "documents", "all-file-uploads");
  await mkdir(acquisitionRoot, { recursive: true });

  const env = loadEnv({
    ...process.env,
    PORTAL_HEADLESS: process.env.PORTAL_HEADLESS ?? "true",
    PLAYWRIGHT_HEADLESS: process.env.PLAYWRIGHT_HEADLESS ?? "true",
    CODE_LLM_ENABLED: process.env.CODE_LLM_ENABLED ?? "true",
  });
  const session = await createPortalSession(env);
  try {
    const loginPage = new LoginPage(session.page);
    await loginPage.ensureLoggedIn({
      baseUrl: env.PORTAL_BASE_URL,
      username: env.PORTAL_USERNAME,
      password: env.PORTAL_PASSWORD,
    });
    await session.page.goto(fileUploadsUrl, { waitUntil: "domcontentloaded" });
    await session.page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await writeFile(
      path.join(acquisitionRoot, "file-uploads-page-text.txt"),
      `${await session.page.locator("body").innerText({ timeout: 5_000 }).catch(() => "")}\n`,
      "utf8",
    );
    await writeFile(
      path.join(acquisitionRoot, "file-uploads-page.html"),
      await session.page.content().catch(() => ""),
      "utf8",
    );
    const labels = Array.from(new Set([
      ...(await readKnownUploadLabels(patientDirectory)),
      ...(await collectVisibleUploadLabels(session.page)),
    ])).filter((label) => /\.(?:pdf|png|jpe?g)\b/i.test(label));

    const captured = [];
    for (const label of labels) {
      captured.push(await captureUpload({
        page: session.page,
        fileUploadsUrl,
        label,
        outputRoot: acquisitionRoot,
      }));
    }

    const manifestPath = path.join(acquisitionRoot, "manifest.json");
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: "all-referral-file-uploads.v1",
      generatedAt: new Date().toISOString(),
      patientName,
      patientId: run.workItemId,
      fileUploadsUrl,
      uploadCount: labels.length,
      capturedCount: captured.filter((item) => item.status === "captured" || item.status === "viewer_text_only").length,
      documents: captured,
    }, null, 2), "utf8");

    const artifact: ArtifactRecord = {
      artifactType: "OASIS",
      status: captured.some((item) => item.sourcePath || item.extractedTextPath) ? "DOWNLOADED" : "FOUND",
      portalLabel: "All Referral File Uploads",
      locatorUsed: "file-uploads all visible document labels",
      discoveredAt: new Date().toISOString(),
      downloadPath: null,
      extractedFields: {
        fileUploadsAccessible: "true",
        fileUploadsUrl,
        visibleUploadedDocuments: labels.join(" | "),
        allReferralSourceDocuments: JSON.stringify(captured.filter((item) => item.sourcePath || item.extractedTextPath)),
      },
      notes: [`allReferralUploadManifest:${manifestPath}`],
    };

    const referralSourceDocuments = collectReferralSourceDocumentsFromArtifacts([artifact]);
    const extractedDocuments = await extractDocumentsFromArtifacts(filterArtifactsForNonReferralTextExtraction([artifact]));
    await writeFile(path.join(patientDirectory, "document-inventory.json"), JSON.stringify({
      schemaVersion: "1",
      generatedAt: new Date().toISOString(),
      patientId: run.workItemId,
      documentCount: captured.length,
      documents: captured.map((item) => ({
        sourceLabel: item.sourceLabel,
        normalizedType: "ORDER",
        discipline: "UNKNOWN",
        confidence: item.status === "captured" || item.status === "viewer_text_only" ? 0.9 : 0.2,
        evidence: item.notes,
        sourceUrl: fileUploadsUrl,
        sourcePath: item.sourcePath ?? item.extractedTextPath,
        discoveredAt: new Date().toISOString(),
        openBehavior: "SAME_PAGE",
      })),
    }, null, 2), "utf8");
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
    if (referralSourceDocuments.length > 0) {
      await runReferralDocumentProcessingPipeline({
        workItem: run.workItemSnapshot,
        outputDir,
        env,
        logger: console as never,
        extractedDocuments: [],
        sourceDocuments: referralSourceDocuments,
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
      fileUploadsUrl,
      manifestPath,
      uploadCount: labels.length,
      capturedCount: captured.filter((item) => item.status === "captured" || item.status === "viewer_text_only").length,
      extractedDocumentCount: extractedDocuments.length,
      referralSourceDocumentCount: referralSourceDocuments.length,
      referralFactCount: factPack.stats.rawCharacters,
    }, null, 2));
  } finally {
    await session.browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
