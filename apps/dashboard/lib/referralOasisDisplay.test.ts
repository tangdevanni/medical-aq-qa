import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReferralOasisCategoryModel,
  cleanDiagnosisDescription,
  cleanOasisDisplayLabel,
  formatClinicalSourceDate,
  REFERRAL_OASIS_GROUPS,
} from "./referralOasisDisplay";

test("formats OASIS source timestamps as dates", () => {
  assert.equal(formatClinicalSourceDate("2026-06-04T11:19:35.092Z"), "2026-06-04");
  assert.equal(formatClinicalSourceDate("05/19/2026"), "05/19/2026");
  assert.equal(formatClinicalSourceDate(null), null);
});

test("cleans diagnosis labels without treating generic roles as descriptions", () => {
  assert.equal(cleanOasisDisplayLabel("ICD-10 Code"), "Diagnosis Code");
  assert.equal(cleanOasisDisplayLabel("Z47.89 - PRIMARY DIAGNOSIS 🩺 ICD-10 Code"), "Z47.89");
  assert.equal(cleanOasisDisplayLabel("M75.121 - OTHER DIAGNOSIS - 1 ICD-10 Code"), "M75.121");
  assert.equal(cleanDiagnosisDescription("PRIMARY DIAGNOSIS 🩺 ICD-10 Code", "Z47.89"), null);
  assert.equal(
    cleanDiagnosisDescription("Z47.89 - Orthopedic aftercare located on the right shoulder.", "Z47.89"),
    "Orthopedic aftercare located on the right shoulder.",
  );
});

test("cleans medication and allergy OASIS labels", () => {
  assert.equal(cleanOasisDisplayLabel("Allergies (POC Element):"), "Allergies");
  assert.equal(cleanOasisDisplayLabel("Medication (POC Element (§484.60 (2.x))): - NKE"), "Medication - NKE");
});

test("cleans safety and social support OASIS labels", () => {
  assert.equal(cleanOasisDisplayLabel("Emergency Preparedness (POC Element):"), "Emergency Preparedness");
  assert.equal(cleanOasisDisplayLabel("Caregiver Availability (POC Element (§484.60 (2.x))):"), "Caregiver Availability");
});

test("cleans functional and therapy OASIS labels", () => {
  assert.equal(cleanOasisDisplayLabel("Ambulation (POC Element (§484.60 (2.x))): - Device"), "Ambulation - Device");
  assert.equal(cleanOasisDisplayLabel("Therapy Need (POC Element):"), "Therapy Need");
});

test("cleans body systems OASIS labels", () => {
  assert.equal(cleanOasisDisplayLabel("Pain (POC Element):"), "Pain");
  assert.equal(cleanOasisDisplayLabel("Respiratory Status (POC Element (§484.60 (2.x))):"), "Respiratory Status");
});

test("builds diagnosis display from selected source summaries before row fallback", () => {
  const diagnosesGroup = REFERRAL_OASIS_GROUPS.find((group) => group.key === "diagnoses");
  assert.ok(diagnosesGroup);

  const model = buildReferralOasisCategoryModel({
    group: diagnosesGroup,
    referralRows: [],
    oasisRows: [],
    referralSummary: {
      diagnosisSummary: {
        primaryDiagnosis: {
          code: "S81.801A",
          normalizedIcd10Code: "S81.801A",
          description: "Traumatic wound of right lower leg",
          onsetDate: "2026-03-20",
          role: "primary",
          confidence: "high",
        },
        otherDiagnoses: [],
        diagnosisSource: "document_fact_pack",
      },
    },
    oasisSummary: {
      diagnosisSummary: {
        primaryDiagnosis: {
          code: "Z47.89",
          normalizedIcd10Code: "Z47.89",
          description: "Orthopedic aftercare",
          onsetDate: "2026-05-09",
          role: "primary",
          confidence: "dom",
        },
        otherDiagnoses: [],
        diagnosisSource: "portal_dom_state",
      },
    },
  });

  assert.equal(model.referralItems[0]?.label, "S81.801A - Traumatic wound of right lower leg");
  assert.equal(model.referralItems[0]?.value, "Onset: 2026-03-20");
  assert.equal(model.oasisItems[0]?.label, "Z47.89 - Orthopedic aftercare");
  assert.equal(model.oasisItems[0]?.value, "Onset: 2026-05-09");
});

