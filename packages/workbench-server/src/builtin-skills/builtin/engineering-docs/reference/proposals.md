# Proposals reference

## Purpose

Track ideas, brainstorms, planned features, debt fixes and redesigns before they change architecture. Drafts are cheap; nothing in them is a commitment. Stale references inside untargeted drafts are tolerated; fix them only when working on that proposal.

`docs/proposals/` has no README, index or roadmap file: lists there change constantly and drift. Each proposal's header carries its status and labels; list proposals with `grep -r -m1 '^\*\*Status:' docs/proposals`.

Hygiene (`doccheck.mjs hygiene`): ERROR for a missing or malformed proposal header, or a folder proposal without README.md. WARN for a `docs/proposals/README.md` (fold it into proposals, then delete it), a proposal linked from a debt marker without the `debt` label, and a Draft untouched > 180 days (ask the user: revive, reject or keep).

## Header

Every proposal (a single file, or a folder's README.md) starts with exactly:

```markdown
# <Title>

**Status:** Draft · **Labels:** feature, storage
```

- Status, one of: `Draft` (open idea), `Accepted` (decided, not built), `Rejected` (kept so the idea is not proposed again). Implemented proposals are deleted (see Decommission), so they have no status.
- Labels: comma-separated, lowercase kebab-case. At least one type label: `feature` (new capability), `change` (alter existing behaviour), `bug` (fix wrong behaviour), `debt` (fix a known-debt marker), `refactor` (restructure, same behaviour). Combine types when several apply; add area labels (e.g. `storage`, `ui`) freely.
- Topic files inside a folder have no header.

## Lifecycle

Draft → Accepted (add `## Decision`: what and why, date-free) → implemented (decommission) | Rejected (shrink to Problem + `## Why rejected`).

## Template

```markdown
# <Title>

**Status:** Draft · **Labels:** <type>, <area>

## Problem

## Current state (link architecture pages; constraints; debt marker if any)

## Options (numbered, trade-offs)

## Recommendation (optional)

## Open questions
```

## Layout

- Small: `proposals/<kebab-feature>.md`.
- Large: a folder, never one long file. Use a folder when the proposal passes ~150 lines, covers several topics (multi-screen UI, several alternatives, deep sub-designs) or has wireframes:
  ```
  proposals/<feature>/
    README.md      header + template; links the other files; understandable without HTML
    <topic>.md     optional deep notes (data model, protocol, migration)
    <screen>.html  optional wireframes
    assets/        optional images
  ```
- Single file outgrows this → move it to `<feature>/README.md`, split topics out, fix inbound links.

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

1. Read proposal (all files) + the diff/code that implemented it. `doccheck.mjs refs <proposal>` shows assumed paths/symbols that changed. Verify what actually shipped; unshipped parts stay as a smaller proposal.
2. Extract candidates: new invariants, decisions + rationale, rejected alternatives worth remembering, new change-risk, new gotchas, new glossary terms, new tokens/components/presets.
3. Filter (reference/architecture.md#include-test). Drop: options not taken (unless "do not reintroduce"), discussion, wireframe detail, exact layout numbers code holds.
4. Place: find existing sections via architecture README map. Prefer editing/replacing sentences over appending. One fact, one place; touch every page the change affects (data, runtime, UI, design system…). New page only for a new high-risk area.
5. Remove resolved debt markers (narrow them if only partly fixed); update change-risk tables if risk moved. If several pages state the same new fact, keep it on one and link.
6. Delete the proposal file or folder (`git rm -r`, or plain delete outside git). Git history is the archive.
7. Fix inbound links (grep proposal path across repo incl. code comments); run `doccheck.mjs links docs` and `doccheck.mjs refs` on edited architecture pages.
8. If architecture grew noticeably, check for duplicated or code-owned detail. Never cut useful rules to hit a number.

## Classification help (architecture vs proposal)

| Situation                            | Goes to                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| Implemented and intended             | architecture                                                       |
| Implemented, known bad/outgrown      | architecture + debt marker + proposal (`debt`)                     |
| Approved, not built                  | proposal (Accepted)                                                |
| Partially built                      | architecture for built part; proposal for rest                     |
| Undecided question                   | proposal (Open questions)                                          |
| Idea / wish / TODO item              | proposal (Draft); minor item → a related proposal's Open questions |
| Explicitly rejected                  | proposal (Rejected) if worth remembering; else drop                |
| Historical evidence, logs            | delete (keep conclusion in architecture if durable)                |
| Unsure → SKILL.md "Asking the user". |
