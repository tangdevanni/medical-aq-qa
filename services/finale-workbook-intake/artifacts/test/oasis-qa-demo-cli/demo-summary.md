# OASIS QA Demo Summary

- Demo label: simulated-read-only-oasis-demo
- Live portal mode: false
- Workbook: C:\Users\short\OneDrive\Desktop\medical-aq-qa\services\finale-workbook-intake\finale-export.xlsx
- Normalized work items in workbook: 20
- Demo-eligible work items: 20
- Work items selected for demo run: 1
- Selection reason: Selected the highest-ranked demo-eligible patient(s) using identity completeness, workflow signals, and source-sheet coverage. Primary selection reason: patient identity present; episode context present; workflow signals: IN_PROGRESS, REVIEW_REQUIRED, IN_PROGRESS; source sheets: DIZ, VISIT NOTES.
- Parser exceptions from intake: 55
- Patient: David Sessler
- Patient match status: EXACT
- Portal login status: SUCCESS
- Portal login detail: Authenticated to the portal using the read-only reviewer path.
- Chart opened: true
- Chart open detail: Opened the patient chart in read-only mode.
- Overall QA status: BLOCKED
- Urgency: ON_TRACK
- Days in period: n/a
- Days left: n/a
- Step log count: 11
- Read-only safety mode: READ_ONLY
- Dangerous controls detected: Save, Validate, Mark Ready For Billing
- Dangerous write blocked: true

## Documents Found
- OASIS (OASIS Assessment) confidence=0.99
- POC (Plan of Care) confidence=0.97
- VISIT_NOTE (SN Visit Note) confidence=0.98
- ORDER (Physician Order) confidence=0.95
- COMMUNICATION (Communication Note) confidence=0.93
- SUMMARY_30 (30-Day Summary) confidence=0.92
- SUPERVISORY (Supervisory Visit) confidence=0.90
- MISSED_VISIT (Missed Visit) confidence=0.90
- FALL_REPORT (Fall Report) confidence=0.88

## QA Sections
- timing: FAIL (3 blockers)
- coding: MISSING (1 blockers)
- oasis: NEEDS_REVIEW (0 blockers)
- poc: MISSING (1 blockers)
- visit_notes: FAIL (1 blockers)
- technical_review: PASS (0 blockers)
- final_check: FAIL (1 blockers)

## Blockers
- Days in the 30-day period captured
- Days left before OASIS due date verified
- Urgency bucket
- Coding review completed in workbook
- POC QA completed in workbook
- Visit notes review completed in workbook

## Evidence Files
- C:\Users\short\OneDrive\Desktop\medical-aq-qa\services\finale-workbook-intake\artifacts\test\oasis-qa-demo-cli\run\patient-results\DAVID_SESSLER__3d647e083a21c0c4.json
- C:\Users\short\OneDrive\Desktop\medical-aq-qa\services\finale-workbook-intake\artifacts\test\oasis-qa-demo-cli\run\logs\DAVID_SESSLER__3d647e083a21c0c4.json
- C:\Users\short\OneDrive\Desktop\medical-aq-qa\services\finale-workbook-intake\artifacts\test\oasis-qa-demo-cli\run\evidence\DAVID_SESSLER__3d647e083a21c0c4\oasis.txt
- C:\Users\short\OneDrive\Desktop\medical-aq-qa\services\finale-workbook-intake\artifacts\test\oasis-qa-demo-cli\run\evidence\DAVID_SESSLER__3d647e083a21c0c4\plan-of-care.txt
- C:\Users\short\OneDrive\Desktop\medical-aq-qa\services\finale-workbook-intake\artifacts\test\oasis-qa-demo-cli\run\evidence\DAVID_SESSLER__3d647e083a21c0c4\visit-note-sn.txt
- C:\Users\short\OneDrive\Desktop\medical-aq-qa\services\finale-workbook-intake\artifacts\test\oasis-qa-demo-cli\run\evidence\DAVID_SESSLER__3d647e083a21c0c4\physician-order.txt
- C:\Users\short\OneDrive\Desktop\medical-aq-qa\services\finale-workbook-intake\artifacts\test\oasis-qa-demo-cli\run\evidence\DAVID_SESSLER__3d647e083a21c0c4\communication-note.txt
- C:\Users\short\OneDrive\Desktop\medical-aq-qa\services\finale-workbook-intake\artifacts\test\oasis-qa-demo-cli\run\evidence\DAVID_SESSLER__3d647e083a21c0c4\summary-30.txt
- C:\Users\short\OneDrive\Desktop\medical-aq-qa\services\finale-workbook-intake\artifacts\test\oasis-qa-demo-cli\run\evidence\DAVID_SESSLER__3d647e083a21c0c4\supervisory-note.txt
- C:\Users\short\OneDrive\Desktop\medical-aq-qa\services\finale-workbook-intake\artifacts\test\oasis-qa-demo-cli\run\evidence\DAVID_SESSLER__3d647e083a21c0c4\missed-visit.txt
- C:\Users\short\OneDrive\Desktop\medical-aq-qa\services\finale-workbook-intake\artifacts\test\oasis-qa-demo-cli\run\evidence\DAVID_SESSLER__3d647e083a21c0c4\fall-report.txt

## Future Write Points
- Reviewer note write point is documented only and not executed.
- QA status update write point is documented only and not executed.
- Ready-for-billing write point is documented only and not executed.
- Follow-up task write point is documented only and not executed.