test("shows OASIS diagnosis codes without borrowing descriptions from referral content", () => {
  const diagnosesGroup = REFERRAL_OASIS_GROUPS.find((group) => group.key === "diagnoses");
  assert.ok(diagnosesGroup);

  const model = buildReferralOasisCategoryModel({
    group: diagnosesGroup,
    referralRows: [],
    oasisRows: [],
    oasisSummary: {
      diagnosisSummary: {
        primaryDiagnosis: {
          code: "Z47.89",
          normalizedIcd10Code: "Z47.89",
          description: null,
          onsetDate: "2026-05-09",
          role: "primary",
          confidence: "dom",
        },
        otherDiagnoses: [],
        diagnosisSource: "portal_dom_state",
      },
    },
  });

  assert.equal(model.oasisItems[0]?.label, "Z47.89");
  assert.equal(model.oasisItems[0]?.value, "Onset: 2026-05-09");
  assert.equal(model.oasisItems[0]?.meta, "Primary | Description not captured");
});

test("does not promote OASIS patient identity header text as a diagnosis", () => {
  const diagnosesGroup = REFERRAL_OASIS_GROUPS.find((group) => group.key === "diagnoses");
  assert.ok(diagnosesGroup);

  const model = buildReferralOasisCategoryModel({
    group: diagnosesGroup,
    referralRows: [],
    oasisRows: [],
    oasisSummary: {
      diagnosisSummary: {
        primaryDiagnosis: {
          code: null,
          normalizedIcd10Code: null,
          description: "MACE, STEVEN",
          onsetDate: null,
          role: null,
          confidence: "dom",
        },
        otherDiagnoses: [],
        diagnosisSource: "portal_dom_state",
      },
    },
  });

  assert.equal(model.oasisItems.length, 0);
});

test("keeps OASIS diagnosis code while dropping patient identity text as description", () => {
  const diagnosesGroup = REFERRAL_OASIS_GROUPS.find((group) => group.key === "diagnoses");
  assert.ok(diagnosesGroup);

  const model = buildReferralOasisCategoryModel({
    group: diagnosesGroup,
    referralRows: [],
    oasisRows: [],
    oasisSummary: {
      diagnosisSummary: {
        primaryDiagnosis: {
          code: "Z47.89",
          normalizedIcd10Code: "Z47.89",
          description: "MACE, STEVEN",
          onsetDate: "2026-05-09",
          role: "primary",
          confidence: "dom",
        },
        otherDiagnoses: [],
        diagnosisSource: "portal_dom_state",
      },
    },
  });

  assert.equal(model.oasisItems.length, 1);
  assert.equal(model.oasisItems[0]?.label, "Z47.89");
  assert.equal(model.oasisItems[0]?.value, "Onset: 2026-05-09");
  assert.equal(model.oasisItems[0]?.meta, "Primary | Description not captured");
});

test("does not duplicate diagnosis summary entries with same-code row fallback", () => {
  const diagnosesGroup = REFERRAL_OASIS_GROUPS.find((group) => group.key === "diagnoses");
  assert.ok(diagnosesGroup);

  const model = buildReferralOasisCategoryModel({
    group: diagnosesGroup,
    referralRows: [],
    oasisRows: [{
      sectionKey: "diagnoses",
      sourceSectionLabel: "Diagnoses",
      fieldKey: "primary_diagnosis",
      fieldLabel: "Z47.89 - Encounter for other orthopedic aftercare ICD-10 Code",
      sectionLabel: "Diagnoses",
      displayReferralValue: "",
      displayPortalValue: "Z47.89",
      valuePresence: { hasChartValue: true },
    } as any],
    oasisSummary: {
      diagnosisSummary: {
        primaryDiagnosis: {
          code: "Z47.89",
          normalizedIcd10Code: "Z47.89",
          description: null,
          onsetDate: "2026-05-09",
          confidence: "dom",
        },
        otherDiagnoses: [],
        diagnosisSource: "portal_dom_state",
      },
    },
  });

  assert.equal(model.oasisItems.length, 1);
  assert.equal(model.oasisItems[0]?.label, "Z47.89");
});

