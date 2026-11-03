# Tool output projection budgets

> **Status:** Changes 1–8 and the stored-output follow-up are implemented on `feat/tool-output-projection`. Change 9 (clearing old tool output) remains a proposal. Measurements below describe behavior before the changes.

## Summary

Large tool results are projected into a bounded agent preview, with the full output retained in files the agent can `read` or `grep`. This reduces context growth, but over-aggressive projection costs more than it saves: the agent spends an extra turn recovering output it needed.

Analysis of production conversations shows `bash` and `python_exec` previews are too small, and `read` pages are too short. Projection of search, listing and web tools works as intended. Other coding-agent harnesses (Claude Code, Codex, opencode, pi, Gemini CLI) show 30–50 KB of shell output in full, against Nerve's 84 lines / 12 KB, and page file reads at about 50 KB, against Nerve's 200 lines / 24 KB. This proposal retunes these budgets:

1. Size, not line count, decides whether process output is inline.
2. Reduced process output gets a tail-biased head/tail preview that uses its budget.
3. Keyword-based diagnostic selection is removed.
4. The `bash` tool description steers file reads to `read`.
5. `python_exec` gets a larger budget.
6. `read` pages by size: 50 KB, without the 200-line limit.
7. The subagent report inline limit rises from 16 KB to 50 KB.
8. Projection decisions are persisted so recovery can be measured directly.
9. Follow-up: clearing old tool output, which would make larger inline budgets affordable.

No database tables or columns are proposed.

## Current behavior

Process results use the `process_diagnostics` profile (`packages/tools/src/result-projection/profiles.ts`):

| Budget   | Lines | Bytes  |
| -------- | ----- | ------ |
| Inline   | 84    | 12,000 |
| Overflow | 16    | 4,000  |

When output exceeds either inline limit, `projectProcessOutput` (`process-output.ts`) builds the preview from the first 2 lines, up to 4 diagnostic lines, and the last 2 lines, then lists the output files. Diagnostic lines are chosen by `candidates/process.ts` with a keyword regex (`error`, `warn`, `fail`, …) over all of stdout and stderr, regardless of exit code.

Consequences:

- **Cliff at 85 lines.** An 84-line result is shown in full; an 85-line result shows about 8 lines. Most reduced outputs are small: 74% are ≤12 KB and were reduced only by the line limit.
- **Unused budget.** The median reduced preview is 818 bytes of a 4,000-byte overflow budget.
- **Misleading diagnostics.** Keywords match ordinary content. A `cat` of TypeScript source selects lines such as `error?: string;` as diagnostics.
- **Wrong end for tests.** Test and build summaries sit at the tail, but most of the preview is spent on keyword matches.

## Evidence

Source: production home, read-only snapshot, 2026-10-15 (current process projection) to 2026-11-03. Covers 1,043 conversations, 78,384 tool results and $2,013 of recorded model spend.

### Recovery rate by tool

A reduced result counts as recovered when, within the next few tool calls, the agent reads or greps the output file, re-runs the same command, or (after a file dump) reads the same file directly.

| Tool                            | Results | Reduced               | Recovered    |
| ------------------------------- | ------- | --------------------- | ------------ |
| `bash`                          | 23,445  | 3,041 (13%)           | ~62%         |
| `python_exec`                   | 2,050   | 72                    | 68%          |
| `read` (200-line page)          | 29,561  | 3,830 with more pages | 41% continue |
| `grep`, `find`, `ls`, web tools | —       | 5–66%                 | under 1%     |

The 3,103 reduced process results break down as:

- Recovered through the output file: 1,037
- Recovered by reading the same file directly: 846
- Recovered by re-running the command: 56
- Not recovered: 1,164

At least 1,178 assistant turns contained nothing but a recovery call.

### Recovery rate by command

| Command category                      | Reduced | Recovered (file/rerun only) |
| ------------------------------------- | ------- | --------------------------- |
| `cat` / `sed -n` / `head` (file dump) | 1,005   | 38%, plus same-file `read`s |
| `git diff` / `git show`               | 610     | 37%                         |
| `rg` / `grep`                         | 381     | 19%                         |
| `git log` / `git status`              | 248     | 16%                         |
| test runs                             | 86      | 56%                         |
| `python_exec`                         | 72      | 68%                         |
| `gh`                                  | 32      | 59%                         |

Search and log-style output is projected well. File dumps, diffs, test runs and scripts are not.

