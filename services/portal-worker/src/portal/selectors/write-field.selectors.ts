export const WRITE_FIELD_SELECTORS = {
  visitNoteFrequencySummary: {
    selectors: [
      'textarea[formcontrolname="frequencySummary"]',
      'textarea[name="frequencySummary"]',
      'input[formcontrolname="frequencySummary"]',
      'input[name="frequencySummary"]',
      'textarea[id*="frequency"]',
      'input[id*="frequency"]',
    ],
    labelPatterns: [
      /\bvisit frequency\b/i,
      /\btherapy frequency\b/i,
      /\bfrequency\b/i,
    ],
  },
  oasisFrequencySummary: {
    selectors: [
      'textarea[formcontrolname="frequencySummary"]',
      'textarea[name="frequencySummary"]',
      'textarea[data-testid="oasis-frequency-summary"]',
      'input[data-testid="oasis-frequency-summary"]',
    ],
    labelPatterns: [
      /\boasis frequency\b/i,
      /\bvisit frequency\b/i,
      /\bfrequency summary\b/i,
    ],
  },
  planOfCareFrequencySummary: {
    selectors: [
      'textarea[formcontrolname="frequencySummary"]',
      'textarea[name="frequencySummary"]',
      'textarea[data-testid="poc-frequency-summary"]',
      'input[data-testid="poc-frequency-summary"]',
    ],
    labelPatterns: [
      /\bplan of care frequency\b/i,
      /\bvisit frequency\b/i,
      /\bfrequency summary\b/i,
    ],
  },
  orderSummary: {
    selectors: [
      'textarea[formcontrolname="orderSummary"]',
      'textarea[name="orderSummary"]',
      'textarea[data-testid="order-summary"]',
      'input[data-testid="order-summary"]',
    ],
    labelPatterns: [
      /\border summary\b/i,
      /\border details\b/i,
      /\border note\b/i,
    ],
  },
} as const;
