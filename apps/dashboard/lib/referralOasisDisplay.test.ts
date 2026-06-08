import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanDiagnosisDescription,
  cleanOasisDisplayLabel,
  formatClinicalSourceDate,
} from "./referralOasisDisplay";

test("formats OASIS source timestamps as dates", () => {
  assert.equal(formatClinicalSourceDate("2026-06-04T11:19:35.092Z"), "2026-06-04");
  assert.equal(formatClinicalSourceDate("05/19/2026"), "05/19/2026");
  assert.equal(formatClinicalSourceDate(null), null);
});

test("cleans diagnosis labels without treating generic roles as descriptions", () => {
  assert.equal(cleanOasisDisplayLabel("ICD-10 Code"), "Diagnosis Code");
  assert.equal(cleanOasisDisplayLabel("Z47.89 - PRIMARY DIAGNOSIS 🩺 ICD-10 Code"), "Z47.89");
  assert.equal(cleanOasisDisplayLabel("M75.121 - OTHER DIAGNOSIS - 1 ICD-10 Code"), "M75.121");
  assert.equal(cleanDiagnosisDescription("PRIMARY DIAGNOSIS 🩺 ICD-10 Code", "Z47.89"), null);
  assert.equal(
    cleanDiagnosisDescription("Z47.89 - Orthopedic aftercare located on the right shoulder.", "Z47.89"),
    "Orthopedic aftercare located on the right shoulder.",
  );
});

test("cleans medication and allergy OASIS labels", () => {
  assert.equal(cleanOasisDisplayLabel("Allergies (POC Element):"), "Allergies");
  assert.equal(cleanOasisDisplayLabel("Medication (POC Element (§484.60 (2.x))): - NKE"), "Medication - NKE");
});

test("cleans safety and social support OASIS labels", () => {
  assert.equal(cleanOasisDisplayLabel("Emergency Preparedness (POC Element):"), "Emergency Preparedness");
  assert.equal(cleanOasisDisplayLabel("Caregiver Availability (POC Element (§484.60 (2.x))):"), "Caregiver Availability");
});

test("cleans functional and therapy OASIS labels", () => {
  assert.equal(cleanOasisDisplayLabel("Ambulation (POC Element (§484.60 (2.x))): - Device"), "Ambulation - Device");
  assert.equal(cleanOasisDisplayLabel("Therapy Need (POC Element):"), "Therapy Need");
});

test("cleans body systems OASIS labels", () => {
  assert.equal(cleanOasisDisplayLabel("Pain (POC Element):"), "Pain");
  assert.equal(cleanOasisDisplayLabel("Respiratory Status (POC Element (§484.60 (2.x))):"), "Respiratory Status");
});

test("cleans dates and admin OASIS labels", () => {
  assert.equal(cleanOasisDisplayLabel("Start of Care Date (POC Element):"), "Start of Care Date");
  assert.equal(cleanOasisDisplayLabel("Cert Period From (POC Element (§484.60 (2.x))):"), "Cert Period From");
});
