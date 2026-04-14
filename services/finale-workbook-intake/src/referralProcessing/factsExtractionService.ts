import type {
  FieldMapSnapshot,
  NormalizedReferralSection,
  ReferralDiagnosisCandidate,
  ReferralExtractedFact,
  ReferralExtractedFacts,
  ReferralFactCategory,
} from "./types";

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizePersonName(value: string | null | undefined): string | null {
  const normalized = normalizeWhitespace(value)
    ?.replace(/^(?:Resident\/Self|Self)\s+/i, "")
    .replace(/\s+\./g, ".")
    .replace(/[.,]\s*$/, "")
    .trim();
  if (!normalized) {
    return null;
  }
  if (/^(?:Preferred Name|Resident Name|Patient Name|Unit|Room ?\/ ?Bed|Contact Type|Relationship|Name|Phone\/Email)$/i.test(normalized)) {
    return null;
  }
  if (/\b(?:Contact Type|Relationship|Admission Date|Room ?\/ ?Bed|Previous address)\b/i.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeDateValue(value: string): string {
  const match = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (!match) {
    return value;
  }
  const month = match[1].padStart(2, "0");
  const day = match[2].padStart(2, "0");
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${month}/${day}/${year}`;
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = normalizeWhitespace(match?.[1]);
    if (value) {
      return value;
    }
  }
  return null;
}

function buildSectionLookup(sections: NormalizedReferralSection[]): Map<string, NormalizedReferralSection> {
  return new Map(sections.map((section) => [section.sectionName, section]));
}

function findSectionText(
  lookup: Map<string, NormalizedReferralSection>,
  ...sectionNames: string[]
): string {
  const spans = sectionNames.flatMap((sectionName) => lookup.get(sectionName)?.extractedTextSpans ?? []);
  return Array.from(new Set(spans.map((span) => normalizeWhitespace(span)).filter(Boolean))).join(" ");
}

function findSectionSummary(
  lookup: Map<string, NormalizedReferralSection>,
  ...sectionNames: string[]
): string {
  return sectionNames
    .map((sectionName) => lookup.get(sectionName)?.normalizedSummary ?? "")
    .filter(Boolean)
    .join(" ");
}

function trimOperationalInstructionSuffix(value: string | null | undefined): string | null {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }

  const withoutOperationalSuffix = normalized
    .replace(/\bPlease send (?:pt|patient) home with all remaining medications(?: including narcs)?\b.*$/i, "")
    .replace(/\bPlease send (?:the )?patient home with\b.*$/i, "")
    .replace(/\bSend (?:pt|patient) home with all remaining medications(?: including narcs)?\b.*$/i, "");

  const trimmed = withoutOperationalSuffix !== normalized
    ? withoutOperationalSuffix.replace(/[;:,.\s]+$/g, "").trim()
    : normalized;

  return trimmed || null;
}

function extractOrderSummary(text: string): string | null {
  return trimOperationalInstructionSuffix(firstMatch(text, [
    /\bOrder Summary:\s*(.+?)(?:Confirmed By|Ordered By Signature|Signed Date|Primary Lang\.?|Preferred Language|Interpreter Needed|CONTACTS|PHARMACY|Admitted From|DIAGNOSIS INFORMATION|ADVANCE DIRECTIVE|Precautions Details|Fax Server\s+\d|$)/is,
    /\bOrder Summary\s*(.+?)(?:Confirmed By|Ordered By Signature|Signed Date|Primary Lang\.?|Preferred Language|Interpreter Needed|CONTACTS|PHARMACY|Admitted From|DIAGNOSIS INFORMATION|ADVANCE DIRECTIVE|Precautions Details|Fax Server\s+\d|$)/is,
  ]));
}

function extractMedicalNecessitySummary(text: string): string | null {
  return extractOrderSummary(text) ?? trimOperationalInstructionSuffix(firstMatch(text, [
    /\bPrimary Reason for Home Health\s*\/\s*Medical Necessity\s*(.+?)(?:Homebound Status|Diagnosis Information|Medications|Allergies|$)/is,
    /\bMedical Necessity\s*(.+?)(?:Homebound Status|Diagnosis Information|Medications|Allergies|$)/is,
    /\bReason for Home Health\s*(.+?)(?:Homebound Status|Diagnosis Information|Medications|Allergies|$)/is,
  ]));
}

function extractLivingSituation(text: string): string | null {
  const directStatement = firstMatch(text, [
    /\b(?:Lives with|Living Situation|Current Living Arrangement)\s*[:\-]?\s*([A-Za-z0-9 ,.()'-]{3,180})/i,
  ]);
  if (directStatement) {
    return directStatement;
  }

  const dischargeDestination = firstMatch(text, [
    /\bdischarge(?:d)? to\s+(home|alf|ilf|assisted living(?: facility)?|independent living(?: facility)?|family|daughter(?:'s)? home|son(?:'s)? home|spouse(?:'s)? home)\b/i,
  ]);
  if (dischargeDestination) {
    return dischargeDestination;
  }

  return firstMatch(text, [
    /\b(?:ALF|ILF|assisted living facility|independent living facility)\b.{0,160}/i,
  ]);
}

function extractPreferredLanguage(text: string): string | null {
  return firstMatch(text, [
    /\b(?:Preferred Language|Primary Lang\.?)\s*[:\-]?\s*(English|Spanish|French|German|Mandarin|Cantonese|Arabic|Hindi|Russian|Vietnamese|Tagalog)\b/i,
    /\bPrimary Lang\.?.{0,120}\b(English|Spanish|French|German|Mandarin|Cantonese|Arabic|Hindi|Russian|Vietnamese|Tagalog)\b/i,
  ]);
}

function extractPatientName(text: string): string | null {
  return normalizePersonName(firstMatch(text, [
    /\bResident:\s*([A-Z][A-Z' -]+,\s*[A-Z][A-Z .'-]{1,80}?)(?:\s*\(|\s+DOB|\s+To:|$)/i,
    /\bPatient Name\s*[:\-]?\s*([A-Z][A-Z' -]+,\s*[A-Z][A-Z .'-]{1,80}?)(?:\s*\(|\s+DOB|\s+To:|$)/i,
    /\bResident #\s*([A-Z][A-Z' -]+,\s*[A-Z][A-Z .'-]{1,80}?)(?:\.\s+\d{3}|\s+\d{3}| Previous address| Sex Birthdate| DOB|$)/i,
    /\bResident Name\b(?:.*?\bResident #\b)?\s*([A-Z][A-Z' -]+,\s*[A-Z][A-Z .'-]{1,80}?)(?:\.\s+\d{3}|\s+\d{3}| Previous address| Sex Birthdate| DOB|$)/i,
  ]));
}

function extractContactsBlock(text: string): string {
  return firstMatch(text, [
    /\bCONTACTS\b(.+?)(?:\bDIAGNOSIS INFORMATION\b|\bADVANCE DIRECTIVE\b|\bMISCELLANEOUS INFORMATION\b|\bOrder Summary Report\b|$)/is,
  ]) ?? text;
}

function extractCaregiver(text: string): {
  name: string | null;
  relationship: string | null;
  phone: string | null;
} {
  const contactsBlock = extractContactsBlock(text);
  const contactMatches = [...contactsBlock.matchAll(
    /\b([A-Z][A-Z' -]+,\s*[A-Z][A-Z .'-]{1,80})\s+(?:Financial Responsible Party\s+)?(Daughter|Son|Spouse|Wife|Husband|Sister|Brother|Friend|Caregiver|Responsible Party|Resident\/Self|Self)\s+(?:Cell|Phone)[:\s]*(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\d{10})/gi,
  )];
  const nonSelfContact = contactMatches.find((match) => !/\b(?:self|resident\/self|responsible party)\b/i.test(match[2]));
  const selected = nonSelfContact ?? null;
  if (selected) {
    return {
      name: normalizePersonName(selected[1]),
      relationship: normalizeWhitespace(selected[2]),
      phone: normalizeWhitespace(selected[3]),
    };
  }

  return {
    name: normalizePersonName(firstMatch(contactsBlock, [/\bPrimary Caregiver\s*[:\-]?\s*([A-Z][A-Za-z ,.'-]+)/i])),
    relationship: firstMatch(text, [/\bRelationship\s*[:\-]?\s*(Daughter|Son|Spouse|Wife|Husband|Sister|Brother|Friend|Caregiver)\b/i]),
    phone: firstMatch(text, [/\b(?:Caregiver Phone|Caregiver Cell)\s*[:\-]?\s*(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i]),
  };
}

function extractDiagnosisCandidates(text: string): ReferralDiagnosisCandidate[] {
  const candidates: ReferralDiagnosisCandidate[] = [];
  const seen = new Set<string>();
  const patterns = [
    /\b([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)\s+([A-Z][A-Z0-9 ,()/-]{3,120}?)\s+\d{2}\/\d{2}\/\d{4}\s+(Primary|\d+|Other)\b/gi,
    /\b([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)\s*[-:)]\s*([A-Z][A-Z0-9 ,()/-]{3,120})\b/gi,
    /\b([A-Z][A-Z0-9 ,()/-]{3,120})\(([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)\)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const icd10Code = /^[A-TV-Z]/i.test(match[1]) ? match[1] : match[2];
      const description = /^[A-TV-Z]/i.test(match[1]) ? match[2] : match[1];
      const key = `${icd10Code}:${description}`.toUpperCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push({
        description: normalizeWhitespace(description),
        icd10_code: normalizeWhitespace(icd10Code).toUpperCase(),
        confidence: 0.74,
        source_spans: [normalizeWhitespace(match[0])],
        is_primary_candidate: candidates.length === 0 || /\bPrimary\b/i.test(match[3] ?? ""),
        requires_human_review: true,
      });
      if (candidates.length >= 8) {
        return candidates;
      }
    }
  }

  return candidates;
}

function addFact(input: {
  facts: ReferralExtractedFact[];
  unsupported: string[];
  factKey: string;
  category: ReferralFactCategory;
  value: unknown;
  confidence: number;
  evidenceSpans: string[];
  rationale: string;
  sourceSections?: string[];
  requiresHumanReview?: boolean;
}): void {
  const isMissing = input.value === null ||
    input.value === undefined ||
    input.value === "" ||
    (Array.isArray(input.value) && input.value.length === 0);

  if (isMissing) {
    input.unsupported.push(input.factKey);
    return;
  }

  input.facts.push({
    fact_key: input.factKey,
    category: input.category,
    value: input.value,
    confidence: input.confidence,
    evidence_spans: input.evidenceSpans.slice(0, 6),
    rationale: input.rationale,
    source_sections: input.sourceSections ?? [],
    requires_human_review: input.requiresHumanReview ?? true,
  });
}

export function buildReferralFactLookup(facts: ReferralExtractedFact[]): Map<string, ReferralExtractedFact> {
  return new Map(facts.map((fact) => [fact.fact_key, fact]));
}

export function extractReferralFacts(input: {
  fieldMapSnapshot: FieldMapSnapshot;
  sections: NormalizedReferralSection[];
  sourceText: string;
}): ReferralExtractedFacts {
  const sectionLookup = buildSectionLookup(input.sections);
  const facts: ReferralExtractedFact[] = [];
  const unsupportedOrMissingFields: string[] = [];

  const patientName = extractPatientName(input.sourceText);
  const dob = firstMatch(input.sourceText, [/\b(?:DOB|Birth Date|Birthdate)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i]);
  const referralDate = firstMatch(input.sourceText, [/\b(?:Date of Referral|Referral Date|Order Date)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i]);
  const caregiver = extractCaregiver(input.sourceText);
  const preferredLanguage = extractPreferredLanguage(input.sourceText);
  const interpreterNeeded = /\bInterpreter Needed\s*[:\-]?\s*Yes\b/i.test(input.sourceText)
    ? true
    : /\bInterpreter Needed\s*[:\-]?\s*No\b/i.test(input.sourceText)
      ? false
      : null;
  const dischargeDate = firstMatch(input.sourceText, [
    /\b(?:Discharge Date|M1005)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /\bdischarge home on\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  ]);
  const dischargeFacility = firstMatch(input.sourceText, [
    /\bAcute care hospital\s+([A-Z0-9 &'.,-]{3,120}?)\s+(?:Medicare Beneficiary|Medicaid|Social Security|Medical Record)\b/i,
    /\b(?:Discharged from|Recent Inpatient Facilities?)\s*[:\-]?\s*([A-Za-z0-9 &'.,()-]{3,120})/i,
  ]);
  const codeStatus = /\b(?:ADVANCE DIRECTIVE\s+)?CPR\s*\/\s*Full Code\b/i.test(input.sourceText) || /\bfull code\b/i.test(input.sourceText)
    ? "full_code"
    : /\bdnr\b/i.test(input.sourceText)
      ? "dnr"
      : null;

  const orderSummary = extractOrderSummary(input.sourceText);
  const medicalNecessitySummary =
    extractMedicalNecessitySummary(input.sourceText) ||
    trimOperationalInstructionSuffix(findSectionSummary(sectionLookup, "primary_reason_for_home_health", "medical_necessity"));
  const homeboundSummary = findSectionText(sectionLookup, "homebound_evidence") || findSectionSummary(sectionLookup, "homebound_evidence");
  const homeboundSupportingFactors = homeboundSummary
    ? Array.from(new Set(
        [
          /\bwalker\b/i.test(homeboundSummary) ? "uses_walker" : null,
          /\brequires assistance\b/i.test(homeboundSummary) ? "needs_assistance" : null,
          /\bunsteady gait\b/i.test(homeboundSummary) ? "unsteady_gait" : null,
          /\bleaving home is exhausting\b/i.test(homeboundSummary) ? "exhausting_to_leave_home" : null,
        ].filter((value): value is string => Boolean(value)),
      ))
    : [];
  const livingSituationSummary = extractLivingSituation(input.sourceText);
  const functionalSectionText = findSectionText(sectionLookup, "functional_limitations");
  const functionalSummary = functionalSectionText || findSectionSummary(sectionLookup, "functional_limitations");
  const functionalLimitations = functionalSummary
    ? Array.from(new Set(
        [
          /\bweakness\b/i.test(functionalSummary) ? "weakness" : null,
          /\bdifficulty(?:\s+in)?\s+walking\b/i.test(functionalSummary) ? "difficulty_walking" : null,
          /\bambulation\b/i.test(functionalSummary) ? "ambulation_limitations" : null,
          /\bendurance\b/i.test(functionalSummary) ? "reduced_endurance" : null,
        ].filter((value): value is string => Boolean(value)),
      ))
    : [];
  const therapySummary = firstMatch(input.sourceText, [
    /\b(HH PT\/OT eval and treat as indicated)\b/i,
    /\b(PT\/OT[^.]{0,220})/i,
    /\b(physical therapy[^.]{0,220})/i,
  ]) || findSectionSummary(sectionLookup, "therapy_need");
  const riskSummary = firstMatch(input.sourceText, [
    /\b(Precautions Details:\s*Falls[^.]{0,260})/i,
    /\b(Falls,\s*[^.]{0,260})/i,
  ]) || findSectionSummary(sectionLookup, "risk_factors", "functional_limitations");
  const diagnosisCandidates = extractDiagnosisCandidates(input.sourceText);

  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "referral_date",
    category: "patient_context",
    value: referralDate ? normalizeDateValue(referralDate) : null,
    confidence: 0.94,
    evidenceSpans: referralDate ? [referralDate] : [],
    rationale: "Referral date was identified in referral metadata.",
    sourceSections: ["referral_metadata"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "preferred_language",
    category: "patient_context",
    value: preferredLanguage,
    confidence: 0.92,
    evidenceSpans: preferredLanguage ? [preferredLanguage] : [],
    rationale: "Preferred language was identified in referral demographics.",
    sourceSections: ["patient_identity"],
    requiresHumanReview: false,
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "interpreter_needed",
    category: "patient_context",
    value: interpreterNeeded,
    confidence: 0.82,
    evidenceSpans: interpreterNeeded !== null ? [`Interpreter Needed: ${interpreterNeeded ? "Yes" : "No"}`] : [],
    rationale: "Interpreter need was identified in referral demographics.",
    sourceSections: ["patient_identity"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "recent_hospitalization_discharge_date",
    category: "hospitalization",
    value: dischargeDate ? normalizeDateValue(dischargeDate) : null,
    confidence: 0.9,
    evidenceSpans: dischargeDate ? [dischargeDate] : [],
    rationale: "Recent discharge date was identified in referral or hospitalization history.",
    sourceSections: ["hospitalization_history"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "recent_hospitalization_facility",
    category: "hospitalization",
    value: dischargeFacility,
    confidence: 0.78,
    evidenceSpans: dischargeFacility ? [dischargeFacility] : [],
    rationale: "Recent inpatient facility was identified in referral history.",
    sourceSections: ["hospitalization_history"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "caregiver_name",
    category: "caregiver",
    value: caregiver.name,
    confidence: 0.88,
    evidenceSpans: caregiver.name ? [caregiver.name] : [],
    rationale: "Caregiver name was identified in referral caregiver evidence.",
    sourceSections: ["caregiver_support"],
    requiresHumanReview: false,
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "caregiver_relationship",
    category: "caregiver",
    value: caregiver.relationship,
    confidence: 0.85,
    evidenceSpans: caregiver.relationship ? [caregiver.relationship] : [],
    rationale: "Caregiver relationship was identified in referral caregiver evidence.",
    sourceSections: ["caregiver_support"],
    requiresHumanReview: false,
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "caregiver_phone",
    category: "caregiver",
    value: caregiver.phone,
    confidence: 0.8,
    evidenceSpans: caregiver.phone ? [caregiver.phone] : [],
    rationale: "Caregiver phone number was identified in referral caregiver evidence.",
    sourceSections: ["caregiver_support"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "code_status",
    category: "directive",
    value: codeStatus,
    confidence: 0.75,
    evidenceSpans: codeStatus ? [`Code status: ${codeStatus}`] : [],
    rationale: "Code status was explicitly stated in referral text.",
    sourceSections: ["code_status", "advance_directives"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "order_summary",
    category: "medical_necessity",
    value: orderSummary,
    confidence: 0.82,
    evidenceSpans: orderSummary ? [orderSummary] : [],
    rationale: "Order summary was extracted from referral instructions.",
    sourceSections: ["primary_reason_for_home_health", "medical_necessity"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "medical_necessity_summary",
    category: "medical_necessity",
    value: medicalNecessitySummary,
    confidence: 0.78,
    evidenceSpans: medicalNecessitySummary ? [medicalNecessitySummary] : [],
    rationale: "Medical necessity was summarized from referral narrative and skilled-need evidence.",
    sourceSections: ["primary_reason_for_home_health", "medical_necessity"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "homebound_narrative",
    category: "homebound",
    value: homeboundSummary || null,
    confidence: 0.8,
    evidenceSpans: homeboundSummary ? [homeboundSummary] : [],
    rationale: "Homebound evidence was summarized from referral text.",
    sourceSections: ["homebound_evidence"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "homebound_supporting_factors",
    category: "homebound",
    value: homeboundSupportingFactors,
    confidence: 0.73,
    evidenceSpans: homeboundSummary ? [homeboundSummary] : [],
    rationale: "Homebound supporting factors were extracted from referral text.",
    sourceSections: ["homebound_evidence"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "living_situation",
    category: "living_situation",
    value: livingSituationSummary || null,
    confidence: 0.72,
    evidenceSpans: livingSituationSummary ? [livingSituationSummary] : [],
    rationale: "Living situation was summarized from referral text.",
    sourceSections: ["living_situation"],
    requiresHumanReview: false,
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "functional_limitations",
    category: "functional",
    value: functionalLimitations,
    confidence: 0.76,
    evidenceSpans: functionalSummary ? [functionalSummary] : [],
    rationale: "Functional limitations were extracted from referral text.",
    sourceSections: ["functional_limitations"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "therapy_need",
    category: "therapy",
    value: therapySummary || null,
    confidence: 0.77,
    evidenceSpans: therapySummary ? [therapySummary] : [],
    rationale: "Therapy need was summarized from referral text.",
    sourceSections: ["therapy_need"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "fall_risk_narrative",
    category: "risk",
    value: riskSummary || null,
    confidence: 0.7,
    evidenceSpans: riskSummary ? [riskSummary] : [],
    rationale: "Risk and safety narrative was summarized from referral text.",
    sourceSections: ["risk_factors", "functional_limitations"],
  });

  for (const field of input.fieldMapSnapshot.candidate_fields_for_llm_inference_from_referral) {
    if (field === "diagnosis_candidates") {
      continue;
    }
    if (!facts.some((fact) => fact.fact_key === field)) {
      unsupportedOrMissingFields.push(field);
    }
  }

  return {
    patient_context: {
      patient_name: patientName,
      dob: dob ? normalizeDateValue(dob) : null,
      soc_date: typeof input.fieldMapSnapshot.fields.find((field) => field.key === "soc_date")?.currentChartValue === "string"
        ? String(input.fieldMapSnapshot.fields.find((field) => field.key === "soc_date")?.currentChartValue ?? null)
        : null,
      referral_date: referralDate ? normalizeDateValue(referralDate) : null,
    },
    facts,
    diagnosis_candidates: diagnosisCandidates,
    caregiver_candidates: caregiver.name
      ? [{
          caregiver_name: caregiver.name,
          caregiver_relationship: caregiver.relationship,
          caregiver_phone: caregiver.phone,
        }]
      : [],
    unsupported_or_missing_fields: Array.from(new Set(unsupportedOrMissingFields)),
    warnings: ["Deterministic referral facts extraction was used."],
  };
}
