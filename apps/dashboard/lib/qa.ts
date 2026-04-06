import type { OasisQaSummary } from "@medical-ai-qa/shared-types";

export function formatLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export function batchStatusClass(status: string): string {
  if (status === "COMPLETED") {
    return "badge success";
  }

  if (status === "FAILED") {
    return "badge danger";
  }

  if (status === "COMPLETED_WITH_EXCEPTIONS" || status === "RUNNING") {
    return "badge warning";
  }

  return "badge";
}

export function qaStatusClass(
  status: OasisQaSummary["overallStatus"] | OasisQaSummary["urgency"] | string,
): string {
  if (status === "READY_FOR_BILLING" || status === "PASS" || status === "ON_TRACK") {
    return "badge success";
  }

  if (status === "BLOCKED" || status === "FAIL" || status === "MISSING" || status === "OVERDUE") {
    return "badge danger";
  }

  if (status === "DUE_SOON" || status === "NEEDS_QA" || status === "NEEDS_REVIEW") {
    return "badge warning";
  }

  return "badge";
}

export function workflowStatusClass(status: string): string {
  if (status === "complete") {
    return "badge success";
  }

  if (status === "blocked") {
    return "badge danger";
  }

  return "badge";
}

export function lockStateClass(lockState: string): string {
  if (lockState === "unlocked") {
    return "badge success";
  }

  if (lockState === "locked") {
    return "badge danger";
  }

  return "badge warning";
}

export function modeClass(mode: string): string {
  if (mode === "input_capable") {
    return "badge success";
  }

  return "badge warning";
}

export function diagnosisDetectionClass(passed: boolean): string {
  return passed ? "badge success" : "badge warning";
}

export function executionStatusClass(status: string): string {
  if (status === "executed") {
    return "badge success";
  }
  if (status === "locked") {
    return "badge danger";
  }
  if (status === "skipped") {
    return "badge warning";
  }
  return "badge";
}

export function formatDaysLeft(daysLeft: number | null): string {
  if (daysLeft === null) {
    return "Needs Review";
  }

  if (daysLeft < 0) {
    return `${Math.abs(daysLeft)} day(s) overdue`;
  }

  if (daysLeft === 0) {
    return "Due today";
  }

  return `${daysLeft} day(s) left`;
}
