# Agent tool interface: review

> **Status:** Evidence for the [agent tool interface proposal](README.md). It covers argument shapes, descriptions and result formats of the most used agent tools. Phase plans live in the phase documents; this file holds the findings they rely on. A Sonnet 5.5 agent reviewed the findings as a user of these tools; where the usage data supported its points, they are folded in.

## Evidence base

- **Usage data:** 127,807 `tool_call_response` events from a read-only snapshot of a production Nerve home (2026-09-14 → 2026-11-10). Result size is the character length of the text blocks in `agentProjection`, which is what the model receives.
- **Code review:** catalog definitions (`packages/tools/src/catalog/definitions/**`), executors (`packages/tools/src/execution/**`) and agent projection (`packages/tools/src/result-projection/**`). File and line references are as of `6678f0d2c`.
- **Provider naming:** on Anthropic OAuth (Claude subscription) connections, `pi-ai` (`dist/api/anthropic-messages.js`, "stealth mode") renames tools whose names match Claude Code tools, ignoring case, to Claude Code's casing (`read` → `Read`, `bash` → `Bash`, `grep` → `Grep`, `edit` → `Edit`, `write` → `Write`). It maps the names back in responses. Argument shapes stay Nerve's. API-key connections are not renamed.

### Usage by tool

| Tool            | Calls  | Share | Not completed | Median / p90 chars | Total chars |
| --------------- | ------ | ----- | ------------- | ------------------ | ----------- |
| read            | 46,195 | 36.1% | 2.0%          | 2,745 / 7,794      | 176.1M      |
| bash            | 41,649 | 32.6% | 1.6%¹         | 580 / 3,097        | 49.7M       |
| grep            | 14,197 | 11.1% | 3.3%          | 762 / 5,946        | 27.8M       |
| edit            | 7,483  | 5.9%  | 3.3%          | 161 / 195          | 1.3M        |
| python_exec     | 3,638  | 2.8%  | 1.4%          | 49 / 1,064         | 1.5M        |
| write           | 3,472  | 2.7%  | 0.4%          | 142 / 178          | 0.5M        |
| find            | 3,445  | 2.7%  | 1.3%          | 220 / 5,869        | 5.3M        |
| subagent_prompt | 2,369  | 1.9%  | 0.5%          | 59 / 115           | 0.2M        |
| ls              | 1,904  | 1.5%  | 3.1%          | 283 / 709          | 0.8M        |
| todos_set       | 880    | 0.7%  | 0%            | 329 / 528          | 0.3M        |
| async_bash      | 572    | 0.4%  | 0.3%          | 123 / 1,333        | 0.3M        |
| launch          | 439    | 0.3%  | 1.8%          | 181 / 1,444        | 0.3M        |
| ask_user        | 359    | 0.3%  | 1.1%          | 432 / 1,376        | 0.2M        |
| web_fetch       | 341    | 0.3%  | 20.5%¹        | 309 / 1,422        | 0.3M        |
| subagent_status | 263    | 0.2%  | 0%            | 448 / 548          | 0.1M        |
| web_search      | 202    | 0.2%  | 31.7%¹        | 2,428 / 3,490      | 0.4M        |

¹ Mostly permission denials (bash 494, web_search 63, web_fetch 47). All 630 denials in the snapshot came from one rule, `deny-everything-else` in the `read_only` rule set: read-only agents (such as explore sub-agents) offered bash and web tools, then refused. There were no user denials and no path-based denials. The rule's reason is stored in `supervision.reason`, but the agent sees `Reason: No further diagnostic was supplied.` 221 of the 494 bash denials were plain reads or searches.

**Scale.** Failures are about 2,650 of 127,807 calls (2%). Fixing failure handling is cheap and worth doing, but it won't visibly change productivity. The volume is in round trips (86% of turns make one call) and in Claude's bash calls that bypass the dedicated tools.

The tools in this table account for about 98% of calls, and read, bash and grep alone for 80%. Ergonomics work outside the top eight has little measurable effect.

### Model-specific tool choice (2026-10-16 onward)

