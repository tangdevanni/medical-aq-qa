# Finale OASIS Active Diagnosis DOM Map

## Scope

This map documents the Active Diagnoses page structure used by the read-only diagnosis snapshot and comparison workflow in `services/finale-workbook-intake`.

## Container Hierarchy

- `#diagnosis` (primary card container)
- `#m1021` or `.form-body.m1021.show-component` (diagnosis form body)
- `app-m1021-diagnosis[formarrayname="diagnosis"]` (Angular diagnosis component wrapper)
- Repeated diagnosis rows rendered under `formarrayname="diagnosis"`

## Row Structure

Primary row anchors:

- `[formarrayname="diagnosis"] [formgroupname]`
- `app-m1021-diagnosis [formgroupname]`
- Fallback: ancestors around `[formcontrolname="icdcode"]`

Row grouping signals:

- section labels in row text such as `PRIMARY DIAGNOSIS` and `OTHER DIAGNOSIS`
- field-control clusters with `formcontrolname` values

## Field Map Per Diagnosis Row

- `icd10Code`
  - Preferred selectors: `[formcontrolname="icdcode"]`, `input[formcontrolname="icdcode"]`
  - Field type: text input
- `onsetDate`
  - Preferred selectors: `[formcontrolname="onsetdate"]`, `[formcontrolname="onsetDate"]`, `input[type="date"]`
  - Field type: date input
- `description`
  - Preferred selectors: `[formcontrolname="description"]`, `[formcontrolname="diagnosisdescription"]`, `textarea[formcontrolname]`
  - Field type: textarea or text input
- `severity`
  - Preferred selectors: checked radio input with severity name/id/formcontrol hints
  - Field type: radio
- `timingFlags` (Onset / Exacerbate toggles)
  - Preferred selectors: checked radios and active/selected toggles containing `Onset` or `Exacerbate`
  - Field type: radio/toggle cluster

Secondary page signals:

- `button:has-text("Insert Diagnosis")` for add-row affordance detection
- Active section markers containing `Active Diagnoses`

## Selector Reliability Ranking

1. `formcontrolname` based selectors
2. explicit component hierarchy selectors (`app-m1021-diagnosis`, `formarrayname="diagnosis"`)
3. stable `id` selectors (`#diagnosis`, `#m1021`)
4. role/aria markers for checked state or combobox state
5. nearby visible label text (`PRIMARY DIAGNOSIS`, `OTHER DIAGNOSIS`, `Insert Diagnosis`)
6. positional/ancestor fallback selectors (used only if structured anchors are missing)

## Read-Only Capture Notes

- Hidden or collapsed rows are ignored unless visible.
- Disabled/read-only flags are captured per field in selector evidence metadata.
- Snapshot includes `rawText`, `rawHtmlHints`, and `extractionWarnings` for reviewer auditability.
- Header/UI noise rows are excluded before comparison or write planning.
  - Known noise pattern: rows whose visible text collapses to `PRIMARY DIAGNOSIS ... ICD-10 CodeOnset Date`, `OTHER DIAGNOSIS - n ... ICD-10 CodeOnset Date`, or just `ICD-10 CodeOnset Date`.
  - These rows often expose read-only `icdcode` / `onsetDate` controls without description, severity, or onset/exacerbate controls and must not count as real diagnosis slots.
- Editable blank rows created by `Insert Diagnosis` are retained when the slot exposes actionable controls even if the visible text is mostly labels.
