import { type DocumentKind, type FieldWriteAction, type FieldWriteStrategy, type WriteMode } from "@medical-ai-qa/shared-types";

export type FieldInteractionType = "input" | "textarea" | "contenteditable";

export type FieldSelectorCandidate =
  | {
      kind: "selector";
      selector: string;
      description: string;
    }
  | {
      kind: "label";
      label: RegExp;
      description: string;
    };

export interface WriteAllowlistEntry {
  targetDocumentKind: DocumentKind;
  targetField: string;
  supportedAction: FieldWriteAction;
  supportedChangeStrategy: FieldWriteStrategy;
  maxLength: number;
  allowedExecutionModes: readonly WriteMode[];
  allowEmptyCurrentValue: boolean;
  allowReplaceNonEmptyCurrentValue: boolean;
  requiresTargetAnchorMatch: boolean;
  requiresHighConfidence: boolean;
}

export interface TargetFieldMapping {
  targetDocumentKind: DocumentKind;
  targetField: string;
  interactionType: FieldInteractionType;
  candidates: readonly FieldSelectorCandidate[];
}

export interface WriteLocatorLike {
  count(): Promise<number>;
  nth(index: number): WriteLocatorLike;
  isVisible(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  inputValue(): Promise<string>;
  textContent(): Promise<string | null>;
  innerText(): Promise<string>;
  fill(value: string): Promise<void>;
  evaluate<T>(pageFunction: (node: unknown) => T | Promise<T>): Promise<T>;
}

export interface WritePageLike {
  locator(selector: string): WriteLocatorLike;
  getByLabel(text: string | RegExp): WriteLocatorLike;
  url(): string;
}

export interface ResolvedFieldTarget {
  selectorUsed: string;
  interactionType: FieldInteractionType;
  locator: WriteLocatorLike;
}