| Model             | Calls  | read   | grep  | bash   | bash `grep`/`rg` | bash `sed -n` | bash `cat` |
| ----------------- | ------ | ------ | ----- | ------ | ---------------- | ------------- | ---------- |
| gpt-6.1-sol       | 46,768 | 18,324 | 5,484 | 11,350 | 1,255            | 469           | 838        |
| claude-opus-5-5   | 19,786 | 4,065  | 543   | 11,638 | 6,744            | 2,373         | 937        |
| claude-sonnet-5-5 | 16,767 | 4,324  | 573   | 10,633 | 6,269            | 2,968         | 1,439      |
| gpt-6-luna        | 6,710  | 3,521  | 1,673 | 315    | 49               | 45            | 33         |
| claude-haiku-5-5  | 2,962  | 1,334  | 1,063 | 266    | 105              | 15            | 76         |

The `bash grep`/`rg` column counts every bash call that contains grep or rg. Opus and Sonnet together made about 3.8k calls that only filter another command's output (`pnpm check | grep error`), which the grep tool can't replace. Counting only calls that search files, Claude Opus and Sonnet search through bash about 9 times as often as they use `grep` (about 9.8k versus 1.1k). They also read through `sed -n`/`cat` often. The Bash description already says "Use read for file contents and grep/find/ls to search, not cat/sed/head/tail/rg". These models ignore it. GPT models mostly follow it. See [Shell-first models](#shell-first-models).

## Cross-cutting findings

### 1. The error envelope is verbose and generic

Every failed call is rendered like this:

```text
Tool execution failed.
Tool: read
Reason: read path not found: "packages/x/y.ts" (resolved to /home/u/proj/packages/x/y.ts).
Resource: /home/u/proj/packages/x/y.ts
Next action: inspect the reason, adjust the request if appropriate, and retry only when safe.
```

- `Tool:` repeats the tool name, which the model already has from the call it just made.
- The path can appear three times (the argument, `resolved to`, `Resource:`).
- `Next action:` is the same sentence on every failure, so it adds no information.
- Some reasons are raw Node errors, for example `ENOENT: no such file or directory, open '…'` from `edit`, and `Unknown system error -N` from `python_exec` (25 times).

**Proposal**

- Render one line, `<tool>: <reason>`. Add `Next action:` only when there is a specific instruction.
- Show the resolved path only when it differs from the argument in a way that matters, for example a relative path resolved against an unexpected cwd.
- Map common errno failures (`ENOENT`, `EACCES`, `EISDIR`, `ENOTDIR`) to the same wording the `read` and `grep` not-found messages use.

This is a cheap cleanup, not a retry reducer. Models skip the generic lines anyway. The saving is about 0.5M chars over the 2,647 failed calls in the snapshot.

### 2. Not-found paths are the most common failure

Not-found errors are the top error class for `read`, `grep`, `ls` and `find`: more than 600 in the snapshot, mostly guessed paths under `packages/*/src/…`. The agent usually follows with `ls` or `find` before retrying.

**Proposal:** add recovery information to the error, within a small fixed size:

```text
read: path not found: packages/contracts/src/domains/tool/results.ts
Nearest existing directory packages/contracts/src/domains/ contains: core/ settings/ tools/ index.ts
```

- Find the nearest existing ancestor with `stat` calls up the path, then list it with one `readdir`, capped at about 30 entries. No fuzzy search, so no time budget to tune.
- The listing respects the permission policy: show it only when the agent could `ls` that directory.
- Apply this only to the read-only tools: `read`, `grep`, `ls`, `find`. For `edit` and `write`, a guessed path is the wrong thing to hint at.
- This saves one round trip per miss. It is the largest failure class, so it ships in phase 1.

### 3. Continuation hints differ by tool and code path

| Source                         | Wording                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `read.ts:121` (raw)            | `[...N more lines. Continue with offset 95.]`                      |
| `read.ts:256` (bytes)          | `Continue with byteOffset 5027.`                                   |
| `read.ts:328` (whole-file)     | `Continue reading with offset N.`                                  |
| `candidate-continuation.ts:45` | `Continue with offset=N.`                                          |
| `read.ts:120`                  | `Narrow this read range before continuing past it.` (no values)    |
| `search.ts:497`                | `[Match limit 100 reached. Increase limit or refine the pattern…]` |
| `find.ts:240`                  | `[Result limit 1000 reached. …]`                                   |
| `list.ts:55`                   | `[...N more entries. Increase limit to see more.]`                 |
| `process-output.ts:107`        | `Next offset: N`                                                   |

**Proposal (decided):** use one structured hint for paging. `Next:` is followed by a compact JSON object holding only the arguments that change. The model reuses the rest of its previous call as it is, so the path isn't repeated.

- Emit `Next:` only when the tool cut the output. 16.7k reads passed their own `offset` and `limit`; when the model chose the window, `Lines 65-94 of 388` is enough.
- grep, find and ls have no skip argument, and the projection cap (80 match lines, 120 items) is below their default limits, so a `Next:` hint can't work there. They get a narrowing summary instead; see [grep](#grep).

```text
Next: {"offset":95}
Next: {"byteOffset":5027}
Earlier: {"offset":0}
```

- The JSON uses the tool's real argument names, so the model can copy it into the call exactly. The cost is a few characters more than `offset=95`.
- `Earlier:` is only for paging backwards through process logs.
- A short plain-text note after the JSON can give context. Nothing else goes on the line.
- Never end a tool-truncated read or process page without a `Next:` hint. If no safe next call exists, say why in one line instead of giving a vague instruction.

### 4. Defaults and caps exist only in code

The schema doesn't state any of these:

- `read`: 2,000 lines / 50 KiB without arguments, but `limit` defaults to 1,000 when only `offset` is given (`read.ts:108`).
- `read`: `byteLimit` defaults to 4,096 and is capped at 4,096.
- `grep` `limit`: default 100, max 2,000.
- `find` `limit`: default 1,000, max 5,000.
- `ls` `limit`: default 500, max 5,000.
- `python_exec` `timeout`: default 60 s, cap 600 s.
- `web_search` `max_results`: default 5.

**Proposal:**

- State defaults with the JSON Schema `default` keyword, after checking that each provider's strict function-calling mode accepts it.
- State caps in a few words of description, not with `maximum`. Arguments are validated against the schema (`argument-validation.ts`), so `maximum` would turn today's silent clamp into a failed call. Keep clamping, and say so in the result (`byteLimit clamped to 4096`).
- Remove the `read` 1,000 versus 2,000 inconsistency.

### 5. Exit and status lines vary

| Path                               | Line                                      | Position |
| ---------------------------------- | ----------------------------------------- | -------- |
| bash (agent projection)            | `Status: completed; exit code: 0`         | top      |
| python_exec                        | `Process exit code 0.` + `Duration: N ms` | bottom   |
| `process-result.ts` (other branch) | `Command exited with code N.`             | bottom   |
| async_bash / launch pages          | `Lines A-B of N (running).`               | top      |

**Proposal:**

- Use one footer for bash and python_exec: `exit 0 · 1.4s`. Show the duration only for runs over about 1 s.
- Leave out `completed` when the exit code already says it.
- Remove the `process-result.ts` overflow branches that are no longer reachable now that bash and python use `projectAgentContent`.

### 6. Identifier and casing drift

| Tool            | Identifier                 |
| --------------- | -------------------------- |
| async_bash      | `id`                       |
| launch          | `name`, `runId`            |
| subagent_prompt | `assignments[].name`       |
| subagent_status | `name` (optional)          |
| subagent_stop   | `names` (array)            |
| plan_present    | `file_path` (snake_case)   |
| web_search      | `max_results` (snake_case) |

**Proposal:** none. There is no failure evidence for any of these, so renames fail the admission rule (see [Considered and dropped](#considered-and-dropped)).

## Per-tool review

### read

**Arguments** (`filesystem.tools.ts:10-29`)

| Param        | Today                               | Issue                                                                               |
| ------------ | ----------------------------------- | ----------------------------------------------------------------------------------- |
| `path`       | "Relative or absolute."             | Fine.                                                                               |
| `offset`     | "1-indexed line."                   | Fine, but its base differs from `byteOffset` and from the 0-based process `offset`. |
| `limit`      | no description                      | Default depends on whether `offset` was given (1,000 or 2,000).                     |
| `byteOffset` | "0-indexed; not with offset/limit." | Only this param mentions the either/or rule.                                        |
| `byteLimit`  | no description                      | Default and cap are 4,096 and not stated. `byteLimit` + `limit` is rejected.        |

- Mixing line and byte arguments throws (`read.ts:78-81`). Models still sent mixed arguments 13 times (`byteLimit`+`limit` 10, all three 3).
- Argument patterns seen:
  - none: 17.8k
  - `offset`+`limit`: 16.7k
  - `limit` only: 10.8k
  - `offset` only: 822
  - byte mode: 50
- Byte mode is rare but needed for minified or single-line files.
- A byte argument also turns off image detection, so a byte range on an image returns raw bytes. This isn't documented.

**Description:** "Read a text file or image. Text output is bounded; page with offset/limit, or byteOffset/byteLimit for long lines." It is short and accurate, but it doesn't state the exclusivity rule.

**Response**

```text
<file text, no line-number prefix>

[...294 more lines. Continue with offset 95.]
Range: lines 65-94 of 388.
```

- Two trailer lines give overlapping information.
- `Range:` uses 1-based inclusive lines. Byte mode uses 0-based end-exclusive ranges with the same label.
- No line-number prefixes is a deliberate token saving (about 10–15% on code). `edit` matches on text, so line numbers aren't needed. Keep it.

**Behaviour seen**

- Size is not the problem: the median page is 2.7k chars, and pages over 20k chars make up only 5–11% of read volume.
- The cost comes from call count, and much of it is unavoidable. 2,263 paging chains (same path, immediately followed by a read with `offset`) are the only clear pattern.
- Repeated identical reads are rare. 737 reads repeated an earlier call's arguments on an unedited file and got byte-identical output. That is 0.8M chars, about 0.5% of read volume. A "file unchanged since your last read" stub was considered and rejected:
  - The saving is small.
  - After compaction, or after a bash command has changed the file, the agent may no longer have the content the stub refers to.
- Agents read several files through bash (`cat a b c`, `sed -n` over several files) because `read` takes a single path.

**Proposals**

1. Replace both trailers with one line: `Lines 65-94 of 388. Next: {"offset":95}`. For byte mode: `Bytes 0-4095 of 10006. Next: {"byteOffset":4096}`. On the last page: `Lines 65-388 of 388`, or nothing when the whole file was returned.
2. Make the default `limit` 2,000 whether or not `offset` is given.
3. Schema text: `limit` "Lines; default 2000." `byteOffset` "0-indexed. Use instead of offset/limit." `byteLimit` "Default/max 4096." Add "Line and byte arguments can't be mixed." to the description.
4. Replace the "Narrow this read range…" dead end (`read.ts:120`) and the "Use byteOffset/byteLimit…" hints (`read.ts:314,326`) with exact values: the next safe `offset`, or the `byteOffset` of the overlong line.
5. `paths: string[]` (up to about 10, each with a short header, sharing the 50 KiB budget, no paging). This gives the multi-file batching agents now get from bash (see [Shell-first models](#shell-first-models)), with no new security surface. Planned in [phase 2](phase-2-round-trips.md).

### edit

**Arguments:** `path`, `edits[] {oldText, newText}`, `minItems: 1`, no param descriptions.

**Description:** "Replace exact, unique text in an existing file; all edits resolve against the original content." The behaviour is stricter than that:

- The batch is atomic.
- Overlapping edits are rejected. This is not a practical failure source: there was one overlap failure in the snapshot.
- An edit whose `oldText` equals its `newText` is rejected.

**Failures** (248 total, 3.3%)

| Error                                   | Count |
| --------------------------------------- | ----- |
| `edits[N].oldText was not found in …`   | 87    |
| `edits[N].oldText matched N times in …` | 76    |
| `edits[N] would not change the file.`   | 33    |
| `Invalid validated arguments for edit.` | 16    |
| raw `ENOENT` (missing file)             | some  |

**Success response:** `Edited file with 2 replacements.` It doesn't include the path or the changed line numbers. The diff exists in `details`, but the agent doesn't see it (`mutation_acknowledgement` profile).

**Proposals**

1. Make error messages specific enough to act on directly:
   - **Ambiguous:** list each match with its line number and one neighbouring line, so the agent can see which context tells them apart. A `replaceAll` flag isn't justified: of 51 ambiguous failures followed by a retry on the same file, 44 retried with more context and only 7 split the edit into several items.
   - **Not found:** only the deterministic case. When a whitespace-normalised match exists, show that line and its number. 87 misses in two months don't justify a tuned similarity threshold.
   - **Would not change the file (33):** probably an edit that already landed. Say "file already contains this text".
   - **Missing file:** `edit: file not found: <path> (use write to create it)`. No similar-path suggestion: for a write-capable tool, a guessed path is the wrong thing to hint at.
2. Success: `Edited <relative path>: 2 replacements (lines 41-47, 130).` Line ranges let the agent check its work with a targeted `read` instead of rereading the whole file.
3. Description: "Exact, unique text replacements in an existing file. All edits match the original content and apply atomically." Drop "resolve against", which reads as jargon.

### write

**Arguments:** `path`, `content`. **Description:** "Create or overwrite a file, creating parent directories." This is fine.

**Response:** `Wrote 42 bytes.`

**Proposals**

- Change it to `Created <path> (42 B).` or `Overwrote <path> (42 B, was 1.2 KB).` The model can't currently tell whether it created a file or replaced one.
- `details` holds both `bytesWritten` and `bytes`; drop one.

### grep

**Arguments**

| Param                   | Notes                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `pattern`               | Regex unless `literal`.                                                                        |
| `path` / `paths`        | Mutually exclusive; only `paths` says so ("Several targets instead of path.").                 |
| `glob`                  | Filter on file names; `find.pattern` is a path glob. Same idea, different names and semantics. |
| `ignoreCase`, `literal` | Fine.                                                                                          |
| `context`               | Fine.                                                                                          |
| `limit`                 | Default 100 matches, max 2,000; not stated.                                                    |

**Response:**

- Match lines are `path:line: text` and context lines are `path-line- text` (ripgrep style, compact).
- Long lines are cut at 500 chars and followed by a note pointing to `read`, without values.
- The projection budget is 80 lines or 16 KB.

**Errors:** path not found (more than 230 combined). The message already gives correct guidance on `path`/`paths`.

**Proposals**

1. Truncation notice: a per-file match count summary, so the agent can narrow with `glob`, `path` or a tighter pattern. Not `Next: {"limit":…}`: the agent projection caps `search_matches` at 80 lines / 16 KB, below the tool's 100-match default. In the snapshot the tool's own limit was hit twice, while the projection cut 922 grep results, 279 find results and 58 ls results. A larger `limit` can't get past that cap and would resend the matches already shown. After a cut, agents mostly moved on to `read` or `find` (488), or narrowed the search (265); only 39 raised `limit`.
2. In the long-line note, give `read {"path":"<p>","byteOffset":<n>}` for the first truncated line. A different tool is needed here, so include the full arguments.
3. Change the `glob` description to "File-name filter, e.g. `*.ts` or `**/*.test.ts`."
4. Deferred: a files-only mode (like `rg -l`). It costs far fewer tokens than full matches when planning reads, but it is not what drives bash use: `-l` appears in only about 10% of Claude's bash file searches.

### find

**Arguments:** `pattern` ("E.g. src/**/*.test.ts."), `path`, `limit` (default 1,000, max 5,000).

**Findings**

- The `fd` backend adds a `**/` prefix to patterns. The Node fallback (`fallbackFind`) matches the raw relative path, so the two backends can return different results. This is not confirmed by a test yet; write one before changing anything.
- `find path is not a directory.` (`find.ts:56`) and `ls path is not a directory.` (`list.ts:34`) omit the path.

**Proposals**

- Make both backends use the same matching rule, and test it.
- Include the path in the not-a-directory error. If the path is a file, say so and suggest `read`.
- When the projection cuts the list, give a per-directory count summary so the agent can narrow `path` or `pattern` (same reasoning as grep).

### ls

**Arguments:** `path`, `limit` (default 500, max 5,000).

**Response:** sorted case-insensitively, directories end with `/`.

**Proposals:** the same path-in-error and narrowing-summary changes as `find`. Nothing else.

### bash

**Arguments** (`shell.tools.ts:19-41`)

| Param                | Today                                         | Issue                                                                                                                      |
| -------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `command`            | none                                          | Fine.                                                                                                                      |
| `cwd`                | "Must resolve inside the project."            | 75 failures `Tool argument 'cwd' does not exist`, often when the command itself would have created the directory.          |
| `projectEnvironment` | "False skips project environment activation." | "Project environment" isn't defined anywhere the model can see.                                                            |
| `background`         | none                                          | Returns `Started async bash bash_…` (the ID is visible).                                                                   |
| `ready`              | none                                          | Only works with `background`. A URL is polled, anything else is a regex on output, waits 60 s. None of this is documented. |
| `timeout`            | only present when auto-promotion is off       | Integer seconds with a max. Python's `timeout` is a float with no stated default.                                          |

**Description:** it names the read/search tools to use instead of cat/sed/rg, and explains auto-promotion to the background and output truncation. The last sentence ("Large output is shortened…") repeats what the overflow output says when it happens.

**Response**

```text
Status: completed; exit code: 0
<output, inline up to 400 lines / 12 KB; overflow keeps 20% head + tail within 200 lines / 8 KB and saves the full log>
```

**Proposals**

1. `ready`: "With background: an http(s) URL to poll, or a regex to wait for in output (60 s)." `background`: "Return immediately; a notice arrives on exit."
2. Status line: `exit 0` (with the duration when it's long) at the end, matching python_exec. On failure, keep the code where it's easy to see.
3. Remove "Large output is shortened…" from the description.
4. `cwd` not found: say so in one line, and suggest `mkdir -p` inside the command instead of `cwd`. Creating a missing `cwd` automatically was considered and rejected: the check is a safety boundary, and auto-creation turns typos into stray directories.
5. See [Shell-first models](#shell-first-models).

### python_exec

**Arguments:** `code` / `path` (each says "Exactly one of code or path."), `cwd`, `timeout` ("Seconds, capped."; real default 60, cap 600), `env`.

**Response:** output, then `Process exit code 0.` and `Duration: N ms`. Inline budget is 600 lines / 24 KB (`script_output`).

**Failures:** `Unknown system error -N` 25 times. This needs investigating; it may be a spawn problem on a particular platform.

**Proposals**

- Use the bash footer format.
- Make `timeout` an integer with `default: 60`, and say "capped at 600" in the description. Keep clamping.
- Describe `code`/`path` once at the description level ("Pass `code` or a script `path`.") instead of twice.

### web_search / web_fetch

- **web_search:** the description is just "Search the web."
  - Add the result shape and the default count: "Returns up to `max_results` (default 5) titled snippets with URLs."
  - Result `content` isn't capped per item in the text sent to the model; only `details` is capped. Cap each snippet (about 600 chars) so a single result can't take over the output.
- **web_fetch:**
  - It returns several different response shapes, depending on whether the content was inlined, saved, binary, or large.
  - The current saved shape (`URL / HTTP status / Content-Type / Bytes / Converted / Fetched content: <path> (use read)`) is fine. Add a line count, and in the saved case give an exact `read` hint instead of "(use read)".
  - Document `raw` ("Skip HTML→Markdown").
  - Failures are mostly HTTP 404/403 plus policy denials. No change needed.

### async_bash / launch

- `page.offset` is 0-based (`minimum: 0`), while `read.offset` is 1-based. Paging forward gives `Next offset: N`. Reading from the tail has no hint for earlier lines.
- **Proposals:**
  - Use the common `Next:` hint in both directions (`Earlier: {"offset":N}`). With copyable hints, the 0-based offset no longer matters.
  - State in the launch description that `name` and `runId` are alternatives.

### subagent_prompt / subagent_status / subagent_stop

- **Responses are compact.** Example outputs:
  - `auth-research (explore): created`
  - `auth-research · explore · running · ctx 34% · active 20s ago`
  - `ghost: not found`
- **Naming varies:** `name`, `names`, `assignments[].name`. Not worth a change (see [Considered and dropped](#considered-and-dropped)).
- **Duplicate guidance:** the "completion notices wake you, don't poll" rule appears in both the system prompt (`nerve-system-prompt.ts`) and the `subagent_prompt` description. Keep it in the tool description only, since the rule only applies when the tool is present.

### ask_user / todos_set / todos_get

- **ask_user** has both a question-level `recommendation` (free text) and an option-level `recommended` (boolean). The overlap is real, but agents rarely trip on it. Dropped.
- **ask_user** limits (`questions ≤ 5`, `options ≤ 6`) are already in the schema. That is fine.
- **todos_set** returns the whole list on every write. That is about 330 chars median across 880 calls. Not worth changing.

### plan_present

The description and the param both say "absolute path"; say it once. The snake_case `file_path` stays (no failure evidence).

## Shell-first models

Claude Opus and Sonnet ignore the Bash description's redirect. The data points to batching as the main reason. Of the roughly 14k Claude bash calls since 2026-10-16 that search or read files:

| Pattern                                             | Share |
| --------------------------------------------------- | ----- |
| Mix searches and file reads in one call             | 28%   |
| Run two or more searches                            | 25%   |
| Read two or more files                              | 20%   |
| Single search or read, replaceable by one tool call | ~14%  |

The groups overlap. A Sonnet agent asked to review this proposal gave the same explanation from its side: shell one-liners are habitual, they compose (`rg -l X | xargs rg Y`, `| head`), and one call answers several questions.

Parallel tool calls would give the same batching, and the tools allow them, but nothing asks for them: neither the system prompt nor the tool descriptions mention parallel calls. Assistant messages since 2026-10-16 that call tools contain more than one call 12% of the time for Opus, 18% for Sonnet, 10% for gpt-6.1-sol and 30% for gpt-6-luna.

The pi-ai rename may also contribute. On OAuth connections it gives Claude tools named `Read`/`Grep`/`Edit`/`Write`/`Bash` whose argument shapes differ from Claude Code's (`path` vs `file_path`, no `output_mode`/`-n`/`-A` on `Grep`, `edits[]` vs `old_string`/`new_string` on `Edit`). This can't be tested on the snapshot: stored assistant messages don't record the authentication method, and the analysed home appears to use a single Anthropic connection. Test it with the [benchmark](README.md#validation) by running the same Claude model over OAuth and over an API key. If OAuth shows a clearly higher bash share or failure rate, an adapter at the provider edge (where pi-ai already renames) that maps Claude Code argument names is much cheaper than any new tool.

**Position:** batching through bash isn't a problem worth fighting. It saves round trips and costs about the same tokens, because bash output goes through the process projection. The losses are structural: no paging hints and coarser permission targeting.

Options, cheapest first:

1. **Ask for parallel calls.** One line in the system prompt, always included, saying independent lookups should be made as parallel tool calls in one turn. Nothing asks for this today. Ships in phase 1; its effect shows in production data within days.
2. **Multi-path `read`** (`paths[]`), only if Claude's multi-file `cat`/`sed -n` share hasn't moved after option 1. Parallel `read` calls save the same round trips with no schema change, and `paths` adds another either/or pair to `read`.
3. **Provider-edge argument adapter,** only if an OAuth/API-key comparison shows the rename matters. The comparison is confounded: pi-ai's OAuth mode probably also changes the system prompt identity.
4. **Code mode, scoped to integration tasks that join or filter across calls,** where bash can't reach. Not as a general replacement for bash batching: it needs OS-level isolation, and a model that ignores "use grep, not rg" is unlikely to adopt a new SDK for local search.
5. **Rejected: a more concrete redirect in the Bash description.** Claude already ignores the explicit one.
6. **Rejected: a hint appended to successful bash reads.** It costs tokens on every such call.
7. **Rejected: translating denied commands into equivalent tool calls.** All denials come from read-only mode; stating that reason and the available tools is enough.
8. **Rejected: switching to Claude Code argument names everywhere.** It adds a second naming scheme for all models; the edge adapter in option 3 would cover the case if it matters.

Bash output is the second-largest volume (49.7M chars). Its inline budget is already tight (400 lines / 12 KB); the remaining lever is clearing old output later in the conversation, covered by [old tool output clearing](../old-tool-output-clearing.md).

## Considered and dropped

| Idea                                                        | Why dropped                                                                                                          |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| "Unchanged since your last read" stub                       | 737 identical rereads, 0.8M chars (0.5% of read volume); unsafe after compaction or bash edits                       |
| Auto-create a missing bash `cwd`                            | `cwd` check is a safety boundary; typos would create directories                                                     |
| `id` → `runId`, subagent `name`/`names` unification         | Under 2% of calls, no observed failures, churn in UI argument readers                                                |
| Merge `subagent_status` + `subagent_stop`; fold `todos_get` | Saves a few schema tokens; no behaviour change                                                                       |
| ask_user single recommendation form                         | Overlap is real but not a failure source                                                                             |
| Compact `todos_set` result                                  | About 330 chars median over 880 calls                                                                                |
| More concrete redirect in the Bash description              | Claude already ignores the explicit one                                                                              |
| Claude Code argument names everywhere                       | Second naming scheme for all models; an edge adapter covers it if the rename matters                                 |
| `Next: {"limit":…}` for grep, find, ls                      | The agent projection cap is below the tool limits; raising `limit` resends shown items                               |
| `replaceAll` flag for edit                                  | 7 of 51 ambiguous retries split the edit; the rest added context                                                     |
| Tuned similarity threshold for edit misses                  | 87 misses in two months; the deterministic whitespace match is enough                                                |
| 1-based process log offsets                                 | No failure evidence; copyable `Next:` hints make the base irrelevant                                                 |
| Casing renames `filePath`, `maxResults`                     | No failure evidence; UI argument readers would need to accept both                                                   |
| Schema `maximum` keywords                                   | Arguments are validated against the schema, so a too-large value would become a failed call instead of being clamped |
| Code mode as a general bash replacement                     | Needs OS-level isolation on three platforms for what bash already gives; scoped to integrations instead              |
| Translating denied bash commands into `read`/`grep` calls   | All denials come from read-only mode; the reason and available tools are enough                                      |
| Permission check before the not-found directory listing     | The engine doesn't deny reads by path by default; a denied follow-up is handled like any other                       |
| `keys[]` batch argument for Jira reads                      | `jira_search_issues` with `key in (…)` JQL and `fields` already does it                                              |

## Result-string dependencies

Checked at `6678f0d2c`. The UI renders from `details` and arguments, not from agent text, with one exception. Code that reads result text, and so must change in the same commit as the text:

| Consumer                                                                                           | Depends on                                                                                    | Affected change                                                                                    |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `workbench-app/…/tools/views/tool-result-parser.ts:438`                                            | `/Wrote (\d+) bytes/`, used only when `details.bytes` is missing (older results)              | write success text. Keep the fallback for old transcripts, or accept a missing byte count on them. |
| `tools/src/result-projection/strategies.ts:269`                                                    | Strips the executor's `\nRange: lines …\.$` footer before re-bounding                         | read trailer                                                                                       |
| `tools/src/result-projection/strategies.ts:272`, `:443`, `:481`, `candidate-continuation.ts:45-47` | Produce `Continue with offset=` / `byteOffset=` hints                                         | `Next:` grammar                                                                                    |
| `tools/src/result-projection/projector.ts:165-180`                                                 | Builds the whole error envelope in one place                                                  | error envelope                                                                                     |
| `tools/src/result-projection/process-output.ts:38-48`, `:84-107`                                   | Produces `Status: …; exit code:`, `Process exit code:`, `Lines A-B of N`, `Next offset:`      | exit footer, process paging                                                                        |
| `tools/src/result-projection/user-projection/tool-user-projection.ts:458-472`                      | JSON-parses the executor `content` of `ask_user`, `async_bash`, `launch` (not the agent text) | none, unless executor content changes                                                              |
| `conversation-core/src/conversations/conversation-title.ts:296`                                    | Treats lines starting `exit code:` or `status:` as noise for titles                           | exit footer. Add the new prefix.                                                                   |
| `conversation-core/src/tool-calls/background-promotion.ts:58`                                      | Produces `Started async bash <id>.`                                                           | none                                                                                               |

`core-specs.ts` reads only arguments, not result text. The tests that pin current strings and need updating are `filesystem.test.ts`, `result-projection.test.ts`, `process-output.test.ts`, `bash.test.ts`, `tool-host.adapter.test.ts` and `async-bash.service.test.ts`. The design-lab fixtures (`ToolCardsSection.svelte`, `tool-card-view-fixtures.ts`) contain example strings and should be updated so they stay realistic.

## Open questions

- Does the pi-ai rename on OAuth connections change Claude's tool choice or failure rate? The snapshot doesn't record the authentication method, so this needs the benchmark, and the result is confounded by other OAuth-mode changes (see [Shell-first models](#shell-first-models)).
- How do the providers' strict function-calling modes treat JSON Schema `default`? Some may drop or reject keywords; check before relying on them.
- Out of scope here, for a separate permission-model issue: read-only agents are offered bash and web tools that the `read_only` rule set denies by default, and the explore profile promises web research under that rule set.
- Are the Jira and Confluence executors' `details` complete data, or display-shaped? This matters for code mode.
