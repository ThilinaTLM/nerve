# Proposals reference

## Purpose

Track ideas, brainstorms, planned features, debt fixes and redesigns before they change architecture. Drafts are cheap; nothing in them is a commitment. Stale references inside untargeted drafts are tolerated; fix them only when working on that proposal.

Hygiene (`doccheck.mjs hygiene`): ERROR when a proposal is missing from the index, the index points to a missing proposal, or a folder lacks README.md. WARN for a roadmap item without a proposal link, and for a Draft untouched > 180 days (ask the user: revive, reject or keep).

## proposals/README.md (required sections)

1. Purpose (2 lines).
2. Lifecycle: Draft → Accepted (record decision + reason) → Implemented (decommission) | Rejected (delete or one line under Not planned).
3. Layout rules (single file vs folder; wireframes) — copy the rules below, project-neutral.
4. Template.
5. Index table: proposal | area | status.
6. Roadmap: themed checkboxes, each linking its proposal. Replaces TODO/backlog files (merge them here, delete originals, fix links).
7. Not planned: explicit out-of-scope list with one-line reason.

## Template

```markdown
# Title

**Status:** Draft · **Area:** <area> (keep this exact form; hygiene parses it)

## Problem

## Current state (link architecture pages; constraints; debt marker if any)

## Options (numbered, trade-offs)

## Recommendation (optional)

## Open questions
```

Accepted adds `## Decision` (what, why, date-free). Keep it short; a growing file is a signal to move to a folder.

## Layout

- Simple: `proposals/<kebab-feature>.md`.
- Complex (multi-screen UI, several alternatives, deep sub-designs): folder
  ```
  proposals/<feature>/
    README.md      decision record (template); links others; must be understandable without HTML
    <topic>.md     optional deep notes (data model, protocol, migration)
    <screen>.html  optional wireframes
    assets/        optional images
  ```
- Grow single → folder: move to `<feature>/README.md`, update index.

## Wireframes

HTML for UI/UX layouts, states, breakpoints, flows, side-by-side options, unless the project specifies another wireframe format.

- Self-contained: inline CSS/JS, no build, no network (no CDN/remote fonts); opens offline.
- If the project has design tokens, mirror them as CSS variables with the same names/values; call out new tokens in the README.
- Show relevant states: loading, empty, failure, stale, focus, disabled; themes; narrow/wide.
- Section headings with anchors (`file.html#narrow`); alternatives labelled Option A/B.
- Synthetic data only; no credentials/tokenized URLs.
- Never shipped; not evidence of implementation.

## Decommission

Trigger: proposal implemented (or partially; then shrink to the remaining part).

1. Read proposal (all files) + the diff/code that implemented it. `doccheck.mjs refs <proposal>` shows assumed paths/symbols that changed. Verify what actually shipped; unshipped parts stay as a smaller proposal or roadmap item.
2. Extract candidates: new invariants, decisions + rationale, rejected alternatives worth remembering, new change-risk, new gotchas, new glossary terms, new tokens/components/presets.
3. Filter (reference/architecture.md#include-test). Drop: options not taken (unless "do not reintroduce"), discussion, wireframe detail, exact layout numbers code holds.
4. Place: find existing sections via architecture README map. Prefer editing/replacing sentences over appending. One fact, one place; touch every page the change affects (data, runtime, UI, design system…). New page only for a new high-risk area.
5. Remove resolved debt markers (narrow them if only partly fixed); update change-risk tables if risk moved. If several pages state the same new fact, keep it on one and link.
6. Delete proposal file/folder (`git rm -r`, or plain delete outside git), index row, roadmap item. Git history is the archive.
7. Fix inbound links (grep proposal path across repo incl. code comments); run `doccheck.mjs links docs` and `doccheck.mjs refs` on edited architecture pages.
8. If architecture grew noticeably, check for duplicated or code-owned detail. Never cut useful rules to hit a number.

## Classification help (architecture vs proposal)

| Situation                            | Goes to                                             |
| ------------------------------------ | --------------------------------------------------- |
| Implemented and intended             | architecture                                        |
| Implemented, known bad/outgrown      | architecture + debt marker + proposal               |
| Approved, not built                  | proposal (Accepted)                                 |
| Partially built                      | architecture for built part; proposal for rest      |
| Undecided question                   | proposal (Open questions)                           |
| Idea / wish / TODO item              | proposal + roadmap                                  |
| Explicitly rejected                  | Not planned / settled directions                    |
| Historical evidence, logs            | delete (keep conclusion in architecture if durable) |
| Unsure → SKILL.md "Asking the user". |
