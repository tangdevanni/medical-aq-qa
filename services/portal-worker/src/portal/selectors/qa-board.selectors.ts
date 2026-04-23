export const QA_BOARD_SELECTORS = {
  rootSelectors: [
    '[class*="board"]',
    '[class*="Board"]',
    '[class*="kanban"]',
    '[class*="Kanban"]',
    '[data-testid*="board"]',
    '[data-testid*="qa"]',
  ],
  pageMarkers: [
    'text="Orders and QA Management"',
    'text="Not Started"',
    'text="In Progress"',
  ],
  cardSelectors: [
    'article',
    '[role="article"]',
    '[data-testid*="card"]',
    '[class*="card"]',
    '[class*="Card"]',
    '[class*="item"]',
    '[class*="Item"]',
  ],
  statusTexts: [
    "Not Started",
    "In Progress",
    "Completed",
    "Ready for Review",
    "Pending",
  ],
  workItemTypeTexts: [
    "Visit Note",
    "Discharge Summary",
    "Phys. Order Others",
    "Physician Order Others",
    "OASIS",
  ],
} as const;
