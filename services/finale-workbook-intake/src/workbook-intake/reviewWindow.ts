import type { ReviewWindow } from "@medical-ai-qa/shared-types";

export function createReviewWindow(input: {
  agencyId: string;
  startsAt: string;
  timezone: string;
  durationDays?: number;
}): ReviewWindow {
  const durationDays = input.durationDays ?? 15;
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000);
  const startDate = startsAt.toISOString().slice(0, 10);
  const endDate = endsAt.toISOString().slice(0, 10);

  return {
    id: `${input.agencyId}-${startDate}`,
    agencyId: input.agencyId,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    durationDays,
    timezone: input.timezone,
    label: `${startDate} to ${endDate}`,
  };
}
