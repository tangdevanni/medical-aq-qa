# OASIS QA Demo Summary

- Demo label: live-portal-read-only-oasis-demo
- Live portal mode: true
- Workbook: C:\dev\medical-aq-qa\services\finale-workbook-intake\finale-export.xlsx
- Normalized work items in workbook: 16
- Demo-eligible work items: 16
- Work items selected for demo run: 1
- Selection reason: Selected the highest-ranked demo-eligible patient(s) using identity completeness, workflow signals, and source-sheet coverage. Primary selection reason: patient identity present; episode context present; workflow signals: IN_PROGRESS, IN_PROGRESS; source sheets: OASIS Tracking Report.
- Parser exceptions from intake: 0
- Patient: Christine Young
- Patient match status: EXACT
- Portal login status: SUCCESS
- Portal login detail: Completed portal login flow in AUTH_ONLY mode.
- Chart opened: true
- Chart open detail: Opened the patient page from global search in read-only mode for YOUNG, CHRISTINE MR# 84 Active SOC: 2/27/2026 / DOB: 5/30/1944 LOS: 42 days Medicare 16327 East Montrose Drive Fountain Hills AZ 85268 (480)388-5075 Last Visit Confirmed by PT : 03/16/2026 (25 days ago).
- Overall QA status: IN_PROGRESS
- Urgency: ON_TRACK
- Days in period: 30
- Days left: 17
- Step log count: 53
- Read-only safety mode: READ_ONLY
- Dangerous controls detected: none detected
- Dangerous write blocked: true

## Documents Found
- ORDER (christine young referral.pdf) confidence=0.92

## QA Sections
- timing: PASS (0 blockers)
- coding: MISSING (1 blockers)
- oasis: MISSING (5 blockers)
- poc: MISSING (5 blockers)
- visit_notes: MISSING (11 blockers)
- technical_review: MISSING (3 blockers)
- final_check: FAIL (2 blockers)

## Blockers
- OASIS content is available to support coding review
- OASIS document content extracted
- Medical necessity is stated
- Homebound reason is stated
- Health assessment is documented
- Skilled interventions during the OASIS visit are documented
- Plan of care content extracted
- POC QA completed in workbook
- Diagnoses or codes are present in the plan of care
- Interventions, goals, and frequency are present in the plan of care
- Conditions or exacerbations are reflected in the plan of care
- Visit note content extracted
- Visit notes review completed in workbook
- Skilled need is clearly documented
- Interventions performed are specific and detailed
- Patient response to interventions is documented
- Progress toward goals is noted
- Vitals and focused assessment are documented
- Medication review is documented
- Changes in condition are clearly reported and addressed
- Documentation supports billed services
- Documentation remains consistent with OASIS and diagnoses
- Portal patient match resolved
- SN visits were identified from visit-note content
- Applicable disciplines were detected

## Evidence Files
- C:\dev\medical-aq-qa\services\finale-workbook-intake\artifacts\demo\oasis-qa-demo-2026-04-10T19-46-34-759Z\run\patient-results\CHRISTINE_YOUNG__a89bc267c323fb6a.json
- C:\dev\medical-aq-qa\services\finale-workbook-intake\artifacts\demo\oasis-qa-demo-2026-04-10T19-46-34-759Z\run\logs\CHRISTINE_YOUNG__a89bc267c323fb6a.json

## Future Write Points
- Reviewer note write point is documented only and not executed.
- QA status update write point is documented only and not executed.
- Ready-for-billing write point is documented only and not executed.
- Follow-up task write point is documented only and not executed.