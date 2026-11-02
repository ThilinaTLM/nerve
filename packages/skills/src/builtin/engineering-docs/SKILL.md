---
name: engineering-docs
description: Use when writing, restructuring, or auditing engineering docs, recording an architecture decision, drafting or retiring a proposal, or checking docs for drift.
---

# Engineering docs

Goal: smallest doc set that lets an agent/engineer learn current engineering decisions fast, judge change cost/risk, and still invent. Code owns details; docs own rules, rationale, risk, vocabulary.

## Model

```
docs/README.md        short index: one bullet per folder + where code-level docs live
docs/architecture/    what IS: README (compact entry), glossary.md, pages: decisions+why, invariants, change risk, debt
docs/proposals/       what MIGHT BE: drafts, roadmap, wireframes; deleted once implemented
agent guidance file   short pointer block → architecture (see Agent guidance)
```

These are defaults. The project's agent guidance file and established docs conventions (layout, wireframe format, tone) take precedence; adapt rather than override.

Ownership: this skill owns `docs/README.md`, `docs/architecture/`, `docs/proposals/`. Other docs (user guides, API references, changelogs) are out of scope: link them, never delete or restructure them without asking.

Refs: [reference/architecture.md](reference/architecture.md) · [reference/proposals.md](reference/proposals.md) · checker [scripts/doccheck.mjs](scripts/doccheck.mjs): `node <skill>/scripts/doccheck.mjs links|refs|hygiene [paths]` from repo root, where `<skill>` is this file's directory (Node ≥18, no deps; report-only; exit 1 = ERROR, 2 = usage/internal). Pass another docs root if the project uses one. Checker cannot see: the agent guidance block, root-relative links, the quality of rules; verify those by reading.

## Pick mode

| Request                                                                    | Mode         |
| -------------------------------------------------------------------------- | ------------ |
| no docs / messy docs / "clean up docs"                                     | CREATE       |
| code changed; "record a decision" that is already built                    | MAINTAIN     |
| new idea, feature, redesign, brainstorm; "record a decision" not yet built | PROPOSE      |
| proposal shipped / "remove proposal"                                       | DECOMMISSION |
| "review/check docs", "check for drift"                                     | AUDIT        |

## Asking the user

Goal: few, high-value questions. The user may not know the codebase or the engineering trade-offs; use your expertise to guide, explain and recommend.

1. Collect every uncertain item first (debt or intended? decided or open? term meaning? delete history?). Classify: **obvious** (code/evidence settles it), **ambiguous, low impact**, **ambiguous, high impact or unique**.
2. ≤5 uncertain items → ask them directly, one batch.
3. More → first a high-level round (≤4 questions), e.g.: familiarity with the codebase/engineering; product goals and priorities (stability vs speed, release horizon, platforms); how much to delegate ("decide obvious items and report them" vs "review each"); stance on debt (flag strictly vs only serious issues). Give each a one-line context.
4. Then decide obvious and low-impact items yourself within that guidance. Ask only high-impact or unique items, ≤5 per round.
   Always ask, never decide alone: deleting content or history; adding, removing or relaxing a MUST; changes in High-risk areas; marking debt, unless the user explicitly delegated debt calls in round 1.
5. Every question: concrete options, one marked recommended with a one-line why, so the user can answer without typing.
6. Final report lists every decision you made on the user's behalf (item → decision → why), so the user can veto.
7. Cannot ask (unattended run, no answer): apply the recommended option for obvious/low-impact items, leave always-ask items undone, and list both in the report.
   Never mark existing behaviour as debt silently.

## CREATE

