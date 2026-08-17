# Repository documentation

Root `docs/` contains maintainer and development workflow material that is not part of the public product documentation:

- `performance-profiling.md` documents automatic source-desktop performance diagnostics and the local summary tool.
- `release.md` is the maintainer release procedure.

Public user, developer, architecture, protocol, lifecycle, reliability, and operational documentation lives in [`packages/website/src/content/docs/`](../packages/website/src/content/docs/) and is deployed at [nerve.tlmtech.dev](https://nerve.tlmtech.dev). Website-specific editorial planning and architecture diagram sources also live under `packages/website/`.

Product behavior is ultimately defined by the owning contracts, catalogs, implementation, and focused tests. Public prose explains that behavior without becoming a second schema or catalog.
