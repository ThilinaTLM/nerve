# Phase 1: low-hanging fruit

> **Status:** Implemented. Part of [agent tool interface](README.md). Evidence and the strings it replaced are in [review.md](review.md).
>
> Differences from the text below: grep prints its exact match total instead of `100+`, because the tool already counts past its limit; the overflow branches in `process-result.ts` stay, because `web_search` and `explain_image` still reach them; `python_exec` `Unknown system error -122` was a full disk quota and is now reported as such.
>
> **Schema compaction.** An A/B run on Haiku 5.5 showed that §1 made the tool schemas about 300 characters longer, a cost paid on every request. A follow-up pass kept only the additions tied to observed failures, removed text repeated between descriptions and parameters, emitted enums as `enum` instead of `anyOf`/`const`, and moved the Jira and Confluence guide references from 28 tool descriptions to one system-prompt line per active family. Tool definitions went from 30,391 to 23,995 characters (−21%) against `main`; parameter names, defaults applied by executors, and validation are unchanged.

## Scope and expected effect

Descriptions, defaults, result wording, error text and small bug fixes. No new parameters or tools. Each item is small and can ship on its own.

This is polish. Failures are about 2% of calls, and the error-text changes save roughly 0.5M of 258M chars. It is worth shipping because it is cheap and removes retries, but it won't visibly change productivity on its own. The larger lever is round trips; §8 (the parallel-call line) is the first step there, and [phase 2](phase-2-round-trips.md) follows only if it isn't enough.

## 1. Say defaults, caps and rules in the schemas

Use the JSON Schema `default` keyword for defaults, once each provider's strict function-calling mode is confirmed to accept it. State caps in words, not with `maximum`: arguments are validated against the schema, so `maximum` would turn today's silent clamp into a failed call. Keep clamping, and say so in the result when it happens (`byteLimit clamped to 4096`).

| Tool        | Change                                                                                                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| read        | `limit`: default 2000. `byteLimit`: default 4096, "capped at 4096". Description: "Use offset/limit or byteOffset/byteLimit, not both."                                                                               |
| edit        | Description: "Exact, unique text replacements in an existing file. Every oldText matches the original file; the batch applies atomically."                                                                           |
| grep        | `limit`: default 100. `path`: "Or use paths." `glob`: "File filter, e.g. `*.ts` or `**/*.test.ts`."                                                                                                                  |
| find        | `limit`: default 1000.                                                                                                                                                                                               |
| ls          | `limit`: default 500.                                                                                                                                                                                                |
| bash        | `background`: "Return at once; a notice arrives on exit." `ready`: "With background: an http(s) URL to poll or a regex to wait for in output, up to 60 s." Remove "Large output is shortened…" from the description. |
| python_exec | `timeout`: integer, default 60, "capped at 600". Say "Pass code or a script path." once in the description instead of on both parameters.                                                                            |
| launch      | Description: "`name` or `runId` selects the run."                                                                                                                                                                    |
| web_search  | `max_results`: default 5. Description: "Returns titled snippets with URLs."                                                                                                                                          |
| web_fetch   | `raw`: "Skip HTML to Markdown conversion."                                                                                                                                                                           |

Files: `packages/tools/src/catalog/definitions/core/{filesystem,shell,python,web}.tools.ts`, `orchestration/process.tools.ts`.

## 2. One read default

`read` with `offset` and no `limit` defaults to 1000 lines (`read.ts:108`); without arguments it reads up to 2000. Use 2000 in both cases.

## 3. Continuation and truncation notices

**Paging tools (read, async_bash, launch):** when the tool cut the output, end with one line whose `Next:` carries a compact JSON object holding only the arguments that change:

```text
Lines 65-94 of 388. Next: {"offset":95}
Bytes 0-4095 of 10006. Next: {"byteOffset":4096}
Lines 801-900 of 2400 (running). Earlier: {"offset":700}
```

- When the model chose the window itself (its own `offset`/`limit` ended before the file did), print only `Lines 65-94 of 388`. 16.7k reads pass their own `offset` and `limit`.
- A hint pointing to another tool gives its full arguments: `Next: read {"path":"src/a.min.js","byteOffset":20480}`.
- When no safe next call exists, say why in one line. Replace the dead ends at `read.ts:120` ("Narrow this read range…") and `read.ts:314,326` ("Use byteOffset/byteLimit…") with exact values.
- Replace read's two trailers (`[...N more lines. Continue with offset N.]` and `Range: lines A-B of N.`) with the single line above. Print nothing when the whole file was returned.

**Listing tools (grep, find, ls):** these have no skip argument, and the agent projection caps them below their default limits (80 match lines or 120 items), so `Next: {"limit":…}` would resend what was shown and hit the same cap. When the output is cut, give a narrowing summary instead:

```text
Showing 62 of 340 matches. By file: src/a.ts 120, src/b.ts 95, test/a.test.ts 60, 17 other files 65. Narrow with path, glob or a tighter pattern.
```

Counts cover the matches the tool collected. When the tool's own limit stopped collection, print the total as `100+`.

Confirm the cut-off path in `itemAwareHead` (`strategies.ts`) while implementing this.

Code that produces or strips these strings, and must change together: `read.ts`, `search.ts:497`, `find.ts:240`, `list.ts:55`, `strategies.ts:269,272,443,481`, `candidate-continuation.ts:45-47`, `process-output.ts:84-107`.