### Cost model

The model compares two costs:

- **Added context.** Content that becomes inline is charged one cache write, then a cache read on every remaining turn before compaction (median 54 turns).
- **Avoided recovery.** The recorded cost of recovery-only assistant turns, plus the recovered content's own context cost.

Prices are medians from recorded usage: $5/M cache write, $0.10/M cache read.

| Inline budget     | Newly inline | Added context | Recovery turns avoided | Net   |
| ----------------- | ------------ | ------------- | ---------------------- | ----- |
| 8 KB / 300 lines  | 1,715        | +$24          | 831                    | +$8   |
| 12 KB / 200 lines | 1,873        | +$29          | 903                    | +$5.5 |
| 12 KB / 400 lines | 2,230        | +$38          | 1,092                  | +$3   |
| 16 KB / 400 lines | 2,468        | +$47          | 1,224                  | ±$0   |
| 24 KB / 600 lines | 2,739        | +$61          | 1,379                  | −$8   |

Raising the budget helps up to about 12 KB, then stops paying. The model does not price two other effects:

- The latency of roughly 1,000 extra turns.
- Decisions made from an 8-line preview without recovering the output.

Both favor the change. Beyond about 12 KB, improving preview content matters more than raising the limit.

The model assumes inline content stays in context until compaction. That assumption drives the cost of larger budgets, and other harnesses remove it by clearing old tool output (see [Prior art](#prior-art)).

## Prior art

Sources: opencode (2026-11-02), Codex CLI (2026-11-03), pi coding-agent (2026-11-03), Gemini CLI (2026-11-02), and Claude Code v2.1.317. Claude Code findings come from strings in its bundled JavaScript and from its public changelog.

### Shell output

| Harness     | Shown in full up to                                     | Over the limit                                        | Full output          |
| ----------- | ------------------------------------------------------- | ----------------------------------------------------- | -------------------- |
| Nerve       | 84 lines / 12 KB                                        | ~8 lines: 2 head, ≤4 keyword matches, 2 tail          | File, path in notice |
| Claude Code | 30,000 chars (setting `bashOutputMaxChars`, 4K–128K)    | 2,000-char preview, head + tail                       | File, path in notice |
| Codex       | 10,000 tokens (`truncation_policy`, all current models) | Head + tail, half each, `…N tokens truncated…` marker | None; excerpt only   |
| opencode    | 2,000 lines / 50 KiB (configurable)                     | Tail up to the same limits                            | File, kept 7 days    |
| pi          | 2,000 lines / 50 KB                                     | Tail up to the same limits                            | Temp file            |
| Gemini CLI  | 40,000 chars, lowered as the context fills              | 20% head, 80% tail within the limit                   | File, path in notice |

Patterns:

- **Size decides what's shown in full.** Line limits are 2,000 or absent. Full-output limits are 30–50 KB, three to four times Nerve's 12 KB, and 24 times Nerve's 84 lines.
- **No harness selects keyword diagnostics.** Previews are contiguous head and/or tail text.
- **Most previews favor the tail.** opencode and pi keep only the tail, and Gemini keeps 80% tail; Codex and Claude Code split evenly. The pi source says this keeps errors and final results visible.
- **Previews are mostly large.** Claude Code is the exception: its 2,000-char preview is close to Nerve's, but it applies only above 30,000 chars, so most outputs never reach it.
- **Notices are precise.** Examples: `[showing lines X-Y of T; full output saved to <file>]` (opencode), `[Showing lines X-Y of N. Full output: <path>]` (pi), `Output too large (<size>). Full output saved to: <path>` followed by `Preview (start and end):` (Claude Code).

### Steering away from shell file reads

- **Claude Code:** the Bash tool prompt says not to use the tool for `cat`, `head`, `tail`, `grep`, `rg` or `sed`, and lists `Read files: Use … (NOT cat/head/tail)`.
- **pi:** the `read` tool guideline says "Use read to examine files instead of cat or sed."
- **opencode:** the bash description says "Prefer dedicated tools over shell commands when possible" and "Rely on automatic truncation unless filtering the output is more useful."

### File reads

- **opencode and pi:** 2,000 lines / 50 KB pages, keeping the head, with an `offset` continuation notice.
- **Claude Code:** reads are capped by a token budget (`CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`), with a "PARTIAL view" notice. Its changelog records keeping long page reads inline after user complaints.
- **Gemini CLI:** 2,000 lines, with each line capped at 2,000 characters.
- **Claude Code:** 2,000 lines by default (`reads up to 2000 lines`), plus the token budget above. Its default could not be extracted from the binary; the public documentation has described it as 25,000 tokens.
- **Nerve:** 200 lines or 24 KB, whichever comes first. The line limit is the smallest of the group, and it decides for most source files.

In practice the others are limited by size: about 50 KB, or about 100 KB for Claude Code. Their 2,000-line limit only applies to files with very short lines.

### Old tool output

- **Claude Code:** replaces old results with `[Old tool result content cleared]` (microcompact).
- **Gemini CLI:** masks older tool outputs once more than 30,000 tool tokens can be pruned, always protecting the newest 50,000 tool tokens. Separately, an LLM pass can distill large outputs.
- **opencode:** shortens older tool output first when a request would exceed the context window.
- **Codex:** truncates each output once when it's recorded, with no later pass.

Other harnesses can afford 30–50 KB inline because old output does not stay in context forever. Nerve has no such mechanism, which is why the cost model penalizes budgets above about 12 KB.

### Lessons

1. Size-based limits with large line ceilings are standard. Nerve's 84-line limit is an outlier.
2. Replace keyword selection with contiguous head and tail text that favors the tail.
3. Notices should state the range shown, the total, and the file path.
4. Steer file reads to `read` in tool descriptions, and make `read` pages large enough that steering doesn't just move the extra turns elsewhere.
5. Separate visibility on the first turn from how long output stays in context. Old-output clearing is what makes generous inline budgets affordable.

## Proposed changes

### 1. Size-driven inline budget

Change `process_diagnostics.inline` to 12,000 bytes with a line ceiling of about 400. The line ceiling guards against pathological many-short-line output; bytes decide in normal cases.

### 2. Head/tail overflow preview

When output exceeds the inline budget, fill the overflow budget with a head/tail view using the existing `headTailText` strategy:

- Use the full overflow budget. Raise it from 4,000 bytes to 8,000 bytes, with a line ceiling of 200. Testing showed a 100-line ceiling left short-line output (such as test runs) with about 1 KB of preview. After change 1 this applies only to outputs above 12 KB, so the preview stays a small fraction of the original.
- Bias toward the tail (about 20% head, 80% tail, as Gemini CLI does), where process output usually puts summaries, errors and exit context.
- Keep the status header. Use a notice stating the range shown, the total lines, omitted bytes and the file path, for example `[Showing lines 1-20 and 412-480 of 480; 9.1 KB omitted. Full output: <path>]`.
- List one path: the combined output file. Add the stderr file only when it is non-empty and its content isn't already in the combined file. Drop the generic "Use read/grep for details." line, since the notice already names the file.

Today every reduced result lists `stdout.txt`, `stderr.txt` and `output.txt`, each about 120 characters. `stderr.txt` is usually empty and `stdout.txt` usually duplicates `output.txt`, so two of the three paths are noise.

This replaces the fixed 2 + 4 + 2 line selection in `projectProcessOutput`.

### 3. Remove keyword diagnostics

Remove keyword-based diagnostic selection from process projection. No surveyed harness uses it. In Nerve it selects false matches from file contents and successful logs, and test runs still have a 56% recovery rate.

The tail-biased preview from change 2 already covers failures, since errors and summaries come last. If failed runs later show high recovery, the fallback is to give them a larger tail share, not to bring keywords back.

### 4. Steer file reads to `read`

Add explicit guidance to the `bash` tool description, as Claude Code and pi do: use `read` for file contents and `grep` for search, not `cat`, `sed -n`, `head` or `tail`. File dumps followed by a `read` of the same file are the largest category of recoveries. Change 1 also shows most of them in full, since 78% of reduced file dumps were 12 KB or less.

Do not detect file-dump commands for now. Giving recognized commands such as `cat FILE` or `git show REV:PATH` the `source_text` budget would add heuristic code. Reconsider only if persisted snapshots (change 8) show file dumps are still often recovered.

### 5. Larger budget for `python_exec`

`python_exec` output is usually printed deliberately by the agent, and 68% of reduced results were recovered. Give it its own profile with an inline budget of about 24 KB, keeping the head/tail overflow.

### 6. Size-based `read` pages

Change the `source_text` profile, used only by `read`, from 200 lines / 24 KB to 50 KB with no separate content-line limit. This matches the `read` tool's own limit (`DEFAULT_MAX_LINES` 2,000 / `DEFAULT_MAX_BYTES` 50 KB in `read.ts`), so the projection no longer cuts a page the tool already bounded, leaving one limit instead of two. It also matches opencode and pi. Keep the existing `Range: lines X-Y of N. Continue with offset=K.` notice.

Evidence, from 471 paginated default reads whose files still exist on disk (the rest used relative paths or missing files):

| Page limit (no line limit) | Whole file fits | Continuation calls avoided | Added context | Net cost |
| -------------------------- | --------------- | -------------------------- | ------------- | -------- |
| 24 KB                      | 82%             | 238 of 263                 | +0.39M tokens | −$2.3    |
| 32 KB                      | 94%             | 253                        | +0.45M        | −$2.7    |
| 40 KB                      | 96%             | 257                        | +0.48M        | −$2.8    |
| 48 / 50 KB                 | 98%             | 263 (all)                  | +0.50M        | −$2.9    |

Most of the gain comes from removing the 200-line limit. Among files that needed paging, the median is 12 KB and the 90th percentile is 28 KB, so limits from 32 to 50 KB behave almost identically. The small net cost comes from whole files staying in context when only part was needed; change 9 offsets it. Across all 3,830 paginated reads, this removes roughly 1,500–2,000 continuation calls.

Explicit `offset`/`limit` reads are unaffected, apart from the larger byte budget.

### 7. Subagent report limit

Raise `SUBAGENT_REPORT_INLINE_BYTES` (`packages/contracts/src/domains/subagents/constants.ts`) from 16 KB to 50 KB, for consistency with `read`. Reports above the limit keep the existing `[truncated; full response: <path>]` notice.

The effect is small. Of 1,836 completed subagent reports, only 8 exceeded 16 KB, and the parent read none of them back. Report sizes: median 0.9 KB, 90th percentile 5.2 KB, 99th percentile 12.2 KB.

### 8. Persist projection decisions

`projectAgentResult` already computes an `AgentProjectionSnapshot`, with profile, strategy, and original and displayed bytes and lines. It is dropped before persistence: tool response events store only the preview blocks.

Store the snapshot as an optional `agentProjectionSnapshot` field in the `tool_call_response` event payload, next to `agentProjection`. The payload is the JSON `payload` column of `conversation_event`. Only `tool-result.service.ts` needs to keep the snapshot `projectAgentResult` already returns. This changes the payload contract in `packages/contracts`, not the database schema. Older events have no snapshot, so no migration is needed. The snapshot is a few hundred bytes per tool result.

The snapshot makes reduction exact rather than inferred from notice text. A later analysis or a debug query can then measure, per profile:

- the reduction rate
- the share of reductions followed by a recovery call
- the size distribution of reduced output

This replaces the heuristics used in this proposal.

### 9. Follow-up: old tool output clearing

This is a separate, later phase. After a configurable number of turns, or once older tool output passes a token threshold, replace older large tool results with a short stub that keeps the status line, the original size and the file path. The agent can re-read the file if it needs the content again.

Design constraints:

- **Prompt cache.** Rewriting earlier messages invalidates the cached prefix. Clear in batches at infrequent boundaries, as Gemini CLI does by acting only above a 30,000-token prunable minimum. Do not clear on every turn.
- **Protect recent output.** Recent tool results stay intact, for example the newest N turns or tokens.
- **Durability.** The provider-visible history changes, but the stored transcript and output files do not, so replay and the UI keep the full results.

Once clearing exists, rerun the cost model. Inline budgets near the prior-art range (24–32 KB for process output) are likely to become worthwhile.

## Follow-up: stored output

Each bash call stored its output about three times. Production totals so far:

| Copy                                               | Size          |
| -------------------------------------------------- | ------------- |
| `stdout.txt` + `stderr.txt`                        | 113 MB + 5 MB |
| `output.txt`                                       | 59 MB         |
| `result.json` payload, with full stdout and stderr | 155 MB        |

Separately, `read`, `grep` and `find` payloads stored their text twice, as `content` and as identical text-only `contentBlocks`. That accounted for 46%, 35% and 28% of their bytes; read payloads alone are 416 MB.

Changes:

- **Text stored once.** Stored payloads drop `contentBlocks` that repeat `content`, and drop process `stdout`/`stderr` when `content` exists. Readers already prefer `content`.
- **No stream copies in results.** Foreground bash no longer reads its capture files into the result.
- **One capture file.** Bash, background bash and `python_exec` write only `output.txt`, the raw output in arrival order. Line numbers in agent notices therefore match the file. Background-bash log pages return that one stream. Launches keep their own per-stream logs.
- **Migration 0003.** Older background runs without an `output.txt` (5 in production, converted by 0001 from the old task layout) get one built from their ordered `combined.txt`, or from stdout followed by stderr. The fallback reader is removed. Original stream files are kept because older transcripts quote their paths.

## Out of scope

- **Other tool profiles.** `grep`, `find`, `ls` and web tools show negligible recovery.
- **Path variables** such as `$CONV_DATA/tool-calls/<id>/` in notices and tool arguments. Listing one path saves more than shortening three. A variable would also resolve to the wrong folder in subagents and forked conversations, would need expanding in every path-taking tool and in permission checks, and could leak unexpanded into scripts, summaries and the UI.
- **LLM summarization of tool output**, as Gemini CLI's distillation does. It adds latency and cost and can lose detail; head/tail plus a file is enough for now.
- **Context-relative limits**, as Gemini CLI lowers its limit when the context is nearly full. This is worth considering with change 9.

## Implementation notes

Foreground `bash` output is projected twice:

1. `tool-host.adapter.ts` calls `projectProcessOutput`, and the result becomes `result.content`.
2. `tool-result.service.ts` passes the whole result, including the raw `stdout`/`stderr`, through `projectAgentResult` with `processAgentResultPolicy`.

The second pass only left the first pass's output alone because both used the same 84-line inline limit. Once the first pass shows more, the second pass would cut it again.

Resolution:

- **One projection.** `projectProcessOutput` runs `projectAgentResult` with the same `process_diagnostics` profile and `head_tail` strategy as the bash policy. Its output always fits that profile's inline budget, so the second pass is a no-op. A unit test checks this for inline and reduced output.
- **One snapshot.** The adapter returns the first pass's snapshot in `details.agentProjectionSnapshot`. `tool-result.service.ts` records it when its own pass is unchanged, so the stored snapshot describes the real reduction.
- **Python.** `python_exec` trimmed its own output above 32 KB / 500 lines in `process-result.ts`, so large output never reached the `script_output` budget. `buildProcessResult` now takes an `agentProfile` and projects with the same shared function (`projectProcessText`), returning the snapshot like bash does.
- **Log pages.** `async_bash` and `launch` log pages are bounded by the process overflow budget (8,000 bytes, 200 lines). Both tools now use the `process_diagnostics` profile, so a page plus its surrounding status text fits inline. Previously the `lifecycle_state` profile (80 lines, 8 KB) could cut pages.

## Rollout and validation

Implemented in one PR, with unit tests for:

- the inline threshold and line ceiling
- head/tail overflow and notice text, including the single output path
- removal of keyword diagnostics
- single-owner projection, so producer-projected output is not cut again
- `python_exec` projection through the shared function
- size-based `read` pages
- persisted projection snapshots and once-stored result text
- the single capture file and migration 0003, including rollback and re-runs

Migration 0003 was rehearsed on a copy of a production-like home and on the 0.34.1 snapshot through 0001 → 0002 → 0003, followed by the read-only history gate. An end-to-end run on a dev instance covered inline and reduced bash, a failing command, large `python_exec` output, a background run and its log page, and a 50 KB `read` page.

Change 9 is proposed separately, using data from persisted snapshots.

### Measuring the result

After about two weeks, rerun the analysis using `agentProjectionSnapshot` instead of notice-text heuristics. Success criteria:

- The share of reduced process results that are recovered drops from about 62% to below 25%.
- Recovery-only turns drop by at least half.
- Default `read` calls followed by a continuation drop from 41% to below 10%.
- Mean context tokens per conversation do not grow by more than a few percent, and compaction frequency does not rise noticeably.

## Methodology notes

- **Recovery detection was heuristic.** It looked for the output file path in later arguments, a re-run with a normalized command, or a `read` of the same file within three calls. Some legitimate exploration may be counted as recovery.
- **Original sizes** for process results come from retained output files.
- **Token estimates** assume about 4 bytes per token.
- The analysis scripts are not committed. They queried a read-only `sqlite3 .backup` snapshot, never the live database.
