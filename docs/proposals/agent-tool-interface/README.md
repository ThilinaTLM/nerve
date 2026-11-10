# Agent tool interface

> **Status:** Proposal, in phases. Nothing implemented yet.

## Goal

Make Nerve's agent tools easier for models to call correctly the first time, and cheaper in tokens. A change belongs here only if it removes a retry, a wasted call, or repeated tokens. Changes that only make the code look tidier are out of scope.

## Documents

| Document                                                     | Contents                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| [review.md](review.md)                                       | Usage data, per-tool findings, the shell-first analysis, rejected ideas, and the code that reads result text |
| [phase-1-low-hanging-fruit.md](phase-1-low-hanging-fruit.md) | Descriptions, defaults, result wording and error text. No new parameters or tools                            |
| [phase-2-recovery.md](phase-2-recovery.md)                   | Recovery hints that need lookups, backend fixes and small renames                                            |
| [phase-3-code-mode.md](phase-3-code-mode.md)                 | A script tool that composes existing read-only tools in one call                                             |

## Evidence in brief

From 127,807 tool calls in a production Nerve home (2026-09-14 → 2026-11-10); details in [review.md](review.md):

- read, bash and grep make up 80% of calls. read alone produces 176M of the 258M chars returned to models.
- "Path not found" is the most common failure for read, grep, ls and find (more than 600). Edit fails mostly on `oldText` not found (87) or matched several times (76).
- Continuation hints use at least eight different wordings, and some truncated results end without a usable next call.
- 86% of turns make exactly one tool call. Claude models batch lookups into bash one-liners instead; GPT models mostly use the dedicated tools one at a time.

## Phases

| Phase | Theme                | Changes                                                                                                                       | Gate to next phase                                        |
| ----- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1     | Low-hanging fruit    | Schema descriptions and defaults, `Next: {…}` hints, read trailer, edit/write messages, error and exit lines                  | Two weeks of data; failure and paging metrics re-measured |
| 2     | Recovery and cleanup | Not-found suggestions, nearest-line hints for edit, find backend parity, process paging base, casing renames, python_exec bug | Metrics re-measured                                       |
| 3     | Composition          | Code mode: inline TypeScript that calls read-only tools and returns only what it prints                                       | Fixed-task benchmark shows fewer turns or tokens          |

Phase 1 and phase 2 are independent of each other in code; the order is by cost and risk. Phase 3 can be designed in parallel, but its runtime isolation must be settled before it ships.

## Decisions

- **Continuation hints are structured:** `Next: {"offset":95}`. The JSON holds only the arguments that change. Hints that point to a different tool give that tool's full arguments.
- **Batching is handled by code mode,** not by adding multi-path `read` or multi-pattern grep to the tool schemas.
- **Claude's bash use is not something to fight** with stronger wording; it is measured instead.
- The rejected ideas and their reasons are listed in [review.md](review.md#considered-and-dropped).

## Validation

Re-run the snapshot analysis about two weeks after each phase ships, against a read-only copy of the database:

- Per-tool failure rate. Target: not-found retries on read, grep, ls and find down by half after phase 2.
- Edit failures followed by an extra `read` of the same path before the retry.
- Paging chains (same path, immediately re-read with `offset`).
- Bash file search/read share by model, excluding grep used only to filter another command's output, and the share of those calls that batch several lookups.
- Median `agentProjection` length for failed calls.
- After phase 3: turns and tokens per task on a fixed task set, with and without code mode.

The analysis only needs `conversation_event` rows of type `tool_call_response` and `assistant_message` (for the model). Keep the script out of the repo unless it becomes a recurring check, in which case it goes under `scripts/`.
