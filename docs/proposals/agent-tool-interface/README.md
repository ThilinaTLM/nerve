# Agent tool interface

> **Status:** Phase 1 implemented. Phases 2 and 3 are proposals, each waiting on its condition.

## Goal

Make Nerve's agent tools easier for models to call correctly the first time, and cheaper in tokens. A change belongs here only if it removes a retry, a wasted call, or repeated tokens. Changes that only make the code look tidier are out of scope.

## Documents

| Document                                                     | Contents                                                                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| [review.md](review.md)                                       | Usage data, per-tool findings, the shell-first analysis, rejected ideas, and the code that reads result text          |
| [phase-1-low-hanging-fruit.md](phase-1-low-hanging-fruit.md) | Descriptions, defaults, result wording, error text, not-found listings, denial reasons, parallel-call line, bug fixes |
| [phase-2-round-trips.md](phase-2-round-trips.md)             | Multi-path `read` and a provider-edge argument adapter, each only if the data calls for it                            |
| [phase-3-code-mode.md](phase-3-code-mode.md)                 | A script tool for Jira, Confluence and web tasks that join or filter across calls                                     |

## Evidence in brief

From 127,807 tool calls in a production Nerve home (2026-09-14 → 2026-11-10); details in [review.md](review.md):

- read, bash and grep make up 80% of calls. read alone produces 176M of the 258M chars returned to models.
- Failures are only about 2% of calls. "Path not found" is the largest class (more than 600); edit fails mostly on `oldText` not found (87) or matched several times (76). All 630 permission denials came from the read-only rule set's catch-all rule.
- 86% of turns make exactly one tool call, and nothing in the prompt asks for parallel calls. Claude models batch lookups into bash one-liners instead (about 9.8k bash file searches against 1.1k grep calls); GPT models mostly use the dedicated tools one at a time.

So the failure fixes in phase 1 are cheap polish, and the larger lever is round trips.

## Phases

| Phase | Theme             | Changes                                                                                                                                                            |
| ----- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Low-hanging fruit | Schema descriptions and defaults, paging hints, edit/write messages, one-line errors, not-found listings, denial reasons, parallel-call line, exit line, bug fixes |
| 2     | Round trips       | `read.paths[]` only if the parallel-call line doesn't change Claude's multi-file bash reads; provider-edge adapter only if the OAuth comparison shows it matters   |
| 3     | Integrations      | Code mode, only if benchmark tasks that join or filter across calls show a need the existing batch reads can't meet                                                |

Phase 1 items are independent of each other and can ship together or one at a time, without waiting for the benchmark; their effects show in production data. Phase 2 and 3 items each start only when their condition is met.

## Decisions

- **Paging hints are structured** (`Next: {"offset":95}`) and appear only when the tool cut the output. grep, find and ls get narrowing summaries instead, because the projection caps them below their limits.
- **Caps are stated in words and enforced by clamping,** not with schema `maximum`, which would turn clamps into failed calls.
- **Claude's bash use is not fought with stronger wording.** Parallel calls are requested; multi-file reads are added only if that isn't enough.
- **Denials state their reason.** The agent currently sees "No further diagnostic was supplied." No per-command translation into tool calls.
- **Code mode is scoped to cross-call integration tasks,** not to replacing bash for local search or to batch reads the integration tools already support.
- Rejected ideas and their reasons are in [review.md](review.md#considered-and-dropped).

## Validation

Phase 1 is measured on production data only. The benchmark is needed for the OAuth comparison in phase 2 and for phase 3.

**Production snapshot.** A before/after comparison of a read-only copy of the database. Model mix shifts over time and some failure classes are rare, so:

- normalise every metric per model and per 1,000 calls;
- measure recovery cost: calls between a failure and the next success on the same target;
- track the multi-call share of tool-calling messages, paging chains, and the bash file search/read share by model (excluding grep that only filters another command's output).

The analysis only needs `conversation_event` rows of type `tool_call_response` and `assistant_message`. Keep the script out of the repo unless it becomes a recurring check, in which case it goes under `scripts/`.

**Fixed-task benchmark.** A small set of tasks, each with a written success check (an expected answer, a passing test, or a file diff):

- exploration tasks ("which tools call `classifyRisk`, and what do they return");
- edit tasks with known pitfalls (repeated lines, already-applied edits);
- tasks with wrong starting paths;
- integration tasks that join or filter across calls, plus one that a single batch read can answer, as a control.

Run every task five times per model and condition, with pinned model versions. Report the success rate and the median and spread of turns and total tokens. Agent runs are noisy; a difference smaller than the spread is not an effect.
