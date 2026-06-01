import type { Page } from "@playwright/test";
import type { PortalDomExtractedState } from "@medical-ai-qa/shared-types";
import {
  extractPortalDomStateFromPage,
  type PortalDomExtractionThresholds,
} from "./portalDomExtraction";

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

async function inferVisitNoteTitle(page: Page): Promise<string> {
  const title = await page.evaluate(() => {
    const documentRef = (globalThis as unknown as { document: any }).document;
    const normalize = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
    const candidates = Array.from(documentRef.querySelectorAll([
      "h1",
      "h2",
      "h3",
      "[role='heading']",
      ".modal-title",
      "app-document-note",
      "form",
    ].join(", ")));
    for (const candidate of candidates) {
      const text = normalize((candidate as any).textContent);
      if (/visit\s*note|skilled\s*nurs|therapy|rn|pt|ot|st|slp|vital|assessment/i.test(text)) {
        return text.slice(0, 120);
      }
    }
    return normalize(documentRef.title);
  }).catch(() => "");
  return normalizeWhitespace(title) || "Visit Note";
}

export async function extractVisitNoteDomStateFromCurrentPage(input: {
  page: Page;
  thresholds?: Partial<PortalDomExtractionThresholds>;
}): Promise<PortalDomExtractedState> {
  const title = await inferVisitNoteTitle(input.page);
  const state = await extractPortalDomStateFromPage(input.page, {
    sourceArea: "visit_notes",
    sectionTitle: title,
    ...input.thresholds,
  });

  const fallbackReasons = [...state.coverage.fallbackReasons];
  const hasClinicalCue = /goal|intervention|response|vital|blood pressure|pulse|respir|pain|assessment|wound|gait|therapy|skilled|plan of care|poc/i
    .test(state.textDigest);
  if (!hasClinicalCue) {
    fallbackReasons.push("visit_note_clinical_cues_not_found");
  }

  if (fallbackReasons.length === state.coverage.fallbackReasons.length) {
    return state;
  }

  return {
    ...state,
    coverage: {
      ...state.coverage,
      confidence: state.coverage.confidence === "high" ? "medium" : state.coverage.confidence,
      fallbackRecommended: true,
      fallbackReasons: Array.from(new Set(fallbackReasons)),
    },
    diagnostics: {
      ...state.diagnostics,
      inputSource: "dom_state_plus_raw_fallback",
    },
  };
}
