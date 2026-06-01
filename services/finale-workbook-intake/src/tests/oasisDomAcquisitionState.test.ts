import { describe, expect, it } from "vitest";
import type {
  OasisDomAcquisitionState,
  PortalDomExtractedField,
  PortalDomExtractedSection,
  PortalDomExtractedState,
} from "@medical-ai-qa/shared-types";
import { buildOasisDomBridgeText } from "../portal/domExtraction/oasisDomBridge";
import {
  evaluateOasisDomAcquisitionReadiness,
  mergeOasisDomAcquisitionState,
} from "../portal/domExtraction/oasisDomAcquisitionState";

const REQUIRED_SECTIONS = [
  "Administrative Information",
  "Active Diagnoses",
  "Vital Signs & Pain Assessment",
  "Medication & Allergies (Injectables Medications)",
  "Neurological (Head, Mood, Eyes, Ears)",
  "Cardiopulmonary (Chest & Thorax)",
  "Gastrointestinal & Genitourinary Assessment",
  "Integumentary (Skin & Wound)",
  "Safety & Risk Assessment",
  "Functional Assessment (Self Care)",
  "Functional Assessment (Mobility & Musculoskeletal)",
  "Endocrine (Diabetic Management)",
  "Plan of Care and Physical Therapy Evaluation",
  "Patient Summary & Clinical Narrative",
];

function field(input: {
  code: string;
  label: string;
  value?: string;
}): PortalDomExtractedField {
  return {
    itemCode: input.code,
    key: input.code,
    label: input.label,
    value: input.value ?? `${input.label} documented`,
    sourceKind: "input",
    confidence: "high",
  };
}

function section(title: string, fields: PortalDomExtractedField[]): PortalDomExtractedSection {
  return {
    title,
    status: "success",
    fields,
    tables: [],
    visibleTextDigest: fields.map((entry) => `${entry.itemCode} ${entry.label} ${entry.value}`).join("\n"),
  };
}

function state(input: {
  sections: PortalDomExtractedSection[];
  fallbackRecommended?: boolean;
  fallbackReasons?: string[];
  hash?: string;
}): PortalDomExtractedState {
  const fields = input.sections.flatMap((entry) => entry.fields);
  return {
    artifactType: "portal_dom_extracted_state",
    sourceArea: "oasis",
    extractionVersion: "test",
    extractedAt: "2026-05-28T08:00:00.000Z",
    sections: input.sections,
    coverage: {
      sectionCount: input.sections.length,
      fieldCount: fields.length,
      nonEmptyFieldCount: fields.filter((entry) => String(entry.value ?? "").trim()).length,
      tableCount: 0,
      confidence: input.fallbackRecommended ? "low" : "high",
      fallbackRecommended: input.fallbackRecommended ?? false,
      fallbackReasons: input.fallbackReasons ?? [],
    },
    diagnostics: {
      inputSource: input.fallbackRecommended ? "dom_state_plus_raw_fallback" : "dom_state_primary",
      ocrUsed: false,
      pdfCaptureUsed: false,
      routePattern: "https://app.finalehealth.com/provider/<provider-id>/client/<client-id>/intake/<intake-id>/documents/note/<document-type>/<note-id>",
    },
    contentHash: input.hash ?? "hash",
    textDigest: input.sections.map((entry) => entry.visibleTextDigest ?? entry.title).join("\n"),
  };
}

function readyDomState(overrides: Partial<Record<string, PortalDomExtractedField[]>> = {}): PortalDomExtractedState {
  const sections = REQUIRED_SECTIONS.map((title, index) => section(title, overrides[title] ?? [
    field({ code: `M${String(index + 1).padStart(4, "0")}`, label: `${title} field`, value: `${title} documented` }),
  ]));
  sections[1] = section("Active Diagnoses", [
    field({ code: "M1021", label: "Primary diagnosis", value: "Diagnosis documented" }),
  ]);
  sections[3] = section("Medication & Allergies (Injectables Medications)", [
    field({ code: "O0110", label: "Medication allergies", value: "Medication and allergies reviewed" }),
  ]);
  sections[4] = section("Neurological (Head, Mood, Eyes, Ears)", [
    field({ code: "M1700", label: "Neurological mood cognitive BIMS PHQ", value: "Cognition and mood documented" }),
  ]);
  sections[7] = section("Integumentary (Skin & Wound)", [
    field({ code: "M1311", label: "Wound skin integumentary", value: "Wound and skin documented" }),
  ]);
  sections[10] = section("Functional Assessment (Mobility & Musculoskeletal)", [
    field({ code: "GG0170", label: "Mobility musculoskeletal walker transfer", value: "Mobility documented" }),
  ]);
  sections[12] = section("Plan of Care and Physical Therapy Evaluation", [
    field({ code: "M2200", label: "Plan of care physical therapy", value: "Physical therapy plan documented" }),
  ]);
  sections[13] = section("Patient Summary & Clinical Narrative", [
    field({ code: "M2400", label: "Patient summary clinical narrative homebound medical necessity", value: "Clinical narrative homebound medical necessity documented" }),
  ]);
  for (const [title, fields] of Object.entries(overrides)) {
    const index = sections.findIndex((entry) => entry.title === title);
    if (index >= 0 && fields) {
      sections[index] = section(title, fields);
    }
  }
  sections.push({
    title: "Care Plan (Problems / Goals / Interventions)",
    status: "skipped_deferred",
    fields: [],
    tables: [],
    fallbackReasons: ["care_plan_deferred_for_later_mapping"],
  });
  return state({ sections });
}

