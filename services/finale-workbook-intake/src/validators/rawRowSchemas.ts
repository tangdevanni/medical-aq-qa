import { z } from "zod";

const nullableText = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return null;
  }

  const stringValue = String(value).trim();
  return stringValue.length > 0 ? stringValue : null;
}, z.string().nullable());

const baseRawWorkbookRowSchema = z.object({
  sourceSheet: z.string().min(1),
  sourceRowNumber: z.number().int().positive(),
});

export const rawSocPocRowSchema = baseRawWorkbookRowSchema.extend({
  patientName: nullableText,
  episodeDate: nullableText,
  assignedStaff: nullableText,
  payer: nullableText,
  rfa: nullableText,
  trackingDays: nullableText,
  daysInPeriod: nullableText,
  daysLeft: nullableText,
  coding: nullableText,
  oasisQaRemarks: nullableText,
  pocQaRemarks: nullableText,
});

export const rawDcRowSchema = baseRawWorkbookRowSchema.extend({
  patientName: nullableText,
  episodeDate: nullableText,
  assignedStaff: nullableText,
  payer: nullableText,
  rfa: nullableText,
  trackingDays: nullableText,
  daysInPeriod: nullableText,
  daysLeft: nullableText,
  oasisQaRemarks: nullableText,
  dcSummary: nullableText,
});

export const rawVisitNotesRowSchema = baseRawWorkbookRowSchema.extend({
  patientName: nullableText,
  medicareNumber: nullableText,
  payer: nullableText,
  socDate: nullableText,
  episodePeriod: nullableText,
  billingPeriod: nullableText,
  status: nullableText,
  oasisQa: nullableText,
  oasisStatus: nullableText,
  qa: nullableText,
  sn: nullableText,
  ptOtSt: nullableText,
  hhaMsw: nullableText,
  billingStatus: nullableText,
});

export const rawDizRowSchema = baseRawWorkbookRowSchema.extend({
  patientName: nullableText,
  episodeDateOrBillingPeriod: nullableText,
  clinician: nullableText,
  qaSpecialist: nullableText,
  sn: nullableText,
  rehab: nullableText,
  hhaAndMsw: nullableText,
  poAndOrder: nullableText,
  status: nullableText,
});