1. Inventory: docs (`find docs -type f`, `wc -l`), root README, agent guidance files, package READMEs, CI, manifests. Grep inbound links to docs from code/config.
2. Distill, in parallel via read-only sub-agents if available: invariants+why, key solutions (paths), gotchas, project terms, open/deferred items, suspected debt, obsolete content, inbound refs. Code beats docs; report discrepancies.
3. Verify every number, version, name, path you will write (grep). Never copy stale claims.
4. Choose pages from the project's risk profile (reference/architecture.md#choosing-pages). No fixed list.
5. Collect glossary candidates (reference/architecture.md#glossary).
6. Resolve uncertainties per **Asking the user**.
7. Write architecture/README.md, then glossary.md, then pages, then proposals/README.md (merge TODO/backlog files into its roadmap; add Not planned), one proposal per significant open item and per debt item (minor items: roadmap line or an existing proposal's open questions), then docs/README.md.
8. Agent guidance block (below).
9. Delete superseded docs within the owned folders (`git rm`, or plain delete outside git); move durable conclusions first. Docs outside them: ask.
10. Fix inbound refs (code comments, agent guidance, READMEs, build scripts). Run `links` on docs + edited markdown, `refs docs/architecture`, `hygiene`; run project tests that cite doc paths.
11. Report: structure, removals, discrepancies, decisions made for the user, open questions.

Done when: `links` and `hygiene` exit 0; `refs docs/architecture` WARNs confirmed false or fixed; guidance block present; report delivered.

## MAINTAIN

1. Identify change scope (diff, PR, user statement).
2. Map to affected pages via architecture/README.md map; read only those.
3. Check affected statements against code; update rule/rationale/risk/glossary.md, not narration. Remove what became false. No implementation detail. Change in a High-risk area (e.g. schema, persisted format, security boundary) → also update its change-risk entry and gotchas.
4. New decision with no fitting page → section on closest page; new page only for a new high-risk area.
5. Suspected bad/regressed decision → **Asking the user** (usually one direct question), then debt marker + proposal (reference/architecture.md#debt).
6. `links` on touched files; `refs` on touched architecture pages.
7. Ensure the agent guidance block still exists with correct paths.

Done when: touched files pass `links`; no new `refs` WARN on touched pages; stated rules match code.

## PROPOSE

1. Read architecture/README.md, glossary.md + pages the idea touches (design-system page for UI work); note invariants respected or challenged.
2. File or folder layout: reference/proposals.md#layout. UI wireframes: reference/proposals.md#wireframes.
3. Index row + roadmap item if planned. New terms → define in proposal; promote to glossary.md on decommission.
4. May contradict architecture; name the challenged rule and why.

Done when: proposal follows the template, is in the index (and roadmap if planned), and `hygiene` exits 0.

## DECOMMISSION

reference/proposals.md#decommission. Start with `refs <proposal path>` to see what the proposal assumed that changed.

Done when: proposal deleted (or shrunk to the unshipped rest); rules live in architecture; index, roadmap and debt markers updated; `links` and `hygiene` exit 0.

## AUDIT

Report only, no edits unless asked. Ask no questions during the audit; end by offering fixes.

- `hygiene`: ERROR = debt without proposal or back-link, index drift, folder without README. WARN = size, MUST density, stale drafts, roadmap item without proposal, glossary missing. WARN is informational, never a reason to force changes.
- `refs docs/architecture` (and proposals the user targets): advisory WARN; confirm by grep before reporting. Never require cleaning stale refs in untargeted drafts.
- `links docs`.
- Spot-check each High-risk page: pick 2–3 stated rules and verify them in code.

Report: ERRORs; confirmed stale refs; rules contradicted by code; WARNs worth acting on (one line each); suggested fixes grouped by mode (MAINTAIN, PROPOSE, DECOMMISSION).

## Agent guidance

Use the project's existing agent instruction file (AGENTS.md, CLAUDE.md, .cursorrules…). None exists → ask before creating AGENTS.md. Add a block of at most 6 lines, adapted to its tone:

```markdown
- Read `docs/architecture/README.md` (principles, change risk) and `docs/architecture/glossary.md` before design changes, then the page for the area you touch.
- Take extra care with High-risk areas: <project's top 1–3, e.g. persisted data and migrations>.
- New ideas and unbuilt work go in `docs/proposals/`. After implementing a proposal, decommission it into architecture.
- Update affected architecture pages in the same change when behaviour or rules change.
```

Don't duplicate architecture content there; keep the file's existing hard rules and retarget their doc links.

## Style (all docs)

- Rules > prose. One fact in one place; link elsewhere. Use glossary.md terms exactly.
- No test counts, run logs, dates-as-status, "reviewed by", artifact paths, status chatter.
- State evidence limits once, plainly (e.g. "Windows unverified").
- Mermaid only where flow/ownership is hard to say in text.
- Length: reference/architecture.md#size.
- Point to the enforcing test/module rather than restating what code enforces in detail.
