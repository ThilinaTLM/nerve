# Phase 2: fewer round trips

> **Status:** Proposal. Part of [agent tool interface](README.md). Evidence is in [review.md](review.md#shell-first-models).

## Why

86% of turns make one tool call. Claude models batch lookups into bash one-liners instead: of their roughly 14k bash calls that search or read files, a quarter run two or more searches and a fifth read two or more files. GPT models mostly use the dedicated tools one call at a time.

The cheapest step, a system prompt line asking for parallel tool calls, ships with [phase 1](phase-1-low-hanging-fruit.md#8-ask-for-parallel-tool-calls). Each item here starts only when its condition is met: multi-path read depends on what that line does, and the adapter on an OAuth comparison.

## 1. Multi-path read (only if the parallel-call line doesn't work)

If parallel `read` calls become common, they save the same round trips with no schema change. Build this only if, a few days after the parallel-call line ships, Claude's multi-file `cat`/`sed -n` share in bash hasn't moved.

`paths` adds a second either/or pair to `read` (`path` or `paths`, and `paths` versus `offset`/`limit`), which phase 1 is trying to make clearer, so keep it minimal:

- `paths: string[]`, up to about 10 files, as an alternative to `path`. Each file gets a one-line header with its path and line count.
- The files share the normal 50 KiB budget, in order. Files that don't fit are listed with `Next: read {"path":"…"}`.
- No `offset`/`limit`/byte arguments with `paths`; for ranges, use separate calls.
- Each path is a separate permission target, as `grep` `paths` are today.

## 2. Provider-edge argument adapter (only if the rename matters)

On Anthropic OAuth connections, pi-ai renames Nerve's tools to Claude Code's names (`Read`, `Grep`, `Edit`, …) but keeps Nerve's arguments. The snapshot can't separate OAuth from API-key traffic, so this needs a benchmark run with the same Claude model over both. The comparison is confounded: pi-ai's OAuth mode probably also changes the system prompt identity, so a difference doesn't isolate argument shapes. Treat a clear difference as a reason to look closer, not as proof.

Only if OAuth shows a clearly higher bash share or failure rate, add an adapter at the provider edge that accepts Claude Code's argument names for the renamed tools on those connections. Otherwise drop this item.
