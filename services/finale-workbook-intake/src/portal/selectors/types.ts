import type { Locator, Page } from "@playwright/test";

type LocatorRole = Parameters<Page["getByRole"]>[0];

export type SelectorStrategy =
  | "role"
  | "label"
  | "placeholder"
  | "text"
  | "css"
  | "xpath";

interface BasePortalSelectorCandidate {
  description: string;
  strategy: SelectorStrategy;
}

export interface RoleSelectorCandidate extends BasePortalSelectorCandidate {
  strategy: "role";
  role: LocatorRole;
  name?: string | RegExp;
  exact?: boolean;
}

export interface LabelSelectorCandidate extends BasePortalSelectorCandidate {
  strategy: "label";
  value: string | RegExp;
  exact?: boolean;
}

export interface PlaceholderSelectorCandidate extends BasePortalSelectorCandidate {
  strategy: "placeholder";
  value: string | RegExp;
  exact?: boolean;
}

export interface TextSelectorCandidate extends BasePortalSelectorCandidate {
  strategy: "text";
  value: string | RegExp;
  exact?: boolean;
}

export interface CssSelectorCandidate extends BasePortalSelectorCandidate {
  strategy: "css";
  selector: string;
}

export interface XPathSelectorCandidate extends BasePortalSelectorCandidate {
  strategy: "xpath";
  selector: string;
}

export type PortalSelectorCandidate =
  | RoleSelectorCandidate
  | LabelSelectorCandidate
  | PlaceholderSelectorCandidate
  | TextSelectorCandidate
  | CssSelectorCandidate
  | XPathSelectorCandidate;

export function selectorValueToString(value: string | RegExp | undefined): string {
  if (value === undefined) {
    return "";
  }

  return typeof value === "string" ? value : value.toString();
}

export function describeSelectorCandidate(candidate: PortalSelectorCandidate): string {
  switch (candidate.strategy) {
    case "role":
      return `role=${candidate.role} name=${selectorValueToString(candidate.name)} :: ${candidate.description}`;
    case "label":
    case "placeholder":
    case "text":
      return `${candidate.strategy}=${selectorValueToString(candidate.value)} :: ${candidate.description}`;
    case "css":
    case "xpath":
      return `${candidate.strategy}=${candidate.selector} :: ${candidate.description}`;
  }
}

export function buildLocatorForCandidate(page: Page | Locator, candidate: PortalSelectorCandidate): Locator {
  switch (candidate.strategy) {
    case "role":
      return page.getByRole(candidate.role, {
        name: candidate.name,
        exact: candidate.exact,
      });
    case "label":
      return page.getByLabel(candidate.value, {
        exact: candidate.exact,
      });
    case "placeholder":
      return page.getByPlaceholder(candidate.value, {
        exact: candidate.exact,
      });
    case "text":
      return page.getByText(candidate.value, {
        exact: candidate.exact,
      });
    case "css":
      return page.locator(candidate.selector);
    case "xpath":
      return page.locator(`xpath=${candidate.selector}`);
  }
}
