import type { PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";

function normalizeComparable(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/[,/.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

const MULTI_PART_LAST_NAME_PREFIXES = new Set([
  "DA",
  "DE",
  "DEL",
  "DELA",
  "DELLA",
  "DI",
  "DU",
  "LA",
  "LE",
  "SAN",
  "SANTA",
  "ST",
  "VAN",
  "VON",
]);

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function splitPatientNameForGlobalSearch(value: string): {
  lastName: string;
  firstName: string;
} {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return {
      lastName: "",
      firstName: "",
    };
  }

  const commaSeparated = normalized
    .split(",")
    .map((entry) => entry.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (commaSeparated.length >= 2) {
    const [lastName, ...firstNameParts] = commaSeparated;
    const firstName = firstNameParts.join(" ").replace(/\s+/g, " ").trim();
    return {
      lastName,
      firstName,
    };
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    return {
      lastName: tokens[0]!,
      firstName: "",
    };
  }

  let splitIndex = tokens.length - 1;
  while (splitIndex > 1) {
    const prefixToken = tokens[splitIndex - 1]!.replace(/\./g, "").toUpperCase();
    if (!MULTI_PART_LAST_NAME_PREFIXES.has(prefixToken)) {
      break;
    }

    splitIndex -= 1;
  }

  const firstName = tokens.slice(0, splitIndex).join(" ");
  const lastName = tokens.slice(splitIndex).join(" ");
  return {
    lastName,
    firstName,
  };
}

export function normalizePatientNameForGlobalSearch(value: string): string {
  const { lastName, firstName } = splitPatientNameForGlobalSearch(value);
  if (!lastName) {
    return "";
  }

  return `${lastName.toLowerCase()}, ${firstName.toLowerCase()}`;
}

export function normalizePatientNameForGlobalSearchResult(value: string): string {
  const { lastName, firstName } = splitPatientNameForGlobalSearch(value);
  if (!lastName) {
    return "";
  }

  return `${lastName.toUpperCase()}, ${firstName.toUpperCase()}`;
}

export function buildPatientSearchQueries(workItem: PatientEpisodeWorkItem): string[] {
  const rawCandidates = new Set<string>();
  const displayName = workItem.patientIdentity.displayName.trim();
  const normalizedName = workItem.patientIdentity.normalizedName.trim();

  if (displayName) {
    rawCandidates.add(displayName);
    rawCandidates.add(normalizeComparable(displayName));
  }

  if (normalizedName) {
    rawCandidates.add(normalizedName);
    rawCandidates.add(titleCaseWords(normalizedName));
  }

  const tokens = normalizeComparable(displayName || normalizedName).split(" ").filter(Boolean);
  if (tokens.length >= 2) {
    rawCandidates.add(`${tokens[0]} ${tokens[tokens.length - 1]}`);
    rawCandidates.add(`${tokens[tokens.length - 1]}, ${tokens.slice(0, -1).join(" ")}`);
    rawCandidates.add(tokens.join(" "));
    rawCandidates.add(titleCaseWords(tokens.join(" ")));
  }

  return [...rawCandidates]
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
}

export interface PatientSearchCandidateScore {
  score: number;
  reasons: string[];
  normalizedCandidateName: string;
}

export function scorePatientSearchCandidate(
  workItem: PatientEpisodeWorkItem,
  candidateLabel: string,
): PatientSearchCandidateScore {
  const reasons: string[] = [];
  let score = 0;
  const normalizedCandidateName = normalizeComparable(candidateLabel);
  const targetVariants = new Set(
    buildPatientSearchQueries(workItem)
      .map((value) => normalizeComparable(value))
      .filter(Boolean),
  );
  const targetTokens = [...targetVariants]
    .flatMap((value) => value.split(" "))
    .filter(Boolean);

  if (targetVariants.has(normalizedCandidateName)) {
    score += 100;
    reasons.push("exact normalized name match");
  }

  const allTokensPresent = targetTokens.length > 0 &&
    [...new Set(targetTokens)].every((token) => normalizedCandidateName.includes(token));
  if (allTokensPresent) {
    score += 40;
    reasons.push("all patient name tokens present");
  }

  if (workItem.patientIdentity.medicareNumber) {
    const medicare = normalizeComparable(workItem.patientIdentity.medicareNumber);
    if (medicare && normalizedCandidateName.includes(medicare)) {
      score += 25;
      reasons.push("medicare number matched");
    }
  }

  return {
    score,
    reasons,
    normalizedCandidateName,
  };
}
