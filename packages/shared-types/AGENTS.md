\# Shared Types Agent Instructions



\## Scope



These instructions apply to `packages/shared-types`.



This package owns cross-service contracts.



\## Contract Rules



\- Treat exported types as public interfaces.

\- Do not add service-specific implementation details here unless multiple services need the contract.

\- Prefer explicit, versionable types over loose object shapes.

\- Avoid broad `any`, unsafe casts, and duplicated local copies of shared contracts.



\## Change Requirements



When changing a shared type:



\- Update affected producers and consumers in the same patch when practical.

\- Update tests that assert API shapes, dashboard state, artifact manifests, or worker outputs.

\- Preserve backward compatibility when older run artifacts may still be loaded.

\- If backward compatibility is not possible, clearly document the migration or fallback behavior.



\## Exports



\- Export public contracts through the package entrypoint.

\- Do not rely on consumers importing internal source files.

