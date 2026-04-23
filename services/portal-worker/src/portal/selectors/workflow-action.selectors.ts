export const WORKFLOW_ACTION_SELECTORS = {
  visitNote: {
    routePatterns: [/\/documents\/note\/visitnote\//i],
    savePage: {
      selectors: [
        'button[data-testid="visit-note-save"]',
        'button[data-testid="save-visit-note"]',
        'button[name="saveVisitNote"]',
        'button[form="visit-note-form"][type="submit"]',
      ],
      buttonNames: ["Save", "Save Draft", "Save Page"],
      successSelectors: [
        '[data-testid="save-success-toast"]',
        '[data-testid="visit-note-save-success"]',
        'text=/changes saved|all changes saved|saved successfully/i',
      ],
      dirtySelectors: [
        '[data-testid="unsaved-changes"]',
        '[class*="unsaved"]',
        '[class*="dirty"]',
        'text=/unsaved changes|pending changes|not saved/i',
      ],
    },
    validatePage: {
      selectors: [
        'button[data-testid="visit-note-validate"]',
        'button[data-testid="validate-visit-note"]',
        'button[name="validateVisitNote"]',
      ],
      buttonNames: ["Validate", "Validate Page"],
      successSelectors: [
        '[data-testid="validation-success"]',
        '[data-testid="visit-note-validated"]',
        'text=/validated|validation complete/i',
      ],
      dirtySelectors: [
        '[data-testid="unsaved-changes"]',
        '[class*="unsaved"]',
        '[class*="dirty"]',
        'text=/unsaved changes|pending changes|not saved/i',
      ],
    },
    lockRecord: {
      selectors: [
        'button[data-testid="visit-note-lock"]',
        'button[data-testid="lock-visit-note"]',
        'button[name="lockVisitNote"]',
      ],
      buttonNames: ["Lock", "Lock Record"],
      successSelectors: [
        '[data-testid="record-locked"]',
        '[data-testid="visit-note-locked"]',
        'text=/locked|record locked/i',
      ],
      dirtySelectors: [
        '[data-testid="unsaved-changes"]',
        '[class*="unsaved"]',
        '[class*="dirty"]',
      ],
    },
    markQaComplete: {
      selectors: [
        'button[data-testid="qa-complete"]',
        'button[data-testid="mark-qa-complete"]',
        'button[name="markQaComplete"]',
      ],
      buttonNames: ["QA Complete", "Mark QA Complete"],
      successSelectors: [
        '[data-testid="qa-complete-badge"]',
        '[data-testid="qa-complete-success"]',
        'text=/qa complete|quality assurance complete/i',
      ],
      dirtySelectors: [
        '[data-testid="unsaved-changes"]',
        '[class*="unsaved"]',
        '[class*="dirty"]',
      ],
    },
  },
  oasis: {
    routePatterns: [/\/documents\/(?:assessment|oasis)\//i],
    savePage: {
      selectors: [
        'button[data-testid="oasis-save"]',
        'button[data-testid="save-oasis"]',
        'button[name="saveOasis"]',
      ],
      buttonNames: ["Save OASIS"],
      successSelectors: [
        '[data-testid="oasis-save-success"]',
        '[data-testid="save-success-toast"]',
        'text=/oasis saved|changes saved/i',
      ],
      dirtySelectors: [
        '[data-testid="unsaved-changes"]',
        '[class*="unsaved"]',
        '[class*="dirty"]',
      ],
    },
    validatePage: {
      selectors: [
        'button[data-testid="oasis-validate"]',
        'button[name="validateOasis"]',
      ],
      buttonNames: ["Validate OASIS"],
      successSelectors: [
        '[data-testid="oasis-validated"]',
        '[data-testid="validation-success"]',
        'text=/validated/i',
      ],
      dirtySelectors: [
        '[data-testid="unsaved-changes"]',
        '[class*="unsaved"]',
        '[class*="dirty"]',
      ],
    },
  },
  planOfCare: {
    routePatterns: [/\/documents\/(?:planofcare|plan-of-care|poc)\//i],
    savePage: {
      selectors: [
        'button[data-testid="poc-save"]',
        'button[data-testid="save-plan-of-care"]',
        'button[name="savePlanOfCare"]',
      ],
      buttonNames: ["Save Plan of Care", "Save POC"],
      successSelectors: [
        '[data-testid="poc-save-success"]',
        '[data-testid="save-success-toast"]',
        'text=/plan of care saved|changes saved/i',
      ],
      dirtySelectors: [
        '[data-testid="unsaved-changes"]',
        '[class*="unsaved"]',
        '[class*="dirty"]',
      ],
    },
    validatePage: {
      selectors: [
        'button[data-testid="poc-validate"]',
        'button[name="validatePlanOfCare"]',
      ],
      buttonNames: ["Validate Plan of Care", "Validate POC"],
      successSelectors: [
        '[data-testid="poc-validated"]',
        '[data-testid="validation-success"]',
        'text=/validated/i',
      ],
      dirtySelectors: [
        '[data-testid="unsaved-changes"]',
        '[class*="unsaved"]',
        '[class*="dirty"]',
      ],
    },
  },
  admissionOrder: {
    routePatterns: [/\/documents\/(?:order|orders)\/(?:admission|admit)\b/i],
    savePage: {
      selectors: [
        'button[data-testid="admission-order-save"]',
        'button[name="saveAdmissionOrder"]',
      ],
      buttonNames: ["Save Admission Order"],
      successSelectors: [
        '[data-testid="order-save-success"]',
        '[data-testid="save-success-toast"]',
      ],
      dirtySelectors: [
        '[data-testid="unsaved-changes"]',
        '[class*="unsaved"]',
        '[class*="dirty"]',
      ],
    },
  },
  physicianOrder: {
    routePatterns: [/\/documents\/(?:order|orders)\//i],
    savePage: {
      selectors: [
        'button[data-testid="physician-order-save"]',
        'button[name="savePhysicianOrder"]',
      ],
      buttonNames: ["Save Physician Order"],
      successSelectors: [
        '[data-testid="order-save-success"]',
        '[data-testid="save-success-toast"]',
      ],
      dirtySelectors: [
        '[data-testid="unsaved-changes"]',
        '[class*="unsaved"]',
        '[class*="dirty"]',
      ],
    },
  },
} as const;