test("builds medication display from selected source medication summaries", () => {
  const medicationGroup = REFERRAL_OASIS_GROUPS.find((group) => group.key === "medications_allergies");
  assert.ok(medicationGroup);

  const model = buildReferralOasisCategoryModel({
    group: medicationGroup,
    referralRows: [],
    oasisRows: [],
    referralSummary: {
      medicationSummary: {
        medications: [
          {
            name: "Acetaminophen",
            dose: "500 mg",
            route: "Oral",
            classification: "Analgesic",
            startDate: "2026-03-20",
            status: "active",
            source: "Direct-document referral",
          },
        ],
        allergies: [
          {
            name: "Penicillin",
            reaction: "Rash",
            startDate: null,
            status: "active",
            source: "Direct-document referral",
          },
        ],
        medicationSource: "direct_document_referral",
      },
    },
  });

  assert.equal(model.referralItems.length, 2);
  assert.equal(model.referralItems[0]?.label, "Acetaminophen");
  assert.equal(model.referralItems[0]?.meta, "500 mg | Oral | Analgesic | Start: 2026-03-20 | active");
  assert.equal(model.referralItems[1]?.label, "Allergy: Penicillin");
  assert.equal(model.referralItems[1]?.meta, "Reaction: Rash | active");
});

test("uses medication summaries instead of appending noisy same-source row fallback", () => {
  const medicationGroup = REFERRAL_OASIS_GROUPS.find((group) => group.key === "medications_allergies");
  assert.ok(medicationGroup);

  const model = buildReferralOasisCategoryModel({
    group: medicationGroup,
    referralRows: [{
      sectionKey: "medications_allergies",
      sourceSectionLabel: "Medications & Allergies",
      fieldKey: "medication_list",
      fieldLabel: "Medication",
      sectionLabel: "Medications & Allergies",
      displayReferralValue: "Acetaminophen",
      displayPortalValue: "",
      valuePresence: { hasDocumentValue: true },
    } as any, {
      sectionKey: "medications_allergies",
      sourceSectionLabel: "Medications & Allergies",
      fieldKey: "start_date",
      fieldLabel: "Start Date",
      sectionLabel: "Medications & Allergies",
      displayReferralValue: "Medication",
      displayPortalValue: "",
      valuePresence: { hasDocumentValue: true },
    } as any],
    oasisRows: [],
    referralSummary: {
      medicationSummary: {
        medications: [{
          name: "Acetaminophen",
          dose: null,
          route: null,
          classification: null,
          startDate: null,
          status: null,
          source: "Direct-document referral",
        }],
        allergies: [],
        medicationSource: "direct_document_referral",
      },
    },
  });

  assert.equal(model.referralItems.length, 1);
  assert.equal(model.referralItems[0]?.label, "Acetaminophen");
});

test("cleans generic medication and allergy fallback rows when summaries are unavailable", () => {
  const medicationGroup = REFERRAL_OASIS_GROUPS.find((group) => group.key === "medications_allergies");
  assert.ok(medicationGroup);

  const model = buildReferralOasisCategoryModel({
    group: medicationGroup,
    referralRows: [],
    oasisRows: [{
      sectionKey: "medications_allergies",
      sourceSectionLabel: "Medications & Allergies",
      fieldKey: "allergies",
      fieldLabel: "Allergies (POC Element):",
      sectionLabel: "Medications & Allergies",
      displayReferralValue: "",
      displayPortalValue: "No known drug allergies",
      valuePresence: { hasChartValue: true },
    } as any, {
      sectionKey: "medications_allergies",
      sourceSectionLabel: "Medications & Allergies",
      fieldKey: "medication",
      fieldLabel: "Medication (POC Element (§484.60 (2.x))):",
      sectionLabel: "Medications & Allergies",
      displayReferralValue: "",
      displayPortalValue: "Tamsulosin (Oral Pill)",
      valuePresence: { hasChartValue: true },
    } as any],
  });

  assert.equal(model.oasisItems.length, 2);
  assert.equal(model.oasisItems[0]?.label, "No known drug allergies");
  assert.equal(model.oasisItems[0]?.value, "Allergy");
  assert.equal(model.oasisItems[0]?.meta, null);
  assert.equal(model.oasisItems[1]?.label, "Tamsulosin (Oral Pill)");
  assert.equal(model.oasisItems[1]?.value, "Medication");
  assert.equal(model.oasisItems[1]?.meta, null);
});

