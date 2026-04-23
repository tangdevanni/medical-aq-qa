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

export function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

export function discrepancyBadgeClass(rating: "green" | "yellow" | "red"): string {
  if (rating === "green") {
    return "badge success";
  }

  if (rating === "red") {
    return "badge danger";
  }

  return "badge warning";
}

export function discrepancyLabel(rating: "green" | "yellow" | "red"): string {
  if (rating === "green") {
    return "Low discrepancy";
  }

  if (rating === "red") {
    return "High discrepancy";
  }

  return "Moderate discrepancy";
}
