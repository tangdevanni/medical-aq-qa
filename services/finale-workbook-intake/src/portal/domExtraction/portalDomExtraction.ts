import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import type {
  PortalDomExtractedField,
  PortalDomExtractedSection,
  PortalDomExtractedState,
  PortalDomExtractedTable,
  PortalDomExtractionConfidence,
  PortalDomSourceArea,
} from "@medical-ai-qa/shared-types";

export const PORTAL_DOM_EXTRACTION_VERSION = "portal-dom-extraction.v1";

export type PortalDomExtractionThresholds = {
  minFieldCount: number;
  minNonEmptyFieldCount: number;
};

export type PortalDomExtractionOptions = Partial<PortalDomExtractionThresholds> & {
  sourceArea: PortalDomSourceArea;
  sectionTitle?: string;
};

type RawDomSection = {
  title: string;
  fields: PortalDomExtractedField[];
  tables: PortalDomExtractedTable[];
  visibleTextDigest?: string;
};

const DEFAULT_THRESHOLDS: PortalDomExtractionThresholds = {
  minFieldCount: 10,
  minNonEmptyFieldCount: 3,
};

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "extractedAt")
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hasNonEmptyValue(field: PortalDomExtractedField): boolean {
  if (typeof field.checked === "boolean") {
    return field.checked;
  }
  if (Array.isArray(field.value)) {
    return field.value.some((value) => normalizeWhitespace(value));
  }
  if (typeof field.value === "boolean") {
    return field.value;
  }
  if (typeof field.value === "number") {
    return true;
  }
  return Boolean(normalizeWhitespace(field.value ?? field.selectedText ?? field.selectedValue ?? ""));
}

function normalizeOasisItemCode(value: string | null | undefined): string | undefined {
  const normalized = normalizeWhitespace(value).toUpperCase();
  const match = normalized.match(/\b(?:M|GG|O)\d{4}[A-Z0-9_() -]*\b/);
  if (!match?.[0]) {
    return undefined;
  }
  const compact = match[0].replace(/[_() -]+$/g, "");
  const base = compact.match(/^(?:M|GG|O)\d{4}/)?.[0];
  return base ?? compact;
}

function buildCoverage(input: {
  sections: PortalDomExtractedSection[];
  thresholds: PortalDomExtractionThresholds;
  extraFallbackReasons?: string[];
}): PortalDomExtractedState["coverage"] {
  const sectionCount = input.sections.filter((section) => section.status !== "skipped_duplicate").length;
  const fieldCount = input.sections.reduce((total, section) => total + section.fields.length, 0);
  const nonEmptyFieldCount = input.sections.reduce(
    (total, section) => total + section.fields.filter(hasNonEmptyValue).length,
    0,
  );
  const tableCount = input.sections.reduce((total, section) => total + section.tables.length, 0);
  const fallbackReasons = [...(input.extraFallbackReasons ?? [])];

  if (sectionCount === 0) {
    fallbackReasons.push("no_dom_sections_extracted");
  }
  if (fieldCount < input.thresholds.minFieldCount) {
    fallbackReasons.push(`field_count_below_threshold:${fieldCount}<${input.thresholds.minFieldCount}`);
  }
  if (nonEmptyFieldCount < input.thresholds.minNonEmptyFieldCount) {
    fallbackReasons.push(
      `non_empty_field_count_below_threshold:${nonEmptyFieldCount}<${input.thresholds.minNonEmptyFieldCount}`,
    );
  }
  if (fieldCount === 0 && tableCount === 0) {
    fallbackReasons.push("no_structured_fields_or_tables");
  }
  if (input.sections.some((section) => section.status === "failed" || section.status === "degraded")) {
    fallbackReasons.push("one_or_more_sections_failed_or_degraded");
  }

  const confidence: PortalDomExtractionConfidence =
    fallbackReasons.length === 0
      ? "high"
      : fieldCount > 0 || tableCount > 0
        ? "medium"
        : "low";

  return {
    sectionCount,
    fieldCount,
    nonEmptyFieldCount,
    tableCount,
    confidence,
    fallbackRecommended: fallbackReasons.length > 0,
    fallbackReasons: Array.from(new Set(fallbackReasons)),
  };
}