## 4. Edit and write results

- **Ambiguous edit (76 in the snapshot):** list each match with its line number and one neighbouring line, so the agent can see which context tells them apart. The executor already collects every match offset (`edit.ts:235-238`). List at most five matches, then a count of the rest; an `oldText` like `}` can match hundreds of times.

  ```text
  edits[1].oldText matched 3 times. Add context that tells them apart:
    41: return value;      (after: if (cached) {)
    88: return value;      (after: const value = read();)
    130: return value;     (after: // fallback)
  ```

- **Not found (87):** when a whitespace-normalised match exists, show that line and its number. Otherwise keep today's message. No fuzzy similarity search.
- **Would not change the file (33):** "file already contains this text". These are most likely edits that already landed.
- **Missing file:** `edit: file not found: <path>. Use write to create it.` instead of a raw `ENOENT`.
- **Edit success:** `Edited <path>: 2 replacements, lines 41-47 and 130.` Line ranges come from the match offsets the executor already has; today only `firstChangedLine` is kept.
- **Write success:** `Created <path> (42 B).` or `Overwrote <path> (42 B).` Keep the UI fallback `/Wrote (\d+) bytes/` in `tool-result-parser.ts:438` for old transcripts.

## 5. Errors

Render failures in one line from `projector.ts:165-180`:

```text
read: path not found: packages/x/y.ts
```

- Drop `Tool execution failed.`, the `Tool:` line, and the generic `Next action:` sentence. Keep `Next action:` only when the reason supplies a specific one.
- Denied, interrupted and cancelled results use the same one-line form but keep their meaning: who denied the call and that it was not performed, and that an interrupted or cancelled call implies no rollback.
- Show the resolved path only when it differs from the argument in a meaningful way.
- Map `ENOENT`, `EACCES`, `EISDIR` and `ENOTDIR` to plain wording.
- Include the path in `find path is not a directory.` and `ls path is not a directory.`; if it is a file, say so and suggest `read`.
- Bash `cwd` not found: one line, suggesting `mkdir -p` in the command instead.

## 6. Not-found directory listing

The largest failure class (more than 600 not-found errors for read, grep, ls and find). For those four tools only, list the nearest existing directory:

```text
read: path not found: packages/contracts/src/domains/tool/results.ts
Nearest existing directory packages/contracts/src/domains/ contains: core/ settings/ tools/ index.ts
```

- `stat` up the path to the nearest existing ancestor, then one `readdir`. Sort entries by shared prefix with the missing path segment, then cap at about 30, so the likely match survives in a large directory. No fuzzy search.
- Not for `edit` or `write`.
- No separate permission check. By default the permission engine doesn't deny reads by path; if a policy does deny the follow-up `ls` or `read`, that denial is handled like any other.

## 7. Denials say why

All 630 policy denials in the snapshot (bash 494, web_search 63, web_fetch 47, others 26) came from one rule: `deny-everything-else` in the `read_only` rule set. Those are read-only agents, such as explore sub-agents, being offered bash and web tools and then refused. There were no user denials and no path-based denials. The rule's reason is stored in `supervision.reason`, but the agent sees `Reason: No further diagnostic was supplied.`, so it can't tell a mode restriction from a one-off refusal.

- Pass the policy reason through to the agent. In read-only mode, say so and name the available tools: `bash: not available in read-only mode. Use read, grep, find or ls.`
- Which tools a rule set offers or allows is permission-model work and out of scope here. This item changes only the text the agent sees.
- No per-command translation into an equivalent `read` or `grep` call. With the reason shown, the agent can choose the tool itself.

## 8. Ask for parallel tool calls

Nothing in the system prompt or tool descriptions asks for parallel calls, and only 10–18% of tool-calling messages from the main models contain more than one call. Add one line to the system prompt (`nerve-system-prompt.ts`), always included:

> Make independent lookups (reads, searches, listings) as parallel tool calls in one turn.

The effect shows in production data within days: track the multi-call share of tool-calling messages per model, and Claude's multi-file `cat`/`sed -n` share in bash.

## 9. One exit line

Bash and python_exec end with the same footer, `exit 0` or `exit 1 · 12.4s`. The duration appears only above about 1 s. This replaces `Status: completed; exit code: 0` (top), `Process exit code 0.` and `Duration: N ms` (bottom). Update the noise filter in `conversation-title.ts:296` to the new prefix.

## 10. Bug fixes found during review

- **find backend parity:** the `fd` backend adds a `**/` prefix to patterns; the Node fallback (`fallbackFind`) matches the raw relative path. Write a test that runs the same patterns through both, then make them agree.
- **python_exec `Unknown system error -N`** (25 failures): investigate.
- **Unreachable overflow branches** in `process-result.ts`: confirm that bash and python_exec no longer reach them through `projectAgentContent`, then remove them.

## Tests

Update the tests that pin the current strings: `filesystem.test.ts`, `result-projection.test.ts`, `process-output.test.ts`, `bash.test.ts`, `tool-host.adapter.test.ts`, `async-bash.service.test.ts`. Add tests for the read mixed-argument error, the ambiguous-edit listing, the not-found directory listing and its ordering, and the read-only denial message. Update the design-lab fixtures (`ToolCardsSection.svelte`, `tool-card-view-fixtures.ts`) so they stay realistic.
