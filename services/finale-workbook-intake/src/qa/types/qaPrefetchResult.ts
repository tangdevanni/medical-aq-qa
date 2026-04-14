export type QaRouteClassification =
  | "patient_chart"
  | "patient_documents"
  | "provider_documents"
  | "unknown";

export type QaSignalSource =
  | "url"
  | "sidebar_label"
  | "page_text"
  | "button"
  | "interactive_label";

export type QaLockStatus = "locked" | "unlocked" | "unknown";

export interface QaRouteCandidate {
  label: string;
  classification: QaRouteClassification;
  source: QaSignalSource;
  confidence: "high" | "medium" | "low";
  matchedValue: string;
}

export interface QaDiscoverySignal {
  source: QaSignalSource;
  value: string;
}

export interface QaVisibleDiagnosis {
  text: string;
  code: string | null;
  description: string | null;
}

export interface QaPrefetchRouteSection {
  currentUrl: string;
  sidebarLabels: string[];
  topVisibleText: string[];
  routeCandidates: QaRouteCandidate[];
  selectedRoute: QaRouteCandidate | null;
  warnings: string[];
}

export interface QaPrefetchDetectionSection {
  found: boolean;
  signals: QaDiscoverySignal[];
  warnings: string[];
}

export interface QaPrefetchDiagnosisSection extends QaPrefetchDetectionSection {
  visibleDiagnoses: QaVisibleDiagnosis[];
}

export interface QaPrefetchLockSection {
  status: QaLockStatus;
  signals: QaDiscoverySignal[];
}

export interface QaPrefetchResult {
  workflowDomain: "qa";
  workflowRunId: string;
  patientRunId: string;
  patientName: string;
  patientId: string | null;
  chartUrl: string;
  dashboardUrl: string | null;
  resolvedAt: string;
  status: "COMPLETED" | "COMPLETED_WITH_WARNINGS";
  routeDiscovery: QaPrefetchRouteSection;
  oasisRoute: QaPrefetchDetectionSection;
  diagnosisRoute: QaPrefetchDiagnosisSection;
  lockStatus: QaPrefetchLockSection;
  selectedRouteSummary: string;
  warningCount: number;
  topWarning: string | null;
  warnings: string[];
  createdAt: string;
}
