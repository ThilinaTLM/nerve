# Repository documentation

This directory contains engineering sources and editorial planning for Nerve.

- `architecture/` contains editable architecture diagrams and implementation/reliability notes.
- `release.md` is the maintainer release procedure.
- `performance-profiling.md` documents automatic source-desktop performance diagnostics and the local summary tool.
- `website/content-strategy.md` records the evidence, scope, and review plan for the public website.

Public user guides and public developer reference live in `packages/website/src/content/docs/` so the deployed site has one searchable source of truth. Product behavior is ultimately defined by the owning contracts, catalogs, implementation, and focused tests; prose should link concepts together without becoming a second schema catalog.
