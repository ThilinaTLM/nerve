# Phase 1: low-hanging fruit

> **Status:** Proposal. Part of [agent tool interface](README.md). Evidence and current strings are in [review.md](review.md).

## Scope

Text and description changes only, plus one default. No new parameters, tools, lookups, schema renames or storage changes. Each item is small and can ship on its own.

## 1. Say defaults, caps and rules in the schemas

Use JSON Schema `default` and `maximum` keywords where a value exists; use a few words of `description` only for rules a keyword can't express.

| Tool        | Change                                                                                                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| read        | `limit`: default 2000. `byteLimit`: default and maximum 4096. Description: "Use offset/limit or byteOffset/byteLimit, not both."                                                                                     |
| edit        | Description: "Exact, unique text replacements in an existing file. Every oldText matches the original file; the batch applies atomically."                                                                           |
| grep        | `limit`: default 100, maximum 2000. `path`: "Or use paths." `glob`: "File filter, e.g. `*.ts` or `**/*.test.ts`."                                                                                                    |
| find        | `limit`: default 1000, maximum 5000.                                                                                                                                                                                 |
| ls          | `limit`: default 500, maximum 5000.                                                                                                                                                                                  |
| bash        | `background`: "Return at once; a notice arrives on exit." `ready`: "With background: an http(s) URL to poll or a regex to wait for in output, up to 60 s." Remove "Large output is shortened…" from the description. |
| python_exec | `timeout`: integer, default 60, maximum 600. Say "Pass code or a script path." once in the description instead of on both parameters.                                                                                |
| launch      | Description: "`name` or `runId` selects the run."                                                                                                                                                                    |
| web_search  | `max_results`: default 5. Description: "Returns titled snippets with URLs."                                                                                                                                          |
| web_fetch   | `raw`: "Skip HTML to Markdown conversion."                                                                                                                                                                           |

Files: `packages/tools/src/catalog/definitions/core/{filesystem,shell,python,web}.tools.ts`, `orchestration/process.tools.ts`.

## 2. One read default

`read` with `offset` and no `limit` defaults to 1000 lines (`read.ts:108`); without arguments it reads up to 2000. Use 2000 in both cases.

## 3. Structured continuation hints

Every truncated result ends with one hint line. `Next:` carries a compact JSON object with only the arguments that change:

```text
Lines 65-94 of 388. Next: {"offset":95}
Bytes 0-4095 of 10006. Next: {"byteOffset":4096}
100 matches shown, more exist. Next: {"limit":400}
Lines 801-900 of 2400 (running). Earlier: {"offset":700}
```

- A hint pointing to another tool gives its full arguments: `Next: read {"path":"src/a.min.js","byteOffset":20480}`.
- When no safe next call exists, say why in one line. Replace the dead ends at `read.ts:120` ("Narrow this read range…") and `read.ts:314,326` ("Use byteOffset/byteLimit…") with exact values.
- Replace read's two trailers (`[...N more lines. Continue with offset N.]` and `Range: lines A-B of N.`) with the single first line above. Print nothing when the whole file was returned.

Code that produces or strips these strings, and must change together: `read.ts`, `search.ts:497`, `find.ts:240`, `list.ts:55`, `strategies.ts:269,272,443,481`, `candidate-continuation.ts:45-47`, `process-output.ts:84-107`.

## 4. Edit and write results

- **Ambiguous edit:** `edits[1].oldText matched 3 times, at lines 41, 88, 130. Add surrounding context.` The executor already collects every match offset (`edit.ts:235-238`), so this needs no extra lookup.
- **Edit on a missing file:** `edit: file not found: <path>. Use write to create it.` instead of a raw `ENOENT`.
- **Edit success:** `Edited <path>: 2 replacements, lines 41-47 and 130.` Line ranges come from the match offsets the executor already has; today only `firstChangedLine` is kept.
- **Write success:** `Created <path> (42 B).` or `Overwrote <path> (42 B).` Keep the UI fallback `/Wrote (\d+) bytes/` in `tool-result-parser.ts:438` for old transcripts.

## 5. Shorter errors

Render failures in one line from `projector.ts:165-180`:

```text
read: path not found: packages/x/y.ts
```

- Drop `Tool execution failed.`, the `Tool:` line, and the generic `Next action:` sentence. Keep `Next action:` only when the reason supplies a specific one.
- Show the resolved path only when it differs from the argument in a meaningful way.
- Map `ENOENT`, `EACCES`, `EISDIR` and `ENOTDIR` to plain wording.
- Include the path in `find path is not a directory.` and `ls path is not a directory.`; if it is a file, say so and suggest `read`.
- Bash `cwd` not found: one line, suggesting `mkdir -p` in the command instead.

## 6. One exit line

Bash and python_exec end with the same footer, `exit 0` or `exit 1 · 12.4s`. The duration appears only above about 1 s. This replaces `Status: completed; exit code: 0` (top), `Process exit code 0.` and `Duration: N ms` (bottom). Update the noise filter in `conversation-title.ts:296` to the new prefix.

## Tests

Update the tests that pin the current strings: `filesystem.test.ts`, `result-projection.test.ts`, `process-output.test.ts`, `bash.test.ts`, `tool-host.adapter.test.ts`, `async-bash.service.test.ts`. Add tests for the read mixed-argument error and the ambiguous-edit line numbers. Update the design-lab fixtures (`ToolCardsSection.svelte`, `tool-card-view-fixtures.ts`) so they stay realistic.
