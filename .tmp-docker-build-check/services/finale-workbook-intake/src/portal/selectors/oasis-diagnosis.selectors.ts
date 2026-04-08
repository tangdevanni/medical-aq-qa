import type { PortalSelectorCandidate } from "./types";

export const oasisDiagnosisSelectors = {
  rootContainers: [
    {
      strategy: "css",
      selector: "#diagnosis",
      description: "OASIS diagnosis card container by #diagnosis id",
    },
    {
      strategy: "css",
      selector: "#m1021, .form-body.m1021.show-component",
      description: "OASIS diagnosis form body by #m1021 / .form-body.m1021.show-component",
    },
    {
      strategy: "css",
      selector: "app-m1021-diagnosis[formarrayname='diagnosis'], app-m1021-diagnosis",
      description: "OASIS diagnosis component wrapper app-m1021-diagnosis",
    },
  ] satisfies PortalSelectorCandidate[],
  sectionMarkers: [
    {
      strategy: "text",
      value: /Active Diagnoses/i,
      description: "Active Diagnoses section marker",
    },
    {
      strategy: "text",
      value: /PRIMARY DIAGNOSIS|OTHER DIAGNOSIS/i,
      description: "Diagnosis row section labels",
    },
  ] satisfies PortalSelectorCandidate[],
  diagnosisRows: [
    {
      strategy: "css",
      selector: "[formarrayname='diagnosis'] [formgroupname], app-m1021-diagnosis [formgroupname]",
      description: "Diagnosis rows by formgroupname inside formarrayname=diagnosis",
    },
    {
      strategy: "css",
      selector: "app-m1021-diagnosis [formcontrolname='icdcode']",
      description: "Diagnosis rows inferred from icdcode field anchors",
    },
  ] satisfies PortalSelectorCandidate[],
  primaryDiagnosisRows: [
    {
      strategy: "text",
      value: /PRIMARY DIAGNOSIS/i,
      description: "Primary diagnosis row/label marker",
    },
  ] satisfies PortalSelectorCandidate[],
  otherDiagnosisRows: [
    {
      strategy: "text",
      value: /OTHER DIAGNOSIS(?:\s+\d+)?/i,
      description: "Other diagnosis row/label marker",
    },
  ] satisfies PortalSelectorCandidate[],
  editableSlotSignals: [
    {
      strategy: "css",
      selector: "input[formcontrolname='icdcode']:not([disabled]):not([readonly])",
      description: "Editable ICD code field anchors for visible diagnosis slots",
    },
    {
      strategy: "css",
      selector: "textarea[formcontrolname='description']:not([disabled]):not([readonly]), input[formcontrolname='description']:not([disabled]):not([readonly]), input[formcontrolname='diagnosisdescription']:not([disabled]):not([readonly])",
      description: "Editable description field anchors for visible diagnosis slots",
    },
  ] satisfies PortalSelectorCandidate[],
  insertDiagnosisButton: [
    {
      strategy: "css",
      selector: "button:has-text('Insert Diagnosis'), [role='button']:has-text('Insert Diagnosis')",
      description: "Insert Diagnosis action button",
    },
    {
      strategy: "text",
      value: /Insert Diagnosis/i,
      description: "Insert Diagnosis text marker",
    },
  ] satisfies PortalSelectorCandidate[],
  diagnosisRowSelector:
    "[formarrayname='diagnosis'] [formgroupname], app-m1021-diagnosis [formgroupname]",
  diagnosisRowFallbackFieldAnchors:
    "[formarrayname='diagnosis'] [formcontrolname='icdcode'], app-m1021-diagnosis [formcontrolname='icdcode']",
  icdCodeField: [
    "[formcontrolname='icdcode']",
    "input[formcontrolname='icdcode']",
    "input[placeholder*='ICD' i]",
  ] as const,
  onsetDateField: [
    "[formcontrolname='onsetdate']",
    "[formcontrolname='onsetDate']",
    "input[type='date']",
    "input[placeholder*='Onset' i]",
  ] as const,
  descriptionField: [
    "[formcontrolname='description']",
    "[formcontrolname='diagnosisdescription']",
    "textarea[formcontrolname]",
    "textarea",
    "input[placeholder*='Description' i]",
  ] as const,
  severityRadioField: [
    "input[type='radio'][name*='severity' i]",
    "input[type='radio'][formcontrolname*='severity' i]",
    "input[type='radio'][id*='severity' i]",
  ] as const,
  timingRadioField: [
    "input[type='radio'][name*='onset' i]",
    "input[type='radio'][name*='exacer' i]",
    "input[type='radio'][formcontrolname*='timing' i]",
    "input[type='radio'][id*='onset' i]",
    "input[type='radio'][id*='exacer' i]",
  ] as const,
} as const;

export type OasisDiagnosisSelectors = typeof oasisDiagnosisSelectors;
