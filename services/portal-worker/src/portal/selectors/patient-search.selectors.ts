export const PATIENT_SEARCH_SELECTORS = {
  inputSelectors: [
    'input[placeholder*="Search Patient"]',
    'input[aria-label*="Search Patient"]',
    'input[name*="patient"][type="search"]',
    'input[type="search"]',
  ],
  placeholderPatterns: [/Search Patient/i, /Search Patients?/i],
  labelPatterns: [/Search Patient/i],
} as const;
