# Workbook Intake And Delta Scheduler

The autonomous scheduler has two separate intents:

- `weekly_workbook_intake`: acquire a fresh Finale workbook, parse the patient list, promote completed patient artifacts to patient memory, create the new active batch, then run delta-all.
- `weekday_delta_run`: reuse the current active workbook and process only patients that need work.

Default production timing:

- Workbook intake: Sunday at `20:30` in the subsidiary timezone.
- Delta-all: Monday through Friday only.
- Saturday: no autonomous scheduled processing.

Configuration:

- `DEFAULT_SUBSIDIARY_WORKBOOK_INTAKE_DAY=Sunday`
- `DEFAULT_SUBSIDIARY_WORKBOOK_INTAKE_LOCAL_TIME=20:30`
- `DEFAULT_SUBSIDIARY_DELTA_RUN_WEEKDAYS=Monday,Tuesday,Wednesday,Thursday,Friday`

The scheduler stores separate metadata for each intent:

- `nextWorkbookIntakeAt`
- `nextDeltaRunAt`
- `lastWorkbookAcquiredAt`
- `lastDeltaRunAt`

`nextScheduledRunAt` remains as a compatibility pointer to the earliest due scheduled intent.

Delta reuse depends on a work-item fingerprint. The fingerprint includes clinical and operational fields that affect referral/OASIS processing, while ignoring row numbers, run IDs, artifact paths, timestamps, file paths, and formatting-only noise.

Reuse is allowed only when:

- patient identity resolves unambiguously
- previous patient run completed
- required dashboard/QA artifacts exist
- work-item fingerprint matches
- reuse schema version is compatible

If a fingerprint changes, reusable stage artifacts are seeded only for unchanged components. Referral-relevant changes block referral artifact reuse. OASIS-relevant changes block OASIS artifact reuse. Plan-of-care and visit-note artifacts continue to depend on the latest non-DC/non-death SOC, ROC, or RECERT evidence.

Patient Refresh is intentionally separate from this scheduler. It remains an explicit patient-level action, refreshes only the selected OASIS, does not reacquire the agency workbook, and keeps the old dashboard visible until the refresh succeeds.
