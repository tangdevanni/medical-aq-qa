import { type ResolvedFieldTarget } from "../../types/writeTargets";

export async function writeFieldValue(
  target: ResolvedFieldTarget,
  proposedValue: string,
): Promise<void> {
  switch (target.interactionType) {
    case "input":
    case "textarea":
    case "contenteditable":
      await target.locator.fill(proposedValue);
      return;
  }
}
