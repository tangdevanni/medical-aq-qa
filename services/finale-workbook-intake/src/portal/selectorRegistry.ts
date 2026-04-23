import { chartArtifactSelectors } from "./selectors/chart-artifact.selectors";
import { finaleDashboardSelectors } from "./selectors/finale-dashboard.selectors";
import { loginSelectors } from "./selectors/login.selectors";
import { patientChartStatusSelectors } from "./selectors/patient-chart-status.selectors";
import { patientSearchSelectors } from "./selectors/patient-search.selectors";
import { userAgenciesSelectors } from "./selectors/user-agencies.selectors";

export const selectorRegistry = {
  finaleDashboard: finaleDashboardSelectors,
  login: loginSelectors,
  patientChartStatus: patientChartStatusSelectors,
  patientSearch: patientSearchSelectors,
  userAgencies: userAgenciesSelectors,
  chartArtifacts: chartArtifactSelectors,
} as const;
