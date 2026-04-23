Current control-plane batch data is organized by agency.

- Each top-level folder is an agency slug, for example `aplus-home-health` or `star-home-health`.
- The preserved batch for that agency lives inside the agency folder under its original `batch-*` id.
- `current-agencies.json` is the quick inventory file for the current five-agency set, including batch ids and workbook source paths.

Legacy flat `batches/batch-*` directories were removed so the data directory reads by agency first instead of by opaque batch id.
