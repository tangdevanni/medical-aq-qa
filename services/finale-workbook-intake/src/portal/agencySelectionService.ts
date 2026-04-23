export interface AgencyOptionCandidate {
  label: string;
  href?: string | null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeAgencyLabel(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugifyAgencyLabel(value: string): string {
  return normalizeAgencyLabel(value).replace(/\s+/g, "-");
}

export function buildUserAgenciesUrl(baseUrl: string): string {
  return new URL("/users/user-agencies", baseUrl).toString();
}

export function scoreAgencyOption(targetAgency: string, option: AgencyOptionCandidate): number {
  const normalizedTarget = normalizeAgencyLabel(targetAgency);
  const normalizedLabel = normalizeAgencyLabel(option.label);
  const href = option.href?.toLowerCase() ?? "";
  const targetSlug = slugifyAgencyLabel(targetAgency);

  if (!normalizedTarget || !normalizedLabel) {
    return 0;
  }

  if (normalizedLabel === normalizedTarget) {
    return 1_000;
  }

  let score = 0;
  if (normalizedLabel.includes(normalizedTarget)) {
    score += 700;
  }
  if (normalizedTarget.includes(normalizedLabel)) {
    score += 500;
  }

  const targetTokens = normalizedTarget.split(" ").filter(Boolean);
  const labelTokens = new Set(normalizedLabel.split(" ").filter(Boolean));
  const overlappingTokens = targetTokens.filter((token) => labelTokens.has(token));
  score += overlappingTokens.length * 75;

  if (href.includes(targetSlug)) {
    score += 150;
  }

  if (normalizedLabel.includes("home health")) {
    score += 10;
  }

  return score;
}

export function findBestAgencyOption<T extends AgencyOptionCandidate>(
  options: T[],
  targetAgency: string,
): (T & { score: number }) | null {
  let best: (T & { score: number }) | null = null;

  for (const option of options) {
    const score = scoreAgencyOption(targetAgency, option);
    if (score <= 0) {
      continue;
    }

    if (!best || score > best.score) {
      best = {
        ...option,
        score,
      };
    }
  }

  return best;
}

export function findBestAgencyOptionForTargets<T extends AgencyOptionCandidate>(
  options: T[],
  targetAgencies: string[],
): (T & { score: number; matchedTarget: string }) | null {
  let best: (T & { score: number; matchedTarget: string }) | null = null;

  for (const targetAgency of targetAgencies) {
    const candidate = findBestAgencyOption(options, targetAgency);
    if (!candidate) {
      continue;
    }

    if (!best || candidate.score > best.score) {
      best = {
        ...candidate,
        matchedTarget: targetAgency,
      };
    }
  }

  return best;
}