test("omits table header echoes from row fallback display", () => {
  const medicationGroup = REFERRAL_OASIS_GROUPS.find((group) => group.key === "medications_allergies");
  assert.ok(medicationGroup);

  const model = buildReferralOasisCategoryModel({
    group: medicationGroup,
    referralRows: [],
    oasisRows: [{
      sectionKey: "medications_allergies",
      sourceSectionLabel: "Medications & Allergies",
      fieldKey: "start_date",
      fieldLabel: "Start Date",
      sectionLabel: "Medications & Allergies",
      displayReferralValue: "",
      displayPortalValue: "Medication | Strength / Dosage / Frequency | Route | Classification/Indication",
      valuePresence: { hasChartValue: true },
    } as any, {
      sectionKey: "medications_allergies",
      sourceSectionLabel: "Medications & Allergies",
      fieldKey: "medication",
      fieldLabel: "Medication",
      sectionLabel: "Medications & Allergies",
      displayReferralValue: "",
      displayPortalValue: "Oxycodone 5 mg Oral - Tablet",
      valuePresence: { hasChartValue: true },
    } as any],
  });

  assert.equal(model.oasisItems.length, 1);
  assert.equal(model.oasisItems[0]?.label, "Oxycodone 5 mg Oral - Tablet");
});

test("keeps non-summary clinical rows compact without repeated section metadata", () => {
  const bodySystemsGroup = REFERRAL_OASIS_GROUPS.find((group) => group.key === "body_systems");
  assert.ok(bodySystemsGroup);

  const model = buildReferralOasisCategoryModel({
    group: bodySystemsGroup,
    referralRows: [],
    oasisRows: [{
      sectionKey: "body_systems",
      sourceSectionLabel: "Body Systems",
      fieldKey: "pain",
      fieldLabel: "Pain (POC Element):",
      sectionLabel: "Body Systems",
      displayReferralValue: "",
      displayPortalValue: "Moderate pain in right shoulder",
      valuePresence: { hasChartValue: true },
    } as any],
  });

  assert.equal(model.oasisItems.length, 1);
  assert.equal(model.oasisItems[0]?.label, "Pain");
  assert.equal(model.oasisItems[0]?.value, "Moderate pain in right shoulder");
  assert.equal(model.oasisItems[0]?.meta, null);
});

test("selected source summaries produce different display rows for the same category", () => {
  const diagnosesGroup = REFERRAL_OASIS_GROUPS.find((group) => group.key === "diagnoses");
  assert.ok(diagnosesGroup);

  const first = buildReferralOasisCategoryModel({
    group: diagnosesGroup,
    referralRows: [],
    oasisRows: [],
    referralSummary: {
      diagnosisSummary: {
        primaryDiagnosis: {
          code: "S81.801A",
          normalizedIcd10Code: "S81.801A",
          description: "Right leg wound",
          confidence: "high",
        },
        otherDiagnoses: [],
        diagnosisSource: "document_fact_pack",
      },
    },
  });
  const second = buildReferralOasisCategoryModel({
    group: diagnosesGroup,
    referralRows: [],
    oasisRows: [],
    referralSummary: {
      diagnosisSummary: {
        primaryDiagnosis: {
          code: "I10",
          normalizedIcd10Code: "I10",
          description: "Hypertension",
          confidence: "high",
        },
        otherDiagnoses: [],
        diagnosisSource: "document_fact_pack",
      },
    },
  });

  assert.equal(first.referralItems[0]?.label, "S81.801A - Right leg wound");
  assert.equal(second.referralItems[0]?.label, "I10 - Hypertension");
});

test("cleans dates and admin OASIS labels", () => {
  assert.equal(cleanOasisDisplayLabel("Start of Care Date (POC Element):"), "Start of Care Date");
  assert.equal(cleanOasisDisplayLabel("Cert Period From (POC Element (§484.60 (2.x))):"), "Cert Period From");
});
