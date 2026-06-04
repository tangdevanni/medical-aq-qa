import { describe, expect, it } from "vitest";
import {
  buildVisitNotePocAlignmentPrompt,
  buildVisitNoteTextInputSuggestionPrompt,
  parseVisitNotePocAlignmentLlmJson,
  parseVisitNotePocMappingLlmJson,
  parseVisitNoteTextInputSuggestionsLlmJson,
  type VisitNoteTextInputSuggestionCandidate,
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

  it("keeps Visit Note text suggestions source-backed to clinician-entered note text", () => {
    const candidate: VisitNoteTextInputSuggestionCandidate = {
      suggestionId: "visit-note-suggestion:note-1:planForNextVisitComment",
      visitNoteKey: "note-1",
      fieldKey: "planForNextVisitComment",
      fieldLabel: "Plan for Next Visit",
      sectionLabel: "Visit Summary and Care Planning",
      currentValue: "Patient completed 75 ft gait training with FWW and vc/tc for pacing and stability.",
      reason: "too_short",
      relatedPocProblemTitle: null,
      sourceFactIds: ["fact-1"],
      confidence: 0.9,
      detailsToPreserve: ["75 ft", "FWW", "vc/tc"],
      sourceTexts: ["Patient completed 75 ft gait training with FWW and vc/tc for pacing and stability."],
    };

    const suggestions = parseVisitNoteTextInputSuggestionsLlmJson(JSON.stringify({
      suggestions: [
        {
          suggestionId: candidate.suggestionId,
          suggestedInput: "Continue skilled PT for weakness and safe mobility. Reassess gait with the walker and how the patient responds to cueing.",
        },
        {
          suggestionId: candidate.suggestionId,
          suggestedInput: "Patient completed 75 ft gait training with FWW and vc/tc for pacing and stability.",
        },
      ],
    }), [candidate]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.suggestedInput).toBe("Patient completed 75 ft gait training with FWW and vc/tc for pacing and stability.");
  });

  it("does not include POC text in Visit Note suggestion source prompts", () => {
    const prompt = buildVisitNoteTextInputSuggestionPrompt({
      visitNoteKey: "note-1",
      visitType: "physical_therapy",
      status: "In Progress",
      facts: [],
      matchedPocItems: [{
        problemKey: "mobility",
        problemTitle: "Mobility limitation",
        goalTexts: ["Improve safe transfers"],
        interventionTexts: ["Skilled PT gait training"],
        evidenceIds: ["poc-1"],
      }],
      candidates: [{
        suggestionId: "visit-note-suggestion:note-1:planForNextVisitComment",
        visitNoteKey: "note-1",
        fieldKey: "planForNextVisitComment",
        fieldLabel: "Plan for Next Visit",
        sectionLabel: "Visit Summary and Care Planning",
        currentValue: "Patient completed 75 ft gait training with FWW and vc/tc.",
        reason: "too_short",
        relatedPocProblemTitle: "Mobility limitation",
        sourceFactIds: [],
        confidence: 0.9,
      }],
    });

    expect(prompt).toContain("sourceTexts");
    expect(prompt).toContain("Do not use Plan of Care, referral, or OASIS content");
    expect(prompt).not.toContain("MATCHED_PLAN_OF_CARE");
    expect(prompt).not.toContain("Improve safe transfers");
  });
});
