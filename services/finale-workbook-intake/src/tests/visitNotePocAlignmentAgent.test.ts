import { describe, expect, it } from "vitest";
import {
  buildVisitNotePocAlignmentPrompt,
  parseVisitNotePocAlignmentLlmJson,
  parseVisitNotePocMappingLlmJson,
} from "../services/visitNotePocAlignmentAgent";

describe("visit note POC alignment LLM schema", () => {
  it("parses strict JSON with progress and evidence IDs", () => {
    const result = parseVisitNotePocAlignmentLlmJson(JSON.stringify({
      verdict: "positive_progress",
      confidence: 0.84,
      visitNoteFactIds: ["visit-note-fact-1"],
      pocEvidenceIds: ["poc-goal-1"],
      oasisFactIds: ["oasis-mobility-1"],
      rationale: "Visit note documents mobility improvement with walker training and patient tolerated intervention.",
    }));

    expect(result.verdict).toBe("positive_progress");
    expect(result.visitNoteFactIds).toEqual(["visit-note-fact-1"]);
    expect(result.oasisFactIds).toEqual(["oasis-mobility-1"]);
  });

  it("rejects unsupported verdicts and unsafe rationale text", () => {
    expect(() => parseVisitNotePocAlignmentLlmJson(JSON.stringify({
      verdict: "looks_good",
      confidence: 0.8,
      visitNoteFactIds: [],
      pocEvidenceIds: [],
      rationale: "Patient tolerated skilled care.",
    }))).toThrow(/unsupported verdict/);

    expect(() => parseVisitNotePocAlignmentLlmJson(JSON.stringify({
      verdict: "aligned",
      confidence: 0.8,
      visitNoteFactIds: [],
      pocEvidenceIds: [],
      rationale: "Fallback to row text heuristics only when direct control selectors are absent.",
    }))).toThrow(/rationale/);
  });

  it("prompts for contradiction versus plausible progress classification", () => {
    const prompt = buildVisitNotePocAlignmentPrompt({ visitType: "physical_therapy", factCount: 4 });
    expect(prompt).toContain("positive_progress");
    expect(prompt).toContain("possible_update_needed");
    expect(prompt).toContain("not automatic contradiction");
  });

  it("parses Visit Note to POC mapping output", () => {
    const result = parseVisitNotePocMappingLlmJson(JSON.stringify({
      alignmentStatus: "aligned",
      matchStrength: 0.87,
      matchedPocItems: [{
        problemKey: "mobility",
        problemTitle: "Mobility limitation",
        goalTexts: ["Improve transfers"],
        interventionTexts: ["Skilled PT gait training"],
        evidenceIds: ["poc-goal-1"],
      }],
      visitNoteEvidence: ["visit-note-fact-1"],
      rationale: "The note documents gait training tied to the mobility intervention.",
      missingDocumentation: [],
      contradictions: [],
      pocUpdateSignals: [],
    }), "visit-note-1");

    expect(result.visitNoteKey).toBe("visit-note-1");
    expect(result.matchedPocItems[0]?.problemKey).toBe("mobility");
    expect(result.alignmentStatus).toBe("aligned");
  });

  it("parses insufficient documentation and contradiction mapping statuses", () => {
    expect(parseVisitNotePocMappingLlmJson(JSON.stringify({
      alignmentStatus: "insufficient_documentation",
      matchStrength: 0.2,
      matchedPocItems: [],
      visitNoteEvidence: [],
      rationale: "The note does not contain enough clinical detail to map to the POC.",
      missingDocumentation: ["No intervention detail"],
      contradictions: [],
      pocUpdateSignals: [],
    }))).toMatchObject({ alignmentStatus: "insufficient_documentation" });

    expect(parseVisitNotePocMappingLlmJson(JSON.stringify({
      alignmentStatus: "contradiction",
      matchStrength: 0.91,
      matchedPocItems: [],
      visitNoteEvidence: ["visit-note-fact-1"],
      rationale: "The note states independent ambulation while the POC documents chair-bound status.",
      missingDocumentation: [],
      contradictions: ["Mobility status conflicts"],
      pocUpdateSignals: ["mobility-improvement"],
    }))).toMatchObject({ alignmentStatus: "contradiction" });
  });
});
