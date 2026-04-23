# Finale Workbook Intake

## Purpose

Normalize Finale-exported QA and billing prep workbooks into machine-readable patient episode work items for downstream portal automation.

## CLI usage

```powershell
pnpm --filter @medical-ai-qa/finale-workbook-intake dev .\fixtures\finale-export.xlsx --output-dir .\artifacts\demo
```

## Outputs

- `work-items.json`: normalized `PatientEpisodeWorkItem[]`
- `dashboard-data.json`: queue summary data for the demo UI

## Notes

- The parser skips title rows, blank rows, and repeated section headers.
- Cross-sheet merges are keyed by normalized patient name plus the strongest available episode or billing context.
- Warnings are preserved in `importWarnings` so operators can spot malformed dates, malformed tracking values, or ambiguous episode context before running Playwright automation.