function sanitizeRoutePattern(value: string | null | undefined): string | undefined {
  if (!value || value === "about:blank") {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    const sanitizedPath = parsed.pathname
      .replace(/\/provider\/[^/?#]+/i, "/provider/<provider-id>")
      .replace(/\/client\/[^/?#]+/i, "/client/<client-id>")
      .replace(/\/patient\/[^/?#]+/i, "/patient/<patient-id>")
      .replace(/\/intake\/[^/?#]+/i, "/intake/<intake-id>")
      .replace(/\/documents\/note\/[^/?#]+\/[^/?#]+/i, "/documents/note/<document-type>/<note-id>")
      .replace(/\/document\/[^/?#]+/i, "/document/<document-id>")
      .replace(/\/documents\/[^/?#]+/i, "/documents/<document-id>");
    return `${parsed.origin}${sanitizedPath}`;
  } catch {
    return undefined;
  }
}

function buildTextDigest(sections: PortalDomExtractedSection[]): string {
  return sections
    .flatMap((section) => [
      section.title,
      ...section.fields.slice(0, 80).map((field) =>
        [field.section, field.label, field.key, field.selectedText ?? field.value].filter(Boolean).join(": ")),
      ...section.tables.slice(0, 20).map((table) =>
        [table.title, table.headers.join(" | "), table.rows.slice(0, 3).map((row) => row.join(" | ")).join(" / ")]
          .filter(Boolean)
          .join(": ")),
      section.visibleTextDigest ?? "",
    ])
    .map(normalizeWhitespace)
    .filter(Boolean)
    .join("\n")
    .slice(0, 12_000);
}

export function buildPortalDomExtractedState(input: {
  sourceArea: PortalDomSourceArea;
  sections: PortalDomExtractedSection[];
  routePattern?: string;
  thresholds?: Partial<PortalDomExtractionThresholds>;
  fallbackReasons?: string[];
}): PortalDomExtractedState {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
  const coverage = buildCoverage({
    sections: input.sections,
    thresholds,
    extraFallbackReasons: input.fallbackReasons,
  });
  const textDigest = buildTextDigest(input.sections);
  const hashInput = {
    artifactType: "portal_dom_extracted_state",
    sourceArea: input.sourceArea,
    extractionVersion: PORTAL_DOM_EXTRACTION_VERSION,
    sections: input.sections.map((section) => ({
      title: section.title,
      status: section.status,
      fields: section.fields,
      tables: section.tables,
      visibleTextDigest: section.visibleTextDigest,
      fallbackReasons: section.fallbackReasons,
    })),
    coverage: {
      sectionCount: coverage.sectionCount,
      fieldCount: coverage.fieldCount,
      nonEmptyFieldCount: coverage.nonEmptyFieldCount,
      tableCount: coverage.tableCount,
      confidence: coverage.confidence,
      fallbackRecommended: coverage.fallbackRecommended,
      fallbackReasons: coverage.fallbackReasons,
    },
    diagnostics: {
      routePattern: input.routePattern,
    },
    textDigest,
  };

  return {
    artifactType: "portal_dom_extracted_state",
    sourceArea: input.sourceArea,
    extractionVersion: PORTAL_DOM_EXTRACTION_VERSION,
    extractedAt: new Date().toISOString(),
    sections: input.sections,
    coverage,
    diagnostics: {
      inputSource: coverage.fallbackRecommended ? "dom_state_plus_raw_fallback" : "dom_state_primary",
      ocrUsed: false,
      pdfCaptureUsed: false,
      ...(input.routePattern ? { routePattern: input.routePattern } : {}),
    },
    contentHash: sha256(stableJson(hashInput)),
    textDigest,
  };
}

export async function extractPortalDomStateFromPage(
  page: Page,
  options: PortalDomExtractionOptions,
): Promise<PortalDomExtractedState> {
  await page.evaluate("globalThis.__name = globalThis.__name || ((target) => target)");
  const raw = await page.evaluate(({ sectionTitle }) => {
    const documentRef = (globalThis as unknown as { document: any }).document;
    const windowRef = (globalThis as unknown as { window: any }).window;
    const cssEscape = (value: string): string => {
      const css = (globalThis as unknown as { CSS?: { escape?: (text: string) => string } }).CSS;
      return css?.escape ? css.escape(value) : value.replace(/["\\]/g, "\\$&");
    };
    const normalize = (value: string | null | undefined): string =>
      (value ?? "").replace(/\s+/g, " ").trim();
    const normalizeOasisItemCode = (value: string | null | undefined): string | undefined => {
      const normalized = normalize(value).toUpperCase();
      const explicit = normalized.match(/\b(?:M|GG|O)\d{4}\b/)?.[0];
      if (explicit) {
        return explicit;
      }
      return normalized.match(/\b(?:M|GG|O)\d{4}/)?.[0];
    };
    const isSensitiveKey = (value: string): boolean =>
      /\b(password|token|secret|session|cookie|auth|bearer|csrf|jwt)\b/i.test(value);
    const isVisible = (element: any): boolean => {
      const style = windowRef.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width >= 0 && rect.height >= 0;
    };
    const textOf = (element: any): string => normalize(element?.textContent ?? "");
    const previousLabelText = (element: any): string => {
      const parent = element.parentElement;
      const candidates = [
        element.previousElementSibling,
        parent?.querySelector("label"),
        parent?.previousElementSibling,
        parent?.parentElement?.querySelector("label"),
      ];
      return normalize(candidates.map(textOf).find(Boolean) ?? "");
    };
    const associatedLabel = (element: any): string => {
      const id = element.id ? cssEscape(element.id) : "";
      const explicit = id ? textOf(documentRef.querySelector(`label[for="${id}"]`)) : "";
      const wrapping = textOf(element.closest("label"));
      return normalize(
        explicit ||
        wrapping ||
        element.getAttribute("aria-label") ||
        element.getAttribute("placeholder") ||
        previousLabelText(element),
      );
    };
    const sectionFor = (element: any): string => {
      const host = element.closest("section, article, fieldset, app-oasis, app-document-note, form") ?? documentRef.body;
      const heading = host.querySelector("legend, h1, h2, h3, h4, h5, h6, [role='heading']");
      return normalize(heading?.textContent) || sectionTitle || "Current Page";
    };
    const evidenceNear = (element: any): string =>
      normalize((element.closest("label, .form-group, .row, tr, li, div")?.textContent ?? "").slice(0, 240));
    const fieldKey = (element: any): string =>
      normalize(element.name || element.id || element.getAttribute("formcontrolname") || element.getAttribute("ng-reflect-name") || "");
    const nearestHeading = (element: any): string => {
      const codeContainer = element.closest(".form-body, [id^='m'], [id^='M'], [class*='m0'], [class*='m1'], [class*='gg'], [class*='o0']");
      const heading = codeContainer?.querySelector("h1,h2,h3,h4,h5,h6,.form-section,[role='heading']");
      return normalize(heading?.textContent) || normalize(element.closest(".form-body, fieldset, section, tr, div")?.querySelector("h1,h2,h3,h4,h5,h6,.form-section,[role='heading']")?.textContent);
    };
    const oasisItemCodeFor = (element: any): string | undefined => {
      const codeContainer = element.closest(".form-body, [id], [class]");
      const haystack = [
        nearestHeading(element),
        element.id,
        element.name,
        element.className,
        element.getAttribute("formcontrolname"),
        codeContainer?.id,
        codeContainer?.className,
        codeContainer?.querySelector("h1,h2,h3,h4,h5,h6,.form-section")?.textContent,
      ].map((value) => normalize(String(value ?? ""))).join(" ");
      const explicit = haystack.match(/\b(?:M|GG|O)\d{4}\b/i)?.[0];
      if (explicit) {
        return explicit.toUpperCase();
      }
      const classCode = haystack.match(/\b(?:m|gg|o)\d{4}/i)?.[0];
      return classCode?.toUpperCase();
    };
    const selectedWrapper = (element: any): any =>
      element.closest(".selected, [class*=' selected'], [class$='selected'], .ng-option-selected");
    const fields: PortalDomExtractedField[] = [];
    const seenRadioGroups = new Set<string>();

    for (const element of Array.from(documentRef.querySelectorAll("input, textarea, select")) as any[]) {
      if (element.closest("fin-select.select-oasis-pages, fin-select[class*='select-oasis-pages']")) {
        continue;
      }
      const type = "type" in element ? normalize(element.type).toLowerCase() : "";
      const key = fieldKey(element);
      const itemCode = oasisItemCodeFor(element);
      const heading = nearestHeading(element);
      const label = normalize([heading, associatedLabel(element)].filter(Boolean).join(" - "));
      if (isSensitiveKey([type, key, label, element.getAttribute("autocomplete") ?? ""].join(" "))) {
        continue;
      }
      if (type === "hidden" || type === "password" || !isVisible(element)) {
        continue;
      }
      if (type === "radio") {
        const input = element;
        const group = input.name || input.id || label || input.value;
        if (seenRadioGroups.has(group)) {
          continue;
        }
        seenRadioGroups.add(group);
        const radios = input.name
          ? Array.from(documentRef.querySelectorAll(`input[type="radio"][name="${cssEscape(input.name)}"]`)) as any[]
          : [input];
        const checked = radios.find((radio) => radio.checked || selectedWrapper(radio));
        fields.push({
          section: sectionFor(element),
          itemCode,
          label: label || group,
          key: itemCode ?? key ?? group,
          inputType: "radio",
          value: checked ? normalize(checked.value || associatedLabel(checked) || evidenceNear(checked)) : "",
          selectedText: checked ? normalize(associatedLabel(checked) || checked.value) : undefined,
          checked: Boolean(checked),
          sourceKind: "radio",
          confidence: checked ? "high" : "medium",
          evidenceText: evidenceNear(checked ?? element),
        });
        continue;
      }
      if (type === "checkbox") {
        const checkbox = element;
        const selected = Boolean(checkbox.checked || selectedWrapper(checkbox));
        fields.push({
          section: sectionFor(element),
          itemCode,
          label,
          key: itemCode ?? key,
          inputType: "checkbox",
          value: selected,
          checked: selected,
          sourceKind: "checkbox",
          confidence: label || key ? "high" : "medium",
          evidenceText: evidenceNear(element),
        });
        continue;
      }
      if (element.tagName.toLowerCase() === "select") {
        const select = element;
        const selectedOptions = (Array.from(select.selectedOptions ?? []) as any[])
          .map((option) => normalize(option.textContent || option.value))
          .filter(Boolean);
        fields.push({
          section: sectionFor(element),
          itemCode,
          label,
          key: itemCode ?? key,
          inputType: "select",
          value: select.multiple ? selectedOptions : selectedOptions[0] ?? normalize(select.value),
          selectedText: selectedOptions.join(" | ") || undefined,
          selectedValue: normalize(select.value) || undefined,
          sourceKind: "select",
          confidence: label || key ? "high" : "medium",
          evidenceText: evidenceNear(element),
        });
        continue;
      }
      fields.push({
        section: sectionFor(element),
        itemCode,
        label,
        key: itemCode ?? key,
        inputType: type || element.tagName.toLowerCase(),
        value: normalize(element.value),
        sourceKind: element.tagName.toLowerCase() === "textarea" ? "textarea" : "input",
        confidence: label || key ? "high" : "medium",
        evidenceText: evidenceNear(element),
      });
    }

    const richTextSelector = [
      "[contenteditable='true']",
      "[role='textbox']",
      "[aria-multiline='true']",
      ".ql-editor",
      ".ProseMirror",
    ].join(",");
    for (const element of Array.from(documentRef.querySelectorAll(richTextSelector)) as any[]) {
      if (!isVisible(element)) {
        continue;
      }
      if (element.closest("input, textarea, select, ng-select")) {
        continue;
      }
      const value = normalize(textOf(element));
      if (!value) {
        continue;
      }
      const key = fieldKey(element);
      const itemCode = oasisItemCodeFor(element);
      const heading = nearestHeading(element);
      const label = normalize([
        heading,
        element.getAttribute("aria-label"),
        associatedLabel(element),
        previousLabelText(element),
      ].filter(Boolean).join(" - "));
      if (isSensitiveKey([key, label].join(" "))) {
        continue;
      }
      fields.push({
        section: sectionFor(element),
        itemCode,
        label: label || heading || key || "Rich text",
        key: itemCode ?? key ?? label,
        inputType: "richtext",
        value,
        sourceKind: "textarea",
        confidence: label || key ? "high" : "medium",
        evidenceText: evidenceNear(element),
      });
    }

    for (const ngSelect of Array.from(documentRef.querySelectorAll("ng-select, fin-select ng-select")) as any[]) {
      if (!isVisible(ngSelect)) {
        continue;
      }
      if (ngSelect.closest("fin-select.select-oasis-pages, fin-select[class*='select-oasis-pages']")) {
        continue;
      }
      const label = normalize(
        ngSelect.getAttribute("aria-label") ||
        textOf(ngSelect.closest("fin-select")?.previousElementSibling) ||
        previousLabelText(ngSelect),
      );
      const value = normalize(
        textOf(ngSelect.querySelector(".ng-value")) ||
        textOf(ngSelect.querySelector(".ng-value-label")) ||
        textOf(ngSelect.querySelector(".ng-select-container")),
      );
      fields.push({
        section: sectionFor(ngSelect),
        itemCode: normalizeOasisItemCode([label, value, ngSelect.getAttribute("formcontrolname")].join(" ")),
        label,
        key: normalizeOasisItemCode([label, value, ngSelect.getAttribute("formcontrolname")].join(" ")) ?? normalize(ngSelect.getAttribute("formcontrolname") || ngSelect.getAttribute("ng-reflect-name") || ""),
        value,
        selectedText: value || undefined,
        sourceKind: "ngSelect",
        confidence: value ? "high" : "medium",
        evidenceText: normalize(textOf(ngSelect).slice(0, 240)),
      });
    }

    const tables = (Array.from(documentRef.querySelectorAll("table")) as any[]).filter(isVisible).slice(0, 50).map((table) => {
      const headers = (Array.from(table.querySelectorAll("thead th, tr:first-child th")) as any[])
        .map(textOf)
        .filter(Boolean);
      const rows = (Array.from(table.querySelectorAll("tbody tr, tr")) as any[]).slice(headers.length > 0 ? 0 : 1, 80).map((row) =>
        (Array.from(row.querySelectorAll("td, th")) as any[]).map(textOf),
      ).filter((row) => row.some(Boolean));
      return {
        section: sectionFor(table),
        title: normalize(table.getAttribute("aria-label") || textOf(table.closest("section, article, div")?.querySelector("h1,h2,h3,h4,h5,h6"))),
        headers,
        rows,
      };
    }).filter((table) => table.headers.length > 0 || table.rows.length > 0);

    const visibleLines = (Array.from(documentRef.body.querySelectorAll(`h1,h2,h3,h4,h5,h6,p,li,dt,dd,label,span,strong,td,th,${richTextSelector}`)) as any[])
      .filter(isVisible)
      .map(textOf)
      .filter((text) =>
        text.length >= 3 &&
        text.length <= 260 &&
        !/^(print|save|cancel|close|search|loading|automatic zoom|page \d+)/i.test(text) &&
        !/\b(password|token|session|cookie|bearer)\b/i.test(text),
      );
    const uniqueLines = Array.from(new Set(visibleLines)).slice(0, 120);
    const visibleTextDigest = uniqueLines.join("\n").slice(0, 8_000);

    return {
      title: sectionTitle || normalize(documentRef.querySelector("h1,h2,h3,[role='heading']")?.textContent) || documentRef.title || "Current Page",
      fields,
      tables,
      visibleTextDigest,
    } satisfies RawDomSection;
  }, { sectionTitle: options.sectionTitle });

  const section: PortalDomExtractedSection = {
    ...raw,
    title: normalizeWhitespace(options.sectionTitle ?? raw.title) || "Current Page",
    status: raw.fields.length > 0 || raw.tables.length > 0 ? "success" : "degraded",
    fallbackReasons: raw.fields.length > 0 || raw.tables.length > 0 ? [] : ["no_structured_controls_found_on_current_page"],
  };

  return buildPortalDomExtractedState({
    sourceArea: options.sourceArea,
    sections: [section],
    routePattern: sanitizeRoutePattern(page.url()),
    thresholds: options,
  });
}

export async function writePortalDomExtractedState(input: {
  state: PortalDomExtractedState;
  writeFile: (content: string) => Promise<void>;
}): Promise<void> {
  await input.writeFile(JSON.stringify(input.state, null, 2));
}
