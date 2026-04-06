# Finale Health Portal Map

## Login

- Entry URL: `https://example-portal.test/login`
- Username selector: `[name="username"]`
- Password selector: `[name="password"]`
- Submit selector: `button[type="submit"]`

## Landing

- Primary heading selector: `h1`
- Post-login validation: assert the heading is visible and capture its text.

## QA Monitoring

- Queue route pattern: `/document-tracking?page=forQA`
- Queue detection markers: visible `QA Monitoring` text, queue rows, or a `View / Edit Note` action
- Preferred row target: tooltip or labeled `View / Edit Note`; direct visit-note document links are the fallback
- Visit-note confirmation: require `/documents/note/visitnote/` after opening the row target
- Safety note: Phase 11 remains read-only and must only navigate, classify, open, extract, evaluate, summarize, and return to the queue
