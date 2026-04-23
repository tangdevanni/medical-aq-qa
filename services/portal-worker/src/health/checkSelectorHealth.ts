import { type SelectorHealthRecord } from "../types/runtimeDiagnostics";
import { type WorkflowPageLike } from "../types/workflowSteps";
import { type WritePageLike } from "../types/writeTargets";
import { countVisibleMatches, deriveSelectorHealthStatus } from "./selectorHealthHelpers";
import { type SelectorHealthRegistryEntry } from "./selectorHealthRegistry";

type SelectorHealthPageLike = Pick<WorkflowPageLike, "locator" | "getByRole"> & Partial<WritePageLike>;

export async function checkSelectorHealth(input: {
  page: SelectorHealthPageLike;
  entry: SelectorHealthRegistryEntry;
}): Promise<SelectorHealthRecord> {
  let matchedCount = 0;
  let selectorUsed: string | null = null;

  for (const candidate of input.entry.candidates) {
    const currentMatchedCount = await countVisibleMatches(() => {
      switch (candidate.kind) {
        case "selector":
          return input.page.locator(candidate.value as string);
        case "button":
          return input.page.getByRole("button", {
            name: candidate.value as string | RegExp,
            exact: typeof candidate.value === "string",
          });
        case "label":
          if (!("getByLabel" in input.page) || typeof input.page.getByLabel !== "function") {
            return input.page.locator("__missing_label_probe__");
          }
          return input.page.getByLabel(candidate.value as string | RegExp);
      }
    });

    if (currentMatchedCount > 0) {
      matchedCount = currentMatchedCount;
      selectorUsed = candidate.description;
      break;
    }
  }

  const status = deriveSelectorHealthStatus({
    matchedCount,
    required: input.entry.required,
  });

  return {
    name: input.entry.name,
    documentKind: input.entry.documentKind,
    phase: input.entry.phase,
    action: input.entry.action,
    targetField: input.entry.targetField,
    required: input.entry.required,
    expectedCardinality: input.entry.expectedCardinality,
    status,
    matchedCount,
    selectorUsed,
    supportDisposition: input.entry.supportDisposition,
    supportLevel: null,
    reason: status === "HEALTHY"
      ? "Selector resolved deterministically."
      : status === "AMBIGUOUS"
        ? "Selector resolved to multiple visible controls."
        : status === "MISSING"
          ? "Required selector did not resolve."
          : "Selector did not resolve and is not required for this check.",
  };
}
