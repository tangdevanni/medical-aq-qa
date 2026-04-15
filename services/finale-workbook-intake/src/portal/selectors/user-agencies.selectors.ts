import type { PortalSelectorCandidate } from "./types";

export const userAgenciesSelectors: {
  pageMarkers: PortalSelectorCandidate[];
  agencyOptions: PortalSelectorCandidate[];
} = {
  pageMarkers: [
    {
      strategy: "role",
      role: "heading",
      name: /agency|agencies/i,
      description: "user-agencies heading by accessible role",
    },
    {
      strategy: "text",
      value: /select agency|user agencies|agencies/i,
      description: "user-agencies marker by visible text",
    },
    {
      strategy: "css",
      selector: 'a[href*="/provider/"], [href*="/users/user-agencies"]',
      description: "user-agencies provider links or self-reference links",
    },
  ],
  agencyOptions: [
    {
      strategy: "css",
      selector: 'a[href*="/provider/"]',
      description: "agency links by provider href",
    },
    {
      strategy: "css",
      selector: 'main :is(a[href], button, [role="button"], [role="link"], fin-button, [tabindex="0"])',
      description: "agency options by generic clickable controls inside main content",
    },
    {
      strategy: "text",
      value: /home health|hospice|agency/i,
      description: "agency options by agency-related visible text",
    },
  ],
};
