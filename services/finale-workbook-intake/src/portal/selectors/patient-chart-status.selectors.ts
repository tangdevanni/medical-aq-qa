import type { PortalSelectorCandidate } from "./types";

export const patientChartStatusSelectors: {
  admissionStatusBadge: PortalSelectorCandidate[];
} = {
  admissionStatusBadge: [
    {
      strategy: "css",
      selector: "app-patient-status span.status.badge",
      description: "Patient admission status badge in app-patient-status component",
    },
    {
      strategy: "css",
      selector: "app-patient-status .status.badge",
      description: "Patient admission status badge by status badge class",
    },
    {
      strategy: "css",
      selector: "div.nav__status app-patient-status .badge",
      description: "Patient admission status badge inside nav__status header area",
    },
    {
      strategy: "text",
      value: /non[-\s]?admit|pending/i,
      description: "Patient admission status badge by visible Non-Admit or Pending text",
    },
  ],
} as const;
