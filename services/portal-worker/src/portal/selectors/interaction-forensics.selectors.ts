export const INTERACTION_FORENSICS_SELECTORS = {
  interactiveDescendantSelectors: [
    ".shortcut-item.cursor-pointer",
    '[class*="cursor-pointer"]',
    'a[href]',
    'button',
    '[role="button"]',
    '[role="link"]',
    '[tabindex]:not([tabindex="-1"])',
    '[onclick]',
    '[style*="cursor: pointer"]',
    '[class*="icon"][tabindex]',
    '[class*="Icon"][tabindex]',
  ],
  primaryActionHintSelectors: [
    'a[href]',
    'button',
    '[role="button"]',
    '[role="link"]',
    '[class*="primary"]',
    '[class*="Primary"]',
  ],
} as const;
