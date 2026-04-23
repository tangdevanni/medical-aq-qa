export type OasisCodingNavigationResult = {
  chartUrl: string;
  oasisMenuAccessible: boolean;
  availableOasisTypes: string[];
  socOpened: boolean;
  socUrl?: string;
  socMarkersFound: string[];
  diagnosisNavigationMethod?: string;
  diagnosisSectionOpened: boolean;
  diagnosisListFound: boolean;
  diagnosisListStatus: "POPULATED" | "EMPTY" | "UNKNOWN";
  diagnosisListSamples: string[];
  fileUploadsAccessible: boolean;
  fileUploadsUrl?: string;
  visibleUploadedDocuments: string[];
  admissionOrderAccessible: boolean;
  admissionOrderTitle?: string;
  warnings: string[];
};

export function summarizeOasisCodingNavigation(result: OasisCodingNavigationResult): {
  found: string[];
  missing: string[];
  evidence: string[];
} {
  return {
    found: [
      `oasisMenuAccessible:${result.oasisMenuAccessible}`,
      `socOpened:${result.socOpened}`,
      `diagnosisSectionOpened:${result.diagnosisSectionOpened}`,
      `diagnosisListFound:${result.diagnosisListFound}`,
      `diagnosisListStatus:${result.diagnosisListStatus}`,
      `fileUploadsAccessible:${result.fileUploadsAccessible}`,
      `admissionOrderAccessible:${result.admissionOrderAccessible}`,
      ...result.availableOasisTypes.slice(0, 8).map((value) => `oasisType:${value}`),
    ],
    missing: [
      ...(result.oasisMenuAccessible ? [] : ["OASIS menu"]),
      ...(result.socOpened ? [] : ["SOC OASIS"]),
      ...(result.diagnosisSectionOpened ? [] : ["DIAGNOSIS section"]),
      ...(result.diagnosisListFound ? [] : ["diagnosis list"]),
      ...(result.fileUploadsAccessible ? [] : ["File Uploads"]),
      ...(result.admissionOrderAccessible ? [] : ["Admission Order"]),
    ],
    evidence: [
      `Chart URL: ${result.chartUrl}`,
      `Available OASIS types: ${result.availableOasisTypes.join(" | ") || "none"}`,
      `SOC URL: ${result.socUrl ?? "none"}`,
      `SOC markers: ${result.socMarkersFound.join(" | ") || "none"}`,
      `Diagnosis navigation method: ${result.diagnosisNavigationMethod ?? "none"}`,
      `Diagnosis list samples: ${result.diagnosisListSamples.join(" | ") || "none"}`,
      `File Uploads URL: ${result.fileUploadsUrl ?? "none"}`,
      `Visible uploaded documents: ${result.visibleUploadedDocuments.join(" | ") || "none"}`,
      `Admission Order title: ${result.admissionOrderTitle ?? "none"}`,
      `Warnings: ${result.warnings.join(" | ") || "none"}`,
    ],
  };
}
