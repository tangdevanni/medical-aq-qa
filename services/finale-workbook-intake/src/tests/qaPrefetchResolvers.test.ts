import { describe, expect, it } from "vitest";
import {
  resolveQaDocumentRouteCandidates,
  selectQaDocumentRouteCandidate,
  summarizeQaSelectedRoute,
} from "../qa/navigation/qaDocumentRouteResolver";
import {
  detectQaLockStatus,
  resolveQaDiagnosisRoute,
} from "../qa/navigation/qaDiagnosisRouteResolver";
import { resolveQaOasisRoute } from "../qa/navigation/qaOasisRouteResolver";

describe("qa prefetch resolvers", () => {
  it("prefers a patient-specific file uploads route over a provider documents page", () => {
    const candidates = resolveQaDocumentRouteCandidates({
      currentUrl: "https://demo.portal/provider/branch/client/PT-1/intake",
      sidebarLabels: ["Calendar", "File Uploads", "Documents"],
      topVisibleText: ["Patient Dashboard"],
    });

    const selected = selectQaDocumentRouteCandidate(candidates);

    expect(selected?.classification).toBe("patient_documents");
    expect(summarizeQaSelectedRoute(selected)).toContain("patient documents");
  });

  it("surfaces diagnosis and oasis signals with visible diagnosis extraction", () => {
    const oasis = resolveQaOasisRoute({
      currentUrl: "https://demo.portal/provider/branch/client/PT-1/intake",
      sidebarLabels: ["OASIS", "File Uploads"],
      topVisibleText: ["Active Diagnoses", "J18.9 Pneumonia, unspecified organism"],
      buttonLabels: ["Unlock"],
    });
    const diagnosis = resolveQaDiagnosisRoute({
      currentUrl: "https://demo.portal/provider/branch/client/PT-1/intake",
      sidebarLabels: ["Active Diagnoses"],
      topVisibleText: ["Active Diagnoses", "J18.9 Pneumonia, unspecified organism"],
      interactiveLabels: ["Diagnosis List"],
    });
    const lockStatus = detectQaLockStatus({
      currentUrl: "https://demo.portal/provider/branch/client/PT-1/intake",
      buttonLabels: ["Unlock"],
      interactiveLabels: [],
      topVisibleText: [],
    });

    expect(oasis.found).toBe(true);
    expect(diagnosis.found).toBe(true);
    expect(diagnosis.visibleDiagnoses[0]?.code).toBe("J18.9");
    expect(lockStatus.status).toBe("locked");
  });
});
