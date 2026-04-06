import assert from "node:assert/strict";
import { documentExtractionSchema } from "@medical-ai-qa/shared-types";
import { detectDocumentKindFromSignals } from "../extractors/detectDocumentKind";
import { applySectionSummaries } from "../extractors/shared/extractionHelpers";
import { hasMeaningfulDocumentContent } from "../extractors/shared/meaningfulContent";
import { sanitizeDocumentText, sanitizeDocumentTitle } from "../extractors/shared/sanitizeText";

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "detectDocumentKindFromSignals prefers the visit-note route when it is present",
    run: () => {
      const result = detectDocumentKindFromSignals({
        url: "https://example.test/documents/note/visitnote/123",
        title: "Therapy Visit Note",
        headings: ["Subjective Info", "Visit Summary"],
        fieldLabels: [],
        sectionHeaders: ["Subjective Info", "Visit Summary"],
        statusTexts: ["Signed"],
      });

      assert.equal(result.documentKind, "VISIT_NOTE");
      assert.equal(result.pageType, "visit_note");
      assert.equal(result.warnings.length, 0);
    },
  },
  {
    name: "detectDocumentKindFromSignals identifies OASIS from structural headings",
    run: () => {
      const result = detectDocumentKindFromSignals({
        url: "https://example.test/documents/work-item/123",
        title: "OASIS Review",
        headings: ["Clinical Assessment", "Functional Status"],
        fieldLabels: ["Patient History"],
        sectionHeaders: ["Clinical Assessment", "Functional Status"],
        statusTexts: [],
      });

      assert.equal(result.documentKind, "OASIS");
      assert.equal(result.pageType, "oasis");
    },
  },
  {
    name: "detectDocumentKindFromSignals uses expected kinds to stabilize non-visit detection",
    run: () => {
      const result = detectDocumentKindFromSignals({
        url: "https://example.test/documents/order/123",
        title: "Admission Order",
        headings: ["Diagnosis Reference", "Order Text"],
        fieldLabels: ["Order Date"],
        sectionHeaders: ["Admission Order"],
        statusTexts: [],
      }, {
        expectedDocumentKinds: ["ADMISSION_ORDER", "PHYSICIAN_ORDER"],
      });

      assert.equal(result.documentKind, "ADMISSION_ORDER");
    },
  },
  {
    name: "detectDocumentKindFromSignals returns UNKNOWN when signals are ambiguous",
    run: () => {
      const result = detectDocumentKindFromSignals({
        url: "https://example.test/documents/order/123",
        title: "Plan of Care Physician Order",
        headings: ["Certification Period", "Order Type"],
        fieldLabels: [],
        sectionHeaders: ["Certification Period", "Order Type"],
        statusTexts: [],
      });

      assert.equal(result.documentKind, "UNKNOWN");
      assert.equal(result.warnings[0]?.code, "document_kind_ambiguous");
    },
  },
  {
    name: "hasMeaningfulDocumentContent stays conservative for placeholders and short labels",
    run: () => {
      assert.equal(hasMeaningfulDocumentContent("N/A"), false);
      assert.equal(hasMeaningfulDocumentContent("Diagnosis", { label: "Diagnosis" }), false);
      assert.equal(hasMeaningfulDocumentContent("Mild pain", { minimumLength: 24 }), false);
      assert.equal(
        hasMeaningfulDocumentContent("Patient has ongoing mobility decline and requires assistive device.", {
          label: "Clinical Assessment",
          minimumLength: 24,
        }),
        true,
      );
    },
  },
  {
    name: "sanitizeDocumentTitle keeps the document segment and drops unrelated title noise",
    run: () => {
      assert.equal(
        sanitizeDocumentTitle("Jane Doe - Plan of Care - Finale Health", ["PLAN_OF_CARE"]),
        "Plan of Care",
      );
    },
  },
  {
    name: "sanitizeDocumentText redacts dates and long identifiers",
    run: () => {
      assert.equal(
        sanitizeDocumentText("Order entered 03/24/2026 under 123456789.", 80),
        "Order entered [date] under [id].",
      );
    },
  },
  {
    name: "applySectionSummaries fills comparison anchors without relying on exported samples",
    run: () => {
      const metadata = applySectionSummaries({
        pageTitle: "Plan of Care",
        documentLabel: "Plan of Care",
        patientMaskedId: null,
        visitDate: null,
        physician: null,
        signedState: null,
        diagnosisSummary: null,
        frequencySummary: null,
        homeboundSummary: null,
        orderSummary: null,
      }, [
        {
          section: {
            id: "diagnosis",
            label: "Diagnosis",
            present: true,
            visible: true,
            textLength: 40,
            hasMeaningfulContent: true,
            sample: null,
          },
          summaryField: "diagnosisSummary",
          summaryCandidate: "Chronic gait instability and weakness.",
        },
      ]);

      assert.equal(metadata.diagnosisSummary, "Chronic gait instability and weakness.");
    },
  },
  {
    name: "documentExtractionSchema validates the normalized output contract",
    run: () => {
      const parsed = documentExtractionSchema.parse({
        documentKind: "PLAN_OF_CARE",
        pageType: "plan_of_care",
        url: "https://example.test/documents/planofcare/123",
        extractedAt: "2026-03-24T00:00:00.000Z",
        metadata: {
          pageTitle: "Plan of Care",
          documentLabel: "Plan of Care",
          patientMaskedId: "***1234",
          visitDate: null,
          physician: "D*** S***",
          signedState: "signed",
          diagnosisSummary: null,
          frequencySummary: null,
          homeboundSummary: null,
          orderSummary: null,
        },
        sections: [
          {
            id: "certification-period",
            label: "Certification Period",
            present: true,
            visible: true,
            textLength: 42,
            hasMeaningfulContent: true,
            sample: null,
          },
        ],
        warnings: [],
      });

      assert.equal(parsed.documentKind, "PLAN_OF_CARE");
    },
  },
];

let passed = 0;

for (const entry of tests) {
  entry.run();
  passed += 1;
}

console.log(`document-extraction tests passed: ${passed}/${tests.length}`);
