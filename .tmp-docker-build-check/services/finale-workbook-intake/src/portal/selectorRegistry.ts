import { chartArtifactSelectors } from "./selectors/chart-artifact.selectors";
import { loginSelectors } from "./selectors/login.selectors";
import { patientSearchSelectors } from "./selectors/patient-search.selectors";

export const selectorRegistry = {
  login: loginSelectors,
  patientSearch: patientSearchSelectors,
  chartArtifacts: chartArtifactSelectors,
} as const;