describe("OASIS DOM acquisition state", () => {
  it("creates in_progress state when required sections are missing", () => {
    const merged = mergeOasisDomAcquisitionState(null, state({
      sections: [
        section("Administrative Information", [field({ code: "M0010", label: "Agency", value: "123" })]),
        section("Active Diagnoses", [field({ code: "M1021", label: "Diagnosis", value: "Diagnosis documented" })]),
      ],
    }), {
      patientRunId: "run-1",
      minFieldCount: 1,
      minNonEmptyFieldCount: 1,
    });

    expect(merged.acquisitionStatus).toBe("in_progress");
    expect(merged.missingRequiredSections).toContain("Vital Signs & Pain Assessment");
    expect(merged.readinessReasons).toContain("pending_missing_required_sections");
  });

  it("transitions to ready_for_qa after a later scrape fills required sections", () => {
    const first = mergeOasisDomAcquisitionState(null, state({
      sections: [section("Administrative Information", [field({ code: "M0010", label: "Agency", value: "123" })])],
    }), { minFieldCount: 1, minNonEmptyFieldCount: 1 });
    const second = mergeOasisDomAcquisitionState(first, readyDomState(), {
      minFieldCount: 8,
      minNonEmptyFieldCount: 8,
    });

    expect(second.acquisitionStatus).toBe("ready_for_qa");
    expect(second.readinessReasons).toEqual(["ready_for_qa"]);
    expect(second.missingRequiredSections).toEqual([]);
  });

  it("unchanged scrape after QA remains qa_completed", () => {
    const ready = mergeOasisDomAcquisitionState(null, readyDomState(), {
      minFieldCount: 8,
      minNonEmptyFieldCount: 8,
    });
    const completed: OasisDomAcquisitionState = {
      ...ready,
      acquisitionStatus: "qa_completed",
      lastQaInputHash: ready.overallContentHash,
    };
    const next = mergeOasisDomAcquisitionState(completed, readyDomState(), {
      minFieldCount: 8,
      minNonEmptyFieldCount: 8,
    });

    expect(next.acquisitionStatus).toBe("qa_completed");
    expect(next.changedFields).toEqual([]);
  });

  it("changed value after QA marks the acquisition stale", () => {
    const ready = mergeOasisDomAcquisitionState(null, readyDomState(), {
      minFieldCount: 8,
      minNonEmptyFieldCount: 8,
    });
    const completed: OasisDomAcquisitionState = {
      ...ready,
      acquisitionStatus: "qa_completed",
      lastQaInputHash: ready.overallContentHash,
    };
    const changed = readyDomState({
      "Active Diagnoses": [field({ code: "M1021", label: "Primary diagnosis", value: "Updated diagnosis documentation" })],
    });
    const next = mergeOasisDomAcquisitionState(completed, changed, {
      minFieldCount: 8,
      minNonEmptyFieldCount: 8,
    });

    expect(next.acquisitionStatus).toBe("qa_stale_due_to_oasis_change");
    expect(next.changedFields.length).toBeGreaterThan(0);
  });

  it("field regression does not erase the prior filled value", () => {
    const first = mergeOasisDomAcquisitionState(null, state({
      sections: [section("Administrative Information", [field({ code: "M0010", label: "Agency", value: "123456" })])],
    }), { minFieldCount: 1, minNonEmptyFieldCount: 1 });
    const second = mergeOasisDomAcquisitionState(first, state({
      sections: [section("Administrative Information", [field({ code: "M0010", label: "Agency", value: "" })])],
    }), { minFieldCount: 1, minNonEmptyFieldCount: 1 });
    const agency = second.sections[0]?.fields.find((entry) => entry.oasisItemCode === "M0010");

    expect(agency?.status).toBe("regressed");
    expect(agency?.normalizedValue).toBe("123456");
    expect(second.regressedFields.length).toBe(1);
  });

  it("Care Plan deferred does not block readiness", () => {
    const merged = mergeOasisDomAcquisitionState(null, readyDomState(), {
      minFieldCount: 8,
      minNonEmptyFieldCount: 8,
    });

    expect(merged.sections.find((entry) => entry.sectionKey.includes("care_plan"))?.status).toBe("deferred");
    expect(merged.acquisitionStatus).toBe("ready_for_qa");
  });

  it("low DOM coverage routes to OCR fallback or insufficient evidence", () => {
    const lowCoverage = state({
      sections: [section("Administrative Information", [])],
      fallbackRecommended: true,
      fallbackReasons: ["no_structured_fields_or_tables"],
    });
    const withFallback = mergeOasisDomAcquisitionState(null, lowCoverage, { ocrFallbackEnabled: true });
    const withoutFallback = mergeOasisDomAcquisitionState(null, lowCoverage, { ocrFallbackEnabled: false });

    expect(withFallback.acquisitionStatus).toBe("fallback_to_ocr_required");
    expect(withoutFallback.acquisitionStatus).toBe("insufficient_evidence");
  });

  it("readiness controls whether the bridge text can feed the existing path", () => {
    const ready = mergeOasisDomAcquisitionState(null, readyDomState(), {
      minFieldCount: 8,
      minNonEmptyFieldCount: 8,
    });
    const readiness = evaluateOasisDomAcquisitionReadiness({
      state: ready,
      minFieldCount: 8,
      minNonEmptyFieldCount: 8,
    });
    const bridgeText = buildOasisDomBridgeText(readyDomState());

    expect(readiness.status).toBe("ready_for_qa");
    expect(bridgeText).toContain("OASIS DOM EXTRACTED STATE");
    expect(bridgeText).toContain("Active Diagnoses");
  });
});
