import type { WorkflowType } from "@medical-ai-qa/shared-types";

function normalizeToken(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

export function deriveSocWorkflowTypes(rfa: string | null | undefined): WorkflowType[] {
  const normalized = normalizeToken(rfa);

  if (normalized.includes("ROC")) {
    return ["ROC"];
  }

  if (normalized.includes("REC")) {
    return ["RECERT"];
  }

  return ["SOC"];
}

export function deriveDcWorkflowTypes(rfa: string | null | undefined): WorkflowType[] {
  const normalized = normalizeToken(rfa);
  const workflowTypes: WorkflowType[] = [];

  if (normalized.includes("TRANSFER") || normalized.includes("TXR")) {
    workflowTypes.push("TRANSFER");
  }

  if (normalized.includes("DEATH")) {
    workflowTypes.push("DEATH");
  }

  if (workflowTypes.length === 0 || normalized.includes("DC")) {
    workflowTypes.unshift("DC");
  }

  return Array.from(new Set([...workflowTypes, "BILLING_PREP"]));
}
