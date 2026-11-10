# Phase 2: recovery and cleanup

> **Status:** Proposal. Part of [agent tool interface](README.md). Evidence is in [review.md](review.md).

## Scope

Changes that need extra lookups, behaviour fixes or small parameter renames. Each one needs its own tests and, for the lookups, a time budget.

## 1. Not-found suggestions

For `read`, `grep`, `ls` and `find` only:

```text
read: path not found: packages/contracts/src/domains/tool/results.ts
Nearest existing: packages/contracts/src/domains/
Similar: packages/contracts/src/domains/tools/tool-results.ts
```

- Find the nearest existing ancestor with `stat` calls up the path.
- Find similar files with a basename match below that ancestor: at most three, respecting `.gitignore`, with a hard time budget. Test the budget on a large monorepo.
- No suggestions for `edit` or `write`: a write-capable tool shouldn't hint at a guessed path.

## 2. Nearest line for edit misses

When `oldText` is not found, show the closest line by normalised whitespace or longest common prefix, with its line number, capped at about three lines. Show it only above a similarity threshold, otherwise nothing; a wrong hint misleads more than none. Tune the threshold on the 87 real misses in the snapshot.

## 3. find backend parity

The `fd` backend adds a `**/` prefix to patterns; the Node fallback (`fallbackFind`) matches the raw relative path. Write a test that runs the same patterns through both, then make them agree.

## 4. Process log paging base

`async_bash` and `launch` page with a 0-based `offset`; `read` uses 1-based lines. Make process offsets 1-based to match the displayed line numbers and `read`.

## 5. Casing renames

`plan_present.file_path` → `filePath`, `web_search.max_results` → `maxResults`. Stored arguments are only displayed, so there is no migration; the UI argument readers accept both names.

## 6. Cleanups found during review

- Investigate `python_exec` failing with `Unknown system error -N` (25 times). This is a bug, not a wording issue.
- Remove the overflow branches in `process-result.ts` that bash and python_exec no longer reach now that they go through `projectAgentContent`. Confirm they are unreachable first.
