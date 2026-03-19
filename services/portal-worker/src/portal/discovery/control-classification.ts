import { type PortalButtonSummary, type PortalControlClassification } from "@medical-ai-qa/shared-types";
import { normalizeText } from "../utils/page-helpers";

export interface ControlClassificationInput {
  label: string;
  kind?: "button" | "link" | "tile" | "nav" | "search" | "tab";
  href?: string | null;
  withinForm?: boolean;
  inNavigation?: boolean;
}

export interface ControlClassificationResult {
  classification: PortalControlClassification;
  reason: string | null;
}

const SAFE_NAV_PATTERNS = [
  /dashboard/i,
  /admin/i,
  /payroll/i,
  /reports?/i,
  /billing/i,
  /calendar/i,
  /visit map/i,
  /applicants/i,
  /documents?/i,
  /help desk/i,
  /qapi board/i,
  /orders and qa management/i,
  /admission\s*\/\s*discharges/i,
  /\bworkflow\b/i,
  /\breview\b/i,
  /navigation/i,
  /menu/i,
  /tab/i,
  /home/i,
];

const SEARCH_TRIGGER_PATTERNS = [
  /\bsearch patient\b/i,
  /\bpatient search\b/i,
  /\bsearch\b/i,
  /\bfind patient\b/i,
  /\bcommand\b/i,
  /\bctrl\s*k\b/i,
  /\bctrl\+k\b/i,
  /\bpalette\b/i,
];

const GENERIC_UI_PATTERNS = [
  /search/i,
  /filter/i,
  /close/i,
  /cancel/i,
  /reset/i,
  /open/i,
  /view/i,
  /details?/i,
  /next/i,
  /previous/i,
  /back/i,
  /menu/i,
  /tab/i,
];

const RISKY_ACTION_PATTERNS = [
  /\bsave\b/i,
  /\bsubmit\b/i,
  /\bapprove\b/i,
  /\bcomplete\b/i,
  /\bupdate\b/i,
  /\bdelete\b/i,
  /\bremove\b/i,
  /\bupload\b/i,
  /\bedit\b/i,
  /\bassign\b/i,
  /\bcreate\b/i,
  /\badd\b/i,
  /\bnew\b/i,
  /\bprint\b/i,
  /\bexport\b/i,
  /\bsign\b/i,
];

const SAFE_DESTINATION_HINT_PATTERNS = [
  /orders and qa management/i,
  /admission\s*\/\s*discharges/i,
  /\bdocuments?\b/i,
  /\bboard\b/i,
  /\breports?\b/i,
  /\bbilling\b/i,
  /\bcalendar\b/i,
  /\breview\b/i,
];

const LIKELY_DYNAMIC_PATTERNS = [
  /\bMR\b/i,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
  /\b\d{4}-\d{2}-\d{2}\b/,
  /@/,
];

const LIKELY_PERSON_NAME_PATTERN = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/;

export function classifyControlLabel(label: string): PortalControlClassification {
  return classifyControl({
    label,
  }).classification;
}

export function classifyControl(input: ControlClassificationInput): ControlClassificationResult {
  const normalizedLabel = normalizeText(input.label) ?? input.label;

  if (RISKY_ACTION_PATTERNS.some((pattern) => pattern.test(normalizedLabel))) {
    return {
      classification: "RISKY_ACTION",
      reason: "Matches denylisted action text.",
    };
  }

  if (
    input.kind === "search" ||
    SEARCH_TRIGGER_PATTERNS.some((pattern) => pattern.test(normalizedLabel))
  ) {
    return {
      classification: "SEARCH_TRIGGER",
      reason: "Looks like a search or command trigger, not a destination view.",
    };
  }

  if (input.withinForm) {
    return {
      classification: "UNKNOWN",
      reason: "Form controls stay unknown unless navigation is explicit.",
    };
  }

  const hasSafeNavLabel = SAFE_NAV_PATTERNS.some((pattern) => pattern.test(normalizedLabel));
  const hasSafeDestinationHint = SAFE_DESTINATION_HINT_PATTERNS.some((pattern) =>
    pattern.test(normalizedLabel),
  );
  const hasNavigableHref =
    typeof input.href === "string" &&
    input.href.length > 0 &&
    !input.href.startsWith("javascript:");

  if (input.inNavigation && hasSafeNavLabel) {
    return {
      classification: "SAFE_NAV",
      reason: "Visible within navigation and matches the allowlist.",
    };
  }

  if (
    (input.kind === "link" || input.kind === "nav" || input.kind === "tab") &&
    (hasSafeNavLabel || hasSafeDestinationHint || hasNavigableHref)
  ) {
    return {
      classification: "SAFE_NAV",
      reason: "Looks like a navigational control with an allowlisted label.",
    };
  }

  if ((input.kind === "tile" || input.kind === "button") && (hasSafeNavLabel || hasSafeDestinationHint)) {
    return {
      classification: "SAFE_NAV",
      reason: "Looks like a dashboard entry tile or button with a safe label.",
    };
  }

  if (GENERIC_UI_PATTERNS.some((pattern) => pattern.test(normalizedLabel))) {
    return {
      classification: "UNKNOWN",
      reason: "Generic utility control with ambiguous side effects.",
    };
  }

  return {
    classification: "UNKNOWN",
    reason: "Control effect is unclear.",
  };
}

export function sanitizeStructuralLabel(value: string | null | undefined): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  if (normalized.length > 60 || normalized.split(" ").length > 8) {
    return null;
  }

  if (LIKELY_DYNAMIC_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return null;
  }

  if (
    LIKELY_PERSON_NAME_PATTERN.test(normalized) &&
    !SAFE_NAV_PATTERNS.some((pattern) => pattern.test(normalized)) &&
    !RISKY_ACTION_PATTERNS.some((pattern) => pattern.test(normalized)) &&
    !GENERIC_UI_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    return null;
  }

  return normalized;
}

export function buildButtonSummary(label: string | null | undefined): PortalButtonSummary | null {
  const safeLabel = sanitizeStructuralLabel(label);
  if (!safeLabel) {
    return null;
  }

  return {
    label: safeLabel,
    classification: classifyControl({
      label: safeLabel,
      kind: "button",
    }).classification,
  };
}
