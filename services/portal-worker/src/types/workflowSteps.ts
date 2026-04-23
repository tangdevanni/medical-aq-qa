import { type DocumentKind } from "@medical-ai-qa/shared-types";
import {
  type FinalizeAction,
  type WorkflowMode,
  type WorkflowStateSnapshot,
  type WorkflowStepResult,
} from "./workflowCompletion";

export type {
  FinalizeAction,
  WorkflowMode,
  WorkflowStateSnapshot,
  WorkflowStepResult,
};

export interface WorkflowLocatorLike {
  count(): Promise<number>;
  nth(index: number): WorkflowLocatorLike;
  isVisible(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  click(): Promise<void>;
  textContent(): Promise<string | null>;
  innerText(): Promise<string>;
}

export interface WorkflowPageLike {
  locator(selector: string): WorkflowLocatorLike;
  getByRole(
    role: "button" | "link",
    options: {
      name: string | RegExp;
      exact?: boolean;
    },
  ): WorkflowLocatorLike;
  url(): string;
  waitForTimeout?(timeoutMs: number): Promise<void>;
}

export type WorkflowActionTargetCandidate =
  | {
      kind: "selector";
      selector: string;
      description: string;
    }
  | {
      kind: "button";
      name: string | RegExp;
      exact?: boolean;
      description: string;
    };

export interface WorkflowActionSelectorDefinition {
  targetDocumentKind: DocumentKind;
  action: FinalizeAction;
  candidates: readonly WorkflowActionTargetCandidate[];
  successSelectors: readonly string[];
  dirtySelectors: readonly string[];
  routePatterns: readonly RegExp[];
}

export interface ResolvedWorkflowActionTarget {
  selectorUsed: string;
  locator: WorkflowLocatorLike;
}
