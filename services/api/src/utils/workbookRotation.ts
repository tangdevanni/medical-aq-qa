const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1_000;

export function isWorkbookRotationDue(
  uploadedAt: string | null | undefined,
  nowIsoTimestamp: string,
): boolean {
  if (!uploadedAt) {
    return true;
  }

  const uploadedAtMs = Date.parse(uploadedAt);
  const nowMs = Date.parse(nowIsoTimestamp);
  if (Number.isNaN(uploadedAtMs) || Number.isNaN(nowMs)) {
    return true;
  }

  return nowMs - uploadedAtMs >= FIFTEEN_DAYS_MS;
}
