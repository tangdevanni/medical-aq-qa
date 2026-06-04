import type { ArtifactRecord } from "@medical-ai-qa/shared-types";
import type { ReferralSourceDocumentInput } from "./pipeline";

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function parseJsonArray(value: string | null | undefined): unknown[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && normalizeWhitespace(value) ? normalizeWhitespace(value) : null;
}

function pushUnique(
  documents: ReferralSourceDocumentInput[],
  seen: Set<string>,
  document: ReferralSourceDocumentInput,
): void {
  const sourcePath = normalizeWhitespace(document.sourcePath);
  const extractedTextPath = normalizeWhitespace(document.extractedTextPath);
  const key = [sourcePath, extractedTextPath, normalizeWhitespace(document.sourceLabel)].join("|").toLowerCase();
  if ((!sourcePath && !extractedTextPath) || seen.has(key)) {
    return;
  }
  seen.add(key);
  documents.push(document);
}

export function collectReferralSourceDocumentsFromArtifacts(
  artifacts: ArtifactRecord[],
): ReferralSourceDocumentInput[] {
  const documents: ReferralSourceDocumentInput[] = [];
  const seen = new Set<string>();

  for (const artifact of artifacts) {
    const allReferralSourceDocuments = parseJsonArray(
      artifact.extractedFields?.allReferralSourceDocuments,
    );
    for (const [index, entry] of allReferralSourceDocuments.entries()) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const sourcePath = asString((entry as { sourcePath?: unknown }).sourcePath);
      const extractedTextPath = asString((entry as { extractedTextPath?: unknown }).extractedTextPath);
      const sourceLabel = asString((entry as { sourceLabel?: unknown }).sourceLabel) ??
        `Referral source ${index + 1}`;
      pushUnique(documents, seen, {
        sourceLabel,
        sourcePath,
        extractedTextPath,
        portalLabel: artifact.portalLabel,
        acquisitionMethod: sourcePath ? "download" : "in_memory_fallback",
      });
    }

    const admissionOrderSourcePdfPath = normalizeWhitespace(artifact.extractedFields?.admissionOrderSourcePdfPath);
    const admissionOrderPrintedPdfPath = normalizeWhitespace(artifact.extractedFields?.admissionOrderPrintedPdfPath);
    const sourcePath = admissionOrderSourcePdfPath || admissionOrderPrintedPdfPath ||
      (artifact.artifactType === "PHYSICIAN_ORDERS" ? normalizeWhitespace(artifact.downloadPath) : "");
    if (sourcePath) {
      pushUnique(documents, seen, {
        sourceLabel: normalizeWhitespace(artifact.extractedFields?.admissionOrderTitle) ||
          normalizeWhitespace(artifact.portalLabel) ||
          "Admission Order",
        sourcePath,
        extractedTextPath: null,
        portalLabel: artifact.portalLabel,
        acquisitionMethod: artifact.artifactType === "PHYSICIAN_ORDERS" ? "download" : "printed_pdf",
      });
    }
  }

  return documents;
}

export function filterArtifactsForNonReferralTextExtraction(
  artifacts: ArtifactRecord[],
): ArtifactRecord[] {
  return artifacts
    .filter((artifact) => artifact.artifactType !== "PHYSICIAN_ORDERS")
    .map((artifact) => ({
      ...artifact,
      extractedFields: {
        ...artifact.extractedFields,
        allReferralSourceDocuments: null,
        admissionOrderTextExcerpt: null,
        admissionOrderSourcePdfPath: null,
        admissionOrderPrintedPdfPath: null,
        admissionOrderSourceMetaPath: null,
        admissionOrderTitle: null,
      },
    }));
}
