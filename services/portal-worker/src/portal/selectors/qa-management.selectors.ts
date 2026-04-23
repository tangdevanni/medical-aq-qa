export const QA_MANAGEMENT_SELECTORS = {
  entrySelectors: [
    'a:has-text("Orders and QA Management")',
    'button:has-text("Orders and QA Management")',
    '[role="button"]:has-text("Orders and QA Management")',
    '[class*="tile"]:has-text("Orders and QA Management")',
    '[class*="card"]:has-text("Orders and QA Management")',
  ],
  pageMarkers: [
    'text="Orders and QA Management"',
    'text="Not Started"',
    'text="In Progress"',
  ],
} as const;
