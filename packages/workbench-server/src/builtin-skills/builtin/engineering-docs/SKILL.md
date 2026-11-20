---
name: engineering-docs
description: Use when writing, restructuring, or auditing engineering docs or agent instruction files (AGENTS.md), recording an architecture decision, drafting or retiring a proposal, or checking docs for drift.
---

# Engineering docs

Goal: smallest doc set that lets an agent/engineer learn current engineering decisions fast, judge change cost/risk, and still invent. Code owns details; docs own rules, rationale, risk, vocabulary.

## Model

```
docs/README.md        short index: one bullet per folder + where code-level docs live
docs/architecture/    what IS: README (compact entry), glossary.md, pages: decisions+why, invariants, change risk, debt
docs/proposals/       what MIGHT BE: one file or folder per proposal, status+labels in its header; no README/index; deleted once implemented
AGENTS.md             root file (docs pointer block) + one per component; agent-only, token-lean
```

`docs/` sits at the root of the repo, or of a multi-repo workspace whose components are separate repos (reference/agent-files.md#layouts).

These are defaults. The project's agent instruction files and established docs conventions (layout, wireframe format, tone) take precedence; adapt rather than override.

Ownership: this skill owns `docs/README.md`, `docs/architecture/`, `docs/proposals/` and agent instruction files. Other docs (user guides, API references, changelogs) are out of scope: link them, never delete or restructure them without asking.

Refs: [reference/architecture.md](reference/architecture.md) · [reference/proposals.md](reference/proposals.md) · [reference/agent-files.md](reference/agent-files.md) · checker [scripts/doccheck.mjs](scripts/doccheck.mjs): `node <skill>/scripts/doccheck.mjs links|refs|hygiene [paths]` from the repo or workspace root, where `<skill>` is this file's directory (Node ≥18, no deps; report-only; exit 1 = ERROR, 2 = usage/internal). Pass another docs root if the project uses one. Checker cannot see: agent instruction files, root-relative links, the quality of rules; verify those by reading.

## Pick mode

| Request                                                                    | Mode         |
| -------------------------------------------------------------------------- | ------------ |
| no docs / messy docs / "clean up docs"                                     | CREATE       |
| code changed; "record a decision" that is already built                    | MAINTAIN     |
| new idea, feature, redesign, brainstorm; "record a decision" not yet built | PROPOSE      |
| proposal shipped / "remove proposal"                                       | DECOMMISSION |
| "review/check docs", "check for drift"                                     | AUDIT        |
| "set up / improve AGENTS.md" (no docs work)                                | AGENT FILES  |

## Asking the user

Goal: few, high-value questions. The user may not know the codebase or the engineering trade-offs; use your expertise to guide, explain and recommend.

1. Collect every uncertain item first (debt or intended? decided or open? term meaning? delete history?). Classify: **obvious** (code/evidence settles it), **ambiguous, low impact**, **ambiguous, high impact or unique**.
2. ≤5 uncertain items → ask them directly, one batch.
3. More → first a high-level round (≤4 questions), e.g.: familiarity with the codebase/engineering; product goals and priorities (stability vs speed, release horizon, platforms); how much to delegate ("decide obvious items and report them" vs "review each"); stance on debt (flag strictly vs only serious issues). Give each a one-line context.
4. Then decide obvious and low-impact items yourself within that guidance. Ask only high-impact or unique items, ≤5 per round.
   Always ask, never decide alone: deleting content or history; adding, removing or relaxing a MUST or an agent-file hard rule; changes in High-risk areas; marking debt, unless the user explicitly delegated debt calls in round 1.
5. Every question: concrete options, one marked recommended with a one-line why, so the user can answer without typing.
6. Final report lists every decision you made on the user's behalf (item → decision → why), so the user can veto.
7. Cannot ask (unattended run, no answer): apply the recommended option for obvious/low-impact items, leave always-ask items undone, and list both in the report.
   Never mark existing behaviour as debt silently.

## CREATE

1. Inventory: docs (`find docs -type f`, `wc -l`), root README, agent instruction files (root and per component), package READMEs, CI, manifests, components (separate repos or packages). Grep inbound links to docs from code/config.
2. Distill, in parallel via read-only sub-agents if available: invariants+why, key solutions (paths), gotchas, project terms, open/deferred items, suspected debt, obsolete content, inbound refs, per-component commands and conventions. Code beats docs; report discrepancies.
3. Verify every number, version, name, path, command you will write (grep). Never copy stale claims.
4. Choose pages from the project's risk profile (reference/architecture.md#choosing-pages). No fixed list.
5. Collect glossary candidates (reference/architecture.md#glossary).
6. Resolve uncertainties per **Asking the user**.
7. Write architecture/README.md, then glossary.md, then pages, then proposals: one per significant open item and per debt item, each with the header from reference/proposals.md#header. Fold TODO/backlog files and any proposals index/roadmap into proposals (minor items: a related proposal's Open questions; rejected ideas worth remembering: Rejected proposals). Then docs/README.md.
8. Agent instruction files (reference/agent-files.md): root file with docs block, one per component; optimize existing ones.
9. Delete superseded docs within the owned folders, including `docs/proposals/README.md` (`git rm`, or plain delete outside git); move durable conclusions first. Docs outside them: ask.
10. Fix inbound refs (code comments, agent files, READMEs, build scripts). Run `links` on docs + edited markdown, `refs docs/architecture`, `hygiene`; run project tests that cite doc paths.
11. Report: structure, agent files (lines before → after), removals, discrepancies, decisions made for the user, open questions.

Done when: `links` and `hygiene` exit 0; `refs docs/architecture` WARNs confirmed false or fixed; agent files follow reference/agent-files.md; report delivered.

## MAINTAIN

1. Identify change scope (diff, PR, user statement).
2. Map to affected pages via architecture/README.md map; read only those.
3. Check affected statements against code; update rule/rationale/risk/glossary.md, not narration. Remove what became false. No implementation detail. Change in a High-risk area (e.g. schema, persisted format, security boundary) → also update its change-risk entry and gotchas.
4. New decision with no fitting page → section on closest page; new page only for a new high-risk area.
5. Suspected bad/regressed decision → **Asking the user** (usually one direct question), then debt marker + proposal labelled `debt` (reference/architecture.md#debt).
6. Changed commands, conventions or gotchas → update the owning agent file (root or component).
7. `links` on touched files; `refs` on touched architecture pages.
8. Ensure the root agent file's docs block still exists with correct paths.

Done when: touched files pass `links`; no new `refs` WARN on touched pages; stated rules match code.

## PROPOSE

1. Read architecture/README.md, glossary.md + pages the idea touches (design-system page for UI work); note invariants respected or challenged.
2. Header, file or folder layout: reference/proposals.md#header and #layout. UI wireframes: reference/proposals.md#wireframes.
3. New terms → define in proposal; promote to glossary.md on decommission.
4. May contradict architecture; name the challenged rule and why.

Done when: proposal follows the template with a valid header and `hygiene` exits 0.

## DECOMMISSION

reference/proposals.md#decommission. Start with `refs <proposal path>` to see what the proposal assumed that changed.

Done when: proposal deleted (or shrunk to the unshipped rest); rules live in architecture; debt markers updated; `links` and `hygiene` exit 0.

## AUDIT

Report only, no edits unless asked. Ask no questions during the audit; end by offering fixes.

- `hygiene`: ERROR = debt without proposal or back-link, missing/malformed proposal header, folder proposal without README. WARN = size, MUST density, stale drafts, proposals README present, debt proposal without `debt` label, glossary missing. WARN is informational, never a reason to force changes.
- `refs docs/architecture` (and proposals the user targets): advisory WARN; confirm by grep before reporting. Never require cleaning stale refs in untargeted drafts.
- `links docs`.
- Spot-check each High-risk page: pick 2–3 stated rules and verify them in code.
- Read agent files against reference/agent-files.md: wrong commands/paths, duplication between root and components, discoverable or cosmetic content, references outside a component's repo.

Report: ERRORs; confirmed stale refs; rules contradicted by code; agent-file issues; WARNs worth acting on (one line each); suggested fixes grouped by mode.

## AGENT FILES

Follow reference/agent-files.md: inventory components, create missing files where useful, optimize existing ones, add the docs block to the root file only when `docs/architecture/` exists.

Done when: every command and path in the files is verified; no content duplicated between root and component files; report lists lines before → after per file.

## Style (all docs)

- Rules > prose. One fact in one place; link elsewhere. Use glossary.md terms exactly.
- No test counts, run logs, dates-as-status, "reviewed by", artifact paths, status chatter.
- State evidence limits once, plainly (e.g. "Windows unverified").
- Mermaid only where flow/ownership is hard to say in text.
- Length: reference/architecture.md#size.
- Point to the enforcing test/module rather than restating what code enforces in detail.
