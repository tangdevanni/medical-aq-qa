import type { StageStatus } from "@medical-ai-qa/shared-types";

const donePatterns = [
  /\blocked\b/i,
  /\bqa done\b/i,
  /\bexported\b/i,
  /\bdone and reviewed\b/i,
  /\breviewed\b/i,
];

const reviewRequiredPatterns = [
  /\bempty\b/i,
  /\bcannot validate\b/i,
  /\bpending\b/i,
  /\bnot started\b/i,
  /\bissue(?:s)?\b/i,
  /\berror(?:s)?\b/i,
  /\bmissing\b/i,
];

const inProgressPatterns = [
  /\bin progress\b/i,
  /\bworking\b/i,
  /\bstarted\b/i,
  /\bopen\b/i,
  /\bassigned\b/i,
  /\bqueued\b/i,
];

function classifySingleValue(value: string | null | undefined): StageStatus {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "NOT_STARTED";
  }

  if (reviewRequiredPatterns.some((pattern) => pattern.test(trimmed))) {
    return "REVIEW_REQUIRED";
  }

  if (donePatterns.some((pattern) => pattern.test(trimmed))) {
    return "DONE";
  }

  if (inProgressPatterns.some((pattern) => pattern.test(trimmed))) {
    return "IN_PROGRESS";
  }

  return "IN_PROGRESS";
}

export function mapStageStatus(...values: Array<string | null | undefined>): StageStatus {
  const candidates = values.map((value) => classifySingleValue(value));

  if (candidates.includes("REVIEW_REQUIRED")) {
    return "REVIEW_REQUIRED";
  }

  if (candidates.includes("IN_PROGRESS")) {
    return "IN_PROGRESS";
  }

  if (candidates.includes("DONE")) {
    return "DONE";
  }

  return "NOT_STARTED";
}

const mergeRank: Record<StageStatus, number> = {
  NOT_STARTED: 0,
  DONE: 1,
  IN_PROGRESS: 2,
  REVIEW_REQUIRED: 3,
};

export function mergeStageStatus(
  left: StageStatus,
  right: StageStatus,
): StageStatus {
  return mergeRank[left] >= mergeRank[right] ? left : right;
}
