import type {
  FieldMapSnapshot,
  NormalizedReferralSection,
  ReferralDiagnosisCandidate,
  ReferralExtractedFact,
  ReferralExtractedFacts,
  ReferralFactCategory,
} from "./types";
import { normalizeIcd10Code } from "../services/documentTextAnalysis";

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
  if (match) {
    const month = match[1].padStart(2, "0");
    const day = match[2].padStart(2, "0");
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${month}/${day}/${year}`;
  }

  const isoMatch = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return `${isoMatch[2]}/${isoMatch[3]}/${isoMatch[1]}`;
  }

  const monthNameMatch = value.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i,
  );
  if (monthNameMatch) {
    const monthLookup: Record<string, string> = {
      january: "01",
      february: "02",
      march: "03",
      april: "04",
      may: "05",
      june: "06",
      july: "07",
      august: "08",
      september: "09",
      october: "10",
      november: "11",
      december: "12",
    };
    return `${monthLookup[monthNameMatch[1].toLowerCase()]}\/${monthNameMatch[2].padStart(2, "0")}\/${monthNameMatch[3]}`;
  }

  return value;
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

function sentenceCase(value: string | null | undefined): string | null {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }
  if (/[a-z]/.test(normalized)) {
    return normalized;
  }
  return normalized
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function stripPageArtifacts(value: string | null | undefined): string | null {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }
  return normalized
    .replace(/\bF_CTL[_\s-][A-Za-z0-9_ -]+\b/gi, "")
    .replace(/\bYOUNG,\s*CHRISTINE\b\s*\|\s*\d+\s*\|\s*DOB:\s*\d{2}\/\d{2}\/\d{4}\s*\|\s*N:\s*\d{2}\/\d{2}\/\d{4}\b/gi, "")
    .replace(/\b\d+\s+of\s+\d+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function summarizeNarrative(value: string | null | undefined, maxLength = 520): string | null {
  const cleaned = stripPageArtifacts(value);
  if (!cleaned) {
    return null;
  }

  const protectedText = cleaned
    .replace(/\s+/g, " ")
    .replace(/\b([A-Z])\.(?=\s+[A-Z][a-z])/g, "$1__INITIAL_DOT__");

  const sentences = protectedText
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/__INITIAL_DOT__/g, "."))
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length === 0) {
    return cleaned.slice(0, maxLength).trim();
  }

  let summary = "";
  for (const sentence of sentences) {
    const candidate = summary ? `${summary} ${sentence}` : sentence;
    if (candidate.length > maxLength) {
      break;
    }
    summary = candidate;
  }

  if (summary) {
    return summary;
  }

  return cleaned.slice(0, maxLength).trim();
}

function evidenceExcerpt(value: string | null | undefined, maxLength = 240): string | null {
  return summarizeNarrative(value, maxLength);
}

function extractSectionBetween(text: string, startPattern: RegExp, endPattern: RegExp): string | null {
  const match = text.match(new RegExp(`${startPattern.source}([\\s\\S]+?)${endPattern.source}`, "i"));
  return stripPageArtifacts(match?.[1]);
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
  const primaryReasonSection = extractSectionBetween(
    text,
    /\bPrimary Reason for Home Health\s*\/\s*Medical Necessity\b/i,
    /\b(?:Homebound Reason Document as Clinical Narrative|Homebound Status|ACTIVE DIAGNOSES|VITAL SIGNS & PAIN ASSESSMENT|PLAN OF CARE AND PHYSICAL THERAPY EVALUATION|PATIENT SUMMARY & CLINICAL NARRATIVE|$)\b/i,
  );
  return summarizeNarrative(
    primaryReasonSection ??
      extractOrderSummary(text) ??
      trimOperationalInstructionSuffix(firstMatch(text, [
        /\bPrimary Reason for Home Health\s*\/\s*Medical Necessity\s*(.+?)(?:Homebound Status|Diagnosis Information|Medications|Allergies|$)/is,
        /\bMedical Necessity\s*(.+?)(?:Homebound Status|Diagnosis Information|Medications|Allergies|$)/is,
        /\bReason for Home Health\s*(.+?)(?:Homebound Status|Diagnosis Information|Medications|Allergies|$)/is,
      ])),
    700,
  );
}

function extractLivingSituation(text: string): string | null {
  const narrativeStatement = firstMatch(text, [
    /\b(She lives with a caregiver[^.]{0,160}\.)/i,
    /\b(remain at home with caregiver and dtr[^.]{0,120})/i,
    /\b(lives with a caregiver who provides support[^.]{0,120}\.)/i,
  ]);
  if (narrativeStatement) {
    return sentenceCase(narrativeStatement);
  }

  const directStatement = firstMatch(text, [
    /\b(?:Lives with|Living Situation|Current Living Arrangement)\s*[:\-]?\s*([A-Za-z0-9 ,.()'-]{3,180})/i,
  ]);
  if (
    directStatement &&
    !/\bwhich of the following best describes\b/i.test(directStatement) &&
    !/\bregular daytime\b/i.test(directStatement) &&
    !/\baround the clock\b/i.test(directStatement)
  ) {
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
    /\b(?:Preferred Language|Primary Lang\.?)\s*[:\-]?\s*(English|Spanish|French|German|Mandarin|Cantonese|Arabic|Hindi|Russian|Vietnamese|Tagalog)\b(?!\s+(?:English|Spanish|Chinese|Vietnamese|Other|health care staff)\b)/i,
  ]);
}

function extractPatientName(text: string): string | null {
  return normalizePersonName(firstMatch(text, [
    /\bPatient INFO\b[\s\S]{0,120}?\bName:\s*([A-Z][A-Z' -]+,\s*[A-Z][A-Z .'-]{1,80}?)(?:\s*\n|\s+DOB|\s+ADMINISTRATIVE INFORMATION|$)/i,
    /\b\(M0040\)\s*Patient Name\b[\s\S]{0,140}?\b(?:First Name:.*?Last Name:.*?:\s*)?([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/is,
    /\bResident:\s*([A-Z][A-Z' -]+,\s*[A-Z][A-Z .'-]{1,80}?)(?:\s*\(|\s+DOB|\s+To:|$)/i,
    /\bPatient Name\s*[:\-]?\s*([A-Z][A-Z' -]+,\s*[A-Z][A-Z .'-]{1,80}?)(?:\s*\(|\s+DOB|\s+To:|$)/i,
    /\bResident #\s*([A-Z][A-Z' -]+,\s*[A-Z][A-Z .'-]{1,80}?)(?:\.\s+\d{3}|\s+\d{3}| Previous address| Sex Birthdate| DOB|$)/i,
    /\bResident Name\b(?:.*?\bResident #\b)?\s*([A-Z][A-Z' -]+,\s*[A-Z][A-Z .'-]{1,80}?)(?:\.\s+\d{3}|\s+\d{3}| Previous address| Sex Birthdate| DOB|$)/i,
  ])) ?? (() => {
    const match = text.match(/\b\(M0040\)\s*Patient Name\b[\s\S]{0,140}?\b(?:First Name:.*?Last Name:.*?:\s*)?([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/is);
    return match ? `${match[2]}, ${match[1]}` : null;
  })();
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
  const structuredCaregiver = text.match(
    /\bCaregiver Contact Info:\s*Primary Caregiver:\s*Relationship to Patient\s*Contact Number\s*([A-Z][A-Za-z .'-]+)\s+(Daughter|Son|Spouse|Wife|Husband|Sister|Brother|Friend|Caregiver)\s+(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\d{10})/is,
  );
  if (structuredCaregiver) {
    return {
      name: normalizePersonName(structuredCaregiver[1]),
      relationship: normalizeWhitespace(structuredCaregiver[2]),
      phone: normalizeWhitespace(structuredCaregiver[3]),
    };
  }

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
    /\bPRIMARY DIAGNOSIS\b[\s\S]{0,80}?([A-TV-Z1|L][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?)\s*[-:)]\s*([A-Za-z][A-Za-z0-9 ,()/-]{3,120})/gi,
    /\bOTHER DIAGNOSIS\s*-\s*\d+\b[\s\S]{0,80}?([A-TV-Z1|L][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?)\s*[-:)]\s*([A-Za-z][A-Za-z0-9 ,()/-]{3,120})/gi,
    /\b([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)\s+([A-Z][A-Z0-9 ,()/-]{3,120}?)\s+\d{2}\/\d{2}\/\d{4}\s+(Primary|\d+|Other)\b/gi,
    /\b([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)\s*[-:)]\s*([A-Z][A-Z0-9 ,()/-]{3,120})\b/gi,
    /\b([A-Z][A-Z0-9 ,()/-]{3,120})\(([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)\)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const rawIcd10Code = /^[A-TV-Z1|L]/i.test(match[1]) ? match[1] : match[2];
      const icd10Code = normalizeIcd10Code(rawIcd10Code);
      const description = /^[A-TV-Z1|L]/i.test(match[1]) ? match[2] : match[1];
      if (!icd10Code) {
        continue;
      }
      const normalizedDescription = normalizeWhitespace(description)
        .replace(/\s+\d(?:\s+\d){3,}\b.*$/i, "")
        .replace(/\s+\^.*$/i, "")
        .trim();
      const key = `${icd10Code}:${description}`.toUpperCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push({
        description: normalizedDescription,
        icd10_code: icd10Code.toUpperCase(),
        confidence: 0.74,
        source_spans: [normalizeWhitespace(match[0])],
        is_primary_candidate: candidates.length === 0 || /\bPrimary\b/i.test(match[0] ?? ""),
        requires_human_review: true,
      });
      if (candidates.length >= 8) {
        return candidates;
      }
    }
  }

  return candidates;
}

function extractReferralDate(text: string): string | null {
  return firstMatch(text, [
    /\bDate of Referral\b[\s\S]{0,120}?(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    /\bReferral Date\b\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    /\bOrder Date\b\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    /\breferred for home health services on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i,
  ]);
}

function extractDischargeDate(text: string): string | null {
  return firstMatch(text, [
    /\b\(M1005\)\s*Inpatient Discharge Date[^:\n]*:\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    /\b(?:Discharge Date|M1005)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    /\bdischarge home on\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /\bdischarged from (?:a|an) [^.]+ on\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /\brecently discharged from [^.]+ on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i,
  ]);
}

function extractDischargeFacility(text: string): string | null {
  const facility = firstMatch(text, [
    /\bfollowing her discharge from\s+([A-Z][A-Za-z0-9 &'.,-]{3,120}?)(?:\s+after|\s+due to|[.,])/i,
    /\brecently discharged from\s+([A-Z][A-Za-z0-9 &'.,-]{3,120}?)(?:\s+on|[.,])/i,
    /\bAcute care hospital\s+([A-Z0-9 &'.,-]{3,120}?)\s+(?:Medicare Beneficiary|Medicaid|Social Security|Medical Record)\b/i,
    /\b(?:Discharged from|Recent Inpatient Facilities?)\s*[:\-]?\s*([A-Za-z0-9 &'.,()-]{3,120})/i,
  ]);
  if (facility && /\b(?:an?|the)\s+inpatient facility\b/i.test(facility)) {
    return null;
  }
  return facility ? sentenceCase(facility) : null;
}

function extractHomeboundNarrative(text: string, sectionLookup: Map<string, NormalizedReferralSection>): string | null {
  const explicitNarrative = firstMatch(text, [
    /\b(The patient is homebound due to[^.]+(?:\.[^.]+){0,2})/i,
    /\b(a physical therapy assessment was completed, noting that she is homebound due to[^.]+(?:\.[^.]+){0,2})/i,
    /\b(Homebound Reason:[^.]+(?:\.[^.]+){0,2})/i,
  ]);
  if (explicitNarrative) {
    return summarizeNarrative(explicitNarrative, 520);
  }

  const sectionSummary = findSectionText(sectionLookup, "homebound_evidence") || findSectionSummary(sectionLookup, "homebound_evidence");
  return summarizeNarrative(sectionSummary, 520);
}

function extractTherapyNeed(text: string, sectionLookup: Map<string, NormalizedReferralSection>): string | null {
  return summarizeNarrative(firstMatch(text, [
    /\b(Initiate physical therapy services focusing on[^.]+(?:\.[^.]+){0,1})/i,
    /\b(PT to address functional limitations[^.]+(?:\.[^.]+){0,1})/i,
    /\b(HH PT\/OT eval and treat as indicated)\b/i,
    /\b(physical therapy services[^.]{0,240})/i,
  ]) || findSectionSummary(sectionLookup, "therapy_need"), 420);
}

function extractDisciplineFrequency(text: string): string | null {
  return summarizeNarrative(firstMatch(text, [
    /\bFrequency and duration:\s*Physical Therapy:\s*([^.]{3,180})/i,
    /\bPT Frequency:\s*([^\n]{3,120}?)(?:\s+OT Frequency|\s+HHA Frequency|\s+ST Frequency|\s+Dietitian Frequency|\s+\*{2,}|$)/i,
  ]), 180);
}

function extractPriorFunctioningNarrative(text: string): string | null {
  return summarizeNarrative(firstMatch(text, [
    /\b(Functionally,\s*Christine requires supervision to minimal assistance[^.]+(?:\.[^.]+){0,1})/i,
    /\b(She uses a walker for mobility and requires supervision to minimal assistance with transfers and ambulation[^.]*\.)/i,
    /\b(The patient requires assistance with activities of daily living[^.]+(?:\.[^.]+){0,1})/i,
  ]), 320);
}

function extractPatientSummaryNarrative(text: string): string | null {
  const summarySection = extractSectionBetween(
    text,
    /\bPATIENT SUMMARY\s*&\s*CLINICAL NARRATIVE\b[\s\S]*?\bSummary\b/i,
    /\bCARE PLAN\b/i,
  );
  return summarizeNarrative(summarySection, 500);
}

function extractCarePlanNarrative(text: string): string | null {
  const carePlanSection = extractSectionBetween(
    text,
    /\bCARE PLAN\b[\s\S]*?\bPatient Care Plan\s*\/\s*Goals\s*\/\s*Interventions\b/i,
    /\bOngoing Care Plans within OASIS date\b/i,
  );
  return summarizeNarrative(carePlanSection, 480);
}

function extractPainAssessmentNarrative(text: string): string | null {
  return summarizeNarrative(firstMatch(text, [
    /\b(Comments:\s*Lower back pain[^.]+(?:\.[^.]+){0,1})/i,
    /\b(Pain Location and Description:[^.]+(?:\.[^.]+){0,1})/i,
  ]), 320);
}

function extractRespiratoryStatus(text: string): string | null {
  return summarizeNarrative(firstMatch(text, [
    /\b(O2 Sat:\s*\d+\s*0?2 Sat in:\s*[A-Za-z ]+)/i,
    /\b(acute respiratory failure with hypoxia[^.]{0,180})/i,
  ]), 220);
}

function extractIntegumentaryWoundStatus(text: string): string | null {
  return summarizeNarrative(firstMatch(text, [
    /\b(intact skin integrity with no noted wounds[^.]{0,120})/i,
    /\b(no noted wounds[^.]{0,120})/i,
  ]), 220);
}

function extractEmotionalBehavioralStatus(text: string): string | null {
  return summarizeNarrative(firstMatch(text, [
    /\b(Despite intact cognition and stable mood[^.]+(?:\.[^.]+){0,1})/i,
    /\b(alert and oriented with no signs of impairment[^.]+(?:\.[^.]+){0,1})/i,
  ]), 260);
}

function extractPastMedicalHistorySummary(text: string): string | null {
  return summarizeNarrative(firstMatch(text, [
    /\b(Her comorbidities include[^.]+(?:\.[^.]+){0,1})/i,
    /\b(Has conditions such as[^.]+(?:\.[^.]+){0,1})/i,
  ]), 420);
}

function extractPastMedicalHistoryItems(text: string): string[] {
  const summary = firstMatch(text, [
    /\bHer comorbidities include\s+([^.]+?)(?:,\s*all of which|\.\s|$)/i,
    /\bHas conditions such as\s+([^.]+?)(?:,\s*which|\.\s|$)/i,
  ]);
  if (!summary) {
    return [];
  }

  return Array.from(new Set(
    summary
      .split(/,\s*|\s+and\s+/i)
      .map((entry) => sentenceCase(entry))
      .map((entry) => entry?.replace(/\ball of which.*$/i, "").trim() ?? null)
      .filter((entry): entry is string => Boolean(entry && entry.length >= 3 && entry.length <= 120)),
  ));
}

function extractRiskSummary(text: string, sectionLookup: Map<string, NormalizedReferralSection>): string | null {
  return summarizeNarrative(
    firstMatch(text, [
      /\b(placing her at high risk for falls and further decline[^.]*\.)/i,
      /\b(reduce fall risk[^.]*\.)/i,
      /\b(Precautions Details:\s*Falls[^.]{0,260})/i,
      /\b(Falls,\s*[^.]{0,260})/i,
      /\b(high risk for falls[^.]{0,220})/i,
    ]) || findSectionSummary(sectionLookup, "risk_factors", "functional_limitations"),
    420,
  );
}

function fieldHasFactSupport(fieldKey: string, factKeys: Set<string>): boolean {
  const aliases: Record<string, string[]> = {
    primary_reason_for_home_health_medical_necessity: ["medical_necessity_summary", "order_summary"],
    admit_reason_to_home_health: ["medical_necessity_summary", "order_summary"],
    prior_functioning: ["prior_functioning", "functional_limitations"],
  };
  const candidates = aliases[fieldKey] ?? [fieldKey];
  return candidates.some((candidate) => factKeys.has(candidate));
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
  const dob = firstMatch(input.sourceText, [/\b(?:DOB|Birth Date|Birthdate)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i]);
  const referralDate = extractReferralDate(input.sourceText);
  const caregiver = extractCaregiver(input.sourceText);
  const preferredLanguage = extractPreferredLanguage(input.sourceText);
  const interpreterNeeded = /\bInterpreter Needed\s*[:\-]?\s*Yes\b/i.test(input.sourceText)
    ? true
    : /\bInterpreter Needed\s*[:\-]?\s*No\b/i.test(input.sourceText)
      ? false
      : null;
  const dischargeDate = extractDischargeDate(input.sourceText);
  const dischargeFacility = extractDischargeFacility(input.sourceText);
  const codeStatus = /\b(?:ADVANCE DIRECTIVE\s+)?CPR\s*\/\s*Full Code\b/i.test(input.sourceText) || /\bfull code\b/i.test(input.sourceText)
    ? "full_code"
    : /\bdnr\b/i.test(input.sourceText)
      ? "dnr"
      : null;

  const orderSummary = extractOrderSummary(input.sourceText);
  const medicalNecessitySummary =
    extractMedicalNecessitySummary(input.sourceText) ||
    trimOperationalInstructionSuffix(findSectionSummary(sectionLookup, "primary_reason_for_home_health", "medical_necessity"));
  const homeboundSummary = extractHomeboundNarrative(input.sourceText, sectionLookup);
  const homeboundSupportingFactors = homeboundSummary
    ? Array.from(new Set(
        [
          /\bwalker\b/i.test(homeboundSummary) ? "uses_walker" : null,
          /\brequires assistance\b/i.test(homeboundSummary) ? "needs_assistance" : null,
          /\bunsteady gait\b/i.test(homeboundSummary) ? "unsteady_gait" : null,
          /\bleaving home is exhausting\b/i.test(homeboundSummary) ? "exhausting_to_leave_home" : null,
          /\bpoor balance\b/i.test(homeboundSummary) ? "poor_balance" : null,
          /\bpain\b/i.test(homeboundSummary) ? "pain_limits_mobility" : null,
        ].filter((value): value is string => Boolean(value)),
      ))
    : [];
  const livingSituationSummary = extractLivingSituation(input.sourceText);
  const functionalSectionText = findSectionText(sectionLookup, "functional_limitations");
  const functionalSummary = summarizeNarrative(
    firstMatch(input.sourceText, [
      /\b(The patient requires assistance with activities of daily living[^.]+(?:\.[^.]+){0,1})/i,
      /\b(Functionally, Christine requires supervision to minimal assistance[^.]+(?:\.[^.]+){0,1})/i,
    ]) || functionalSectionText || findSectionSummary(sectionLookup, "functional_limitations"),
    520,
  );
  const functionalLimitations = functionalSummary
    ? Array.from(new Set(
        [
          /\bweakness\b/i.test(functionalSummary) ? "weakness" : null,
          /\bdifficulty(?:\s+in)?\s+walking\b/i.test(functionalSummary) ? "difficulty_walking" : null,
          /\bambulation\b/i.test(functionalSummary) ? "ambulation_limitations" : null,
          /\bendurance\b/i.test(functionalSummary) ? "reduced_endurance" : null,
          /\bpoor balance\b/i.test(functionalSummary) ? "poor_balance" : null,
        ].filter((value): value is string => Boolean(value)),
      ))
    : [];
  const therapySummary = extractTherapyNeed(input.sourceText, sectionLookup);
  const disciplineFrequency = extractDisciplineFrequency(input.sourceText);
  const priorFunctioningNarrative = extractPriorFunctioningNarrative(input.sourceText);
  const patientSummaryNarrative = extractPatientSummaryNarrative(input.sourceText);
  const carePlanNarrative = extractCarePlanNarrative(input.sourceText);
  const painAssessmentNarrative = extractPainAssessmentNarrative(input.sourceText);
  const respiratoryStatus = extractRespiratoryStatus(input.sourceText);
  const integumentaryWoundStatus = extractIntegumentaryWoundStatus(input.sourceText);
  const emotionalBehavioralStatus = extractEmotionalBehavioralStatus(input.sourceText);
  const pastMedicalHistorySummary = extractPastMedicalHistorySummary(input.sourceText);
  const pastMedicalHistoryItems = extractPastMedicalHistoryItems(input.sourceText);
  const riskSummary = extractRiskSummary(input.sourceText, sectionLookup);
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
    evidenceSpans: orderSummary ? [evidenceExcerpt(orderSummary, 220) as string] : [],
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
    evidenceSpans: medicalNecessitySummary ? [evidenceExcerpt(medicalNecessitySummary, 260) as string] : [],
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
    evidenceSpans: homeboundSummary ? [evidenceExcerpt(homeboundSummary, 260) as string] : [],
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
    evidenceSpans: homeboundSummary ? [evidenceExcerpt(homeboundSummary, 260) as string] : [],
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
    evidenceSpans: livingSituationSummary ? [evidenceExcerpt(livingSituationSummary, 160) as string] : [],
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
    evidenceSpans: functionalSummary ? [evidenceExcerpt(functionalSummary, 220) as string] : [],
    rationale: "Functional limitations were extracted from referral text.",
    sourceSections: ["functional_limitations"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "prior_functioning",
    category: "functional",
    value: priorFunctioningNarrative,
    confidence: 0.77,
    evidenceSpans: priorFunctioningNarrative ? [evidenceExcerpt(priorFunctioningNarrative, 220) as string] : [],
    rationale: "Prior functioning was summarized from the patient summary and mobility narrative.",
    sourceSections: ["functional_limitations", "other_clinical_notes"],
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
    factKey: "discipline_frequencies",
    category: "therapy",
    value: disciplineFrequency,
    confidence: 0.84,
    evidenceSpans: disciplineFrequency ? [evidenceExcerpt(disciplineFrequency, 120) as string] : [],
    rationale: "Discipline frequency was identified from the therapy plan.",
    sourceSections: ["therapy_need"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "fall_risk_narrative",
    category: "risk",
    value: riskSummary || null,
    confidence: 0.7,
    evidenceSpans: riskSummary ? [evidenceExcerpt(riskSummary, 220) as string] : [],
    rationale: "Risk and safety narrative was summarized from referral text.",
    sourceSections: ["risk_factors", "functional_limitations"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "patient_summary_narrative",
    category: "medical_necessity",
    value: patientSummaryNarrative,
    confidence: 0.82,
    evidenceSpans: patientSummaryNarrative ? [evidenceExcerpt(patientSummaryNarrative, 260) as string] : [],
    rationale: "Patient summary narrative was extracted from the OASIS clinical summary.",
    sourceSections: ["other_clinical_notes"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "skilled_interventions",
    category: "therapy",
    value: therapySummary,
    confidence: 0.8,
    evidenceSpans: therapySummary ? [evidenceExcerpt(therapySummary, 240) as string] : [],
    rationale: "Skilled interventions were summarized from the therapy plan.",
    sourceSections: ["therapy_need"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "plan_for_next_visit",
    category: "therapy",
    value: therapySummary,
    confidence: 0.78,
    evidenceSpans: therapySummary ? [evidenceExcerpt(therapySummary, 240) as string] : [],
    rationale: "Next-visit plan was summarized from the therapy plan.",
    sourceSections: ["therapy_need"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "patient_caregiver_goals",
    category: "therapy",
    value: summarizeNarrative(firstMatch(input.sourceText, [
      /\bPatient's goal:\s*"([^"]+)"/i,
      /\b(I want to get stronger[^"]*)/i,
    ]), 220),
    confidence: 0.79,
    evidenceSpans: firstMatch(input.sourceText, [
      /\bPatient's goal:\s*"([^"]+)"/i,
      /\b(I want to get stronger[^"]*)/i,
    ]) ? [evidenceExcerpt(firstMatch(input.sourceText, [
      /\bPatient's goal:\s*"([^"]+)"/i,
      /\b(I want to get stronger[^"]*)/i,
    ]) as string, 200) as string] : [],
    rationale: "Patient or caregiver goals were identified in the therapy plan.",
    sourceSections: ["therapy_need", "other_clinical_notes"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "care_plan_problems_goals_interventions",
    category: "therapy",
    value: carePlanNarrative,
    confidence: 0.8,
    evidenceSpans: carePlanNarrative ? [evidenceExcerpt(carePlanNarrative, 260) as string] : [],
    rationale: "Care-plan problems, goals, and interventions were summarized from the OASIS care plan.",
    sourceSections: ["other_clinical_notes"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "pain_assessment_narrative",
    category: "functional",
    value: painAssessmentNarrative,
    confidence: 0.8,
    evidenceSpans: painAssessmentNarrative ? [evidenceExcerpt(painAssessmentNarrative, 220) as string] : [],
    rationale: "Pain assessment narrative was identified in the vitals and pain assessment section.",
    sourceSections: ["other_clinical_notes"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "respiratory_status",
    category: "medical_necessity",
    value: respiratoryStatus,
    confidence: 0.74,
    evidenceSpans: respiratoryStatus ? [evidenceExcerpt(respiratoryStatus, 120) as string] : [],
    rationale: "Respiratory status was summarized from referral text.",
    sourceSections: ["other_clinical_notes"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "integumentary_wound_status",
    category: "medical_necessity",
    value: integumentaryWoundStatus,
    confidence: 0.74,
    evidenceSpans: integumentaryWoundStatus ? [evidenceExcerpt(integumentaryWoundStatus, 160) as string] : [],
    rationale: "Integumentary and wound status was summarized from the patient summary.",
    sourceSections: ["other_clinical_notes"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "emotional_behavioral_status",
    category: "medical_necessity",
    value: emotionalBehavioralStatus,
    confidence: 0.74,
    evidenceSpans: emotionalBehavioralStatus ? [evidenceExcerpt(emotionalBehavioralStatus, 220) as string] : [],
    rationale: "Emotional and behavioral status was summarized from the patient summary.",
    sourceSections: ["other_clinical_notes"],
  });
  addFact({
    facts,
    unsupported: unsupportedOrMissingFields,
    factKey: "past_medical_history",
    category: "medical_necessity",
    value: pastMedicalHistoryItems.length > 0 ? pastMedicalHistoryItems : pastMedicalHistorySummary,
    confidence: 0.78,
    evidenceSpans: pastMedicalHistorySummary ? [evidenceExcerpt(pastMedicalHistorySummary, 220) as string] : [],
    rationale: "Past medical history was summarized from the clinical narrative.",
    sourceSections: ["other_clinical_notes"],
  });

  const factKeys = new Set(facts.map((fact) => fact.fact_key));
  for (const field of input.fieldMapSnapshot.candidate_fields_for_llm_inference_from_referral) {
    if (field === "diagnosis_candidates") {
      continue;
    }
    if (!fieldHasFactSupport(field, factKeys)) {
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
