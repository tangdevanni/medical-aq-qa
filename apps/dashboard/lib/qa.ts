export function batchStatusClass(status: string): string {
  if (status === "COMPLETED") {
    return "badge success";
  }

  if (status === "FAILED") {
    return "badge danger";
  }

  if (status === "COMPLETED_WITH_EXCEPTIONS" || status === "RUNNING") {
    return "badge warning";
  }

  return "badge";
}

export function formatDaysLeft(daysLeft: number | null): string {
  if (daysLeft === null) {
    return "Needs Review";
  }

  if (daysLeft < 0) {
    return `${Math.abs(daysLeft)} day(s) overdue`;
  }

  if (daysLeft === 0) {
    return "Due today";
  }

  return `${daysLeft} day(s) left`;
}
