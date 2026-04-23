import type { DashboardPatientRecord, QueueEntryStatus } from "@medical-ai-qa/shared-types";

export interface PatientBoardBadgeState {
  label: string;
  className: string;
  detail: string;
}

export function queueStatusBadgeClass(status: QueueEntryStatus): string {
  if (status === "eligible") {
    return "badge success";
  }
  if (status === "skipped_pending") {
    return "badge warning";
  }
  if (status === "excluded_other") {
    return "badge danger";
  }
  return "badge";
}

export function getQaReadiness(input: DashboardPatientRecord): PatientBoardBadgeState {
  if (input.queueEntry.status !== "eligible") {
    if (input.queueEntry.status === "skipped_pending") {
      return {
        label: "Not Ready",
        className: "badge warning",
        detail: "Workbook row is still pending and should not enter QA yet.",
      };
    }

    return {
      label: "Out of Scope",
      className: "badge",
      detail: "This patient is not in the active QA work queue.",
    };
  }

  switch (input.qaOutcome) {
    case "READY_FOR_BILLING_PREP":
      return {
        label: "Ready for QA",
        className: "badge success",
        detail: "Required extraction steps completed and the patient is ready for QA review.",
      };
    case "MISSING_DOCUMENTS":
      return input.missingReferralDocumentation
        ? {
            label: "Referral Needed",
            className: "badge danger",
            detail: "OASIS is available; referral follow-up is needed.",
          }
        : {
            label: "Missing Supporting Docs",
            className: "badge warning",
            detail: "Supporting documentation is incomplete.",
          };
    case "INCOMPLETE":
      return {
        label: "Needs Follow-Up",
        className: "badge warning",
        detail: "Automation captured part of the QA workspace, but additional review steps remain.",
      };
    case "PORTAL_NOT_FOUND":
    case "PORTAL_MISMATCH":
    case "AMBIGUOUS_PATIENT":
      return {
        label: "Blocked",
        className: "badge danger",
        detail: "The backend could not safely resolve the portal patient record.",
      };
    case "NEEDS_MANUAL_QA":
      return {
        label: "Manual QA",
        className: "badge warning",
        detail: "Automation completed enough context to hand this patient directly to manual QA review.",
      };
    default:
      if (
        input.processingStatus &&
        ["MATCHING_PATIENT", "DISCOVERING_CHART", "COLLECTING_EVIDENCE", "RUNNING_QA", "PENDING"].includes(
          input.processingStatus,
        )
      ) {
        return {
          label: "Building QA View",
          className: "badge warning",
          detail: "The backend is still assembling the latest patient QA view.",
        };
      }

      if (input.runId && input.patientId) {
        return {
          label: "Review Available",
          className: "badge",
          detail: "Patient detail exists, but the backend has not assigned a final QA outcome yet.",
        };
      }

      return {
        label: "Awaiting Run",
        className: "badge",
        detail: "This patient is in the workbook queue but no patient detail run is available yet.",
      };
  }
}

export function getSourceCoverage(input: DashboardPatientRecord): PatientBoardBadgeState {
  if (input.runId && input.patientId && input.missingReferralDocumentation) {
    return {
      label: "OASIS only",
      className: "badge warning",
      detail: "Referral documentation was not captured.",
    };
  }

  if (
    input.runId &&
    input.patientId &&
    (input.qaOutcome === "MISSING_DOCUMENTS" || input.qaOutcome === "INCOMPLETE")
  ) {
    return {
      label: "OASIS + limited docs",
      className: "badge warning",
      detail: "Some supporting documents were captured; the packet is incomplete.",
    };
  }

  if (input.runId && input.patientId) {
    return {
      label: "OASIS + Referral",
      className: "badge success",
      detail: "OASIS and referral-backed comparison data are available.",
    };
  }

  if (input.queueEntry.status === "eligible") {
    return {
      label: "Awaiting capture",
      className: "badge",
      detail: "This patient is eligible, but the dashboard has not captured patient artifacts yet.",
    };
  }

  return {
    label: "No patient detail",
    className: "badge",
    detail: "No patient detail workspace is available for this queue entry.",
  };
}
