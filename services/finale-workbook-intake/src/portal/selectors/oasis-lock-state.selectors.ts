import type { PortalSelectorCandidate } from "./types";

export const oasisLockStateSelectors = {
  topActionBar: [
    {
      strategy: "css",
      selector: "app-oasis .btn-toolbar, app-oasis [class*='action-bar'], app-oasis [class*='top-bar'], app-oasis [class*='header-action'], app-document-note .btn-toolbar, fin-slideover .btn-toolbar, fin-modal .btn-toolbar",
      description: "OASIS top action bar / toolbar container",
    },
  ] satisfies PortalSelectorCandidate[],
  unlockControl: [
    {
      strategy: "role",
      role: "button",
      name: /unlock\s*-\s*oasis/i,
      description: "Unlock - Oasis button by accessible role",
    },
    {
      strategy: "text",
      value: /unlock\s*-\s*oasis/i,
      description: "Unlock - Oasis text marker",
    },
    {
      strategy: "css",
      selector: "button:has-text('Unlock - Oasis'), a:has-text('Unlock - Oasis'), [role='button']:has-text('Unlock - Oasis'), fin-button:has-text('Unlock - Oasis')",
      description: "Unlock - Oasis actionable control",
    },
  ] satisfies PortalSelectorCandidate[],
  editableFieldSignals: [
    {
      strategy: "css",
      selector: "app-oasis input:not([type='hidden']):not([disabled]):not([readonly]), app-oasis textarea:not([disabled]):not([readonly]), app-oasis select:not([disabled]), app-document-note input:not([type='hidden']):not([disabled]):not([readonly]), app-document-note textarea:not([disabled]):not([readonly]), [formcontrolname]:not([disabled]):not([readonly])",
      description: "Enabled OASIS form fields without disabled/readonly markers",
    },
    {
      strategy: "css",
      selector: "[formarrayname='diagnosis'] [formcontrolname='icdcode']:not([disabled]):not([readonly]), [formarrayname='diagnosis'] [formcontrolname='description']:not([disabled]):not([readonly]), app-m1021-diagnosis [formcontrolname='icdcode']:not([disabled]):not([readonly]), app-m1021-diagnosis [formcontrolname='description']:not([disabled]):not([readonly])",
      description: "Editable diagnosis-specific fields",
    },
    {
      strategy: "css",
      selector: "button:has-text('Insert Diagnosis'):not([disabled]), [role='button']:has-text('Insert Diagnosis'):not([disabled])",
      description: "Insert Diagnosis action visible and enabled",
    },
  ] satisfies PortalSelectorCandidate[],
  readOnlyFieldSignals: [
    {
      strategy: "css",
      selector: "app-oasis input[disabled], app-oasis input[readonly], app-oasis textarea[disabled], app-oasis textarea[readonly], app-document-note input[disabled], app-document-note input[readonly], app-document-note textarea[disabled], app-document-note textarea[readonly]",
      description: "Disabled or readonly OASIS fields",
    },
    {
      strategy: "css",
      selector: "[formarrayname='diagnosis'] [formcontrolname='icdcode'][disabled], [formarrayname='diagnosis'] [formcontrolname='icdcode'][readonly], [formarrayname='diagnosis'] [formcontrolname='description'][disabled], [formarrayname='diagnosis'] [formcontrolname='description'][readonly], app-m1021-diagnosis [formcontrolname='icdcode'][disabled], app-m1021-diagnosis [formcontrolname='icdcode'][readonly], app-m1021-diagnosis [formcontrolname='description'][disabled], app-m1021-diagnosis [formcontrolname='description'][readonly]",
      description: "Readonly diagnosis-specific fields",
    },
  ] satisfies PortalSelectorCandidate[],
} as const;

export type OasisLockStateSelectors = typeof oasisLockStateSelectors;
