# Atlassian code mode

> **Status:** Proposal. An experimental tool that runs alongside the existing Jira and Confluence tools. Replaces the earlier agent tool interface and TypeScript execution environment proposals.

## Summary

`atlassian_code_mode` is a single tool. The agent writes a short TypeScript script against a Jira and Confluence SDK and a few data libraries. The script runs in an embedded QuickJS sandbox that has no filesystem, network or process access. Every external effect goes through host functions, and each one gets the same permission check and approval prompt as a direct tool call.

The tool can be switched on in tool settings independently of the 28 existing `jira_*` and `confluence_*` tools, so both can be tried by hand. When the experiment ends, the losing interface is removed.

## Why

- **The tool surface is large.** There are 28 tools (17 Jira, 11 Confluence) with about 16k characters of definitions (Jira 9.9k, Confluence 6.3k), plus two guides of about 4.8k characters each. Every request pays the definition cost while the integration is enabled.
- **Usage is low and narrow.** In one production home over two months (2026-09-14 → 2026-11-10) there were 24 Jira calls in 6 conversations and no Confluence calls. One tool with a short description and on-demand reference costs much less than 28 tools.
- **Real work is multi-step.** Examples: "for each open bug in this sprint, find its runbook page", "turn this Excel sheet into a Confluence page with a table and a diagram", "move every unassigned issue in the backlog to the next sprint". Today each of these is a chain of tool calls, and every intermediate result passes through the model's context.
- **Models write code well against typed APIs.** One script can loop, filter and join, then print only the answer.

## Non-goals

- Replacing `bash`, `python_exec` or local file tools. `python_exec` is not a security boundary (`execution/python/python.ts`); this sandbox is, which is why integration calls and their credentials can live here.
- General package installation, network access from scripts, or saved scripts and artifacts directories. These were the core of the earlier TypeScript execution environment proposal, and they need an OS-level sandbox.
- Database schema changes.

## Tool

```ts
atlassian_code_mode({
  code: string,       // TypeScript, ESM, top-level await
  timeout?: integer,  // seconds, default 120, capped at 600
})
```

- The code is passed inline, not as a file path. Writing a file and then running it would cost an extra round trip.
- The result is the script's printed output, then one footer line:

  ```text
  <console output>
  jira 14 calls (issues.search 1, issues.get 12, issues.transition 1) · 1 approval · exit 0 · 4.2s
  ```

- A thrown error prints the message, the script line, and the stack trimmed to script frames. Calls that already finished are listed in the footer, because their effects are not undone.
- Printed output uses the existing `script_output` projection budget.

## SDK

### Design rules

The SDK follows the Jira and Confluence REST APIs, so models can rely on what they already know: resource names, JQL, CQL, IDs and keys. It changes the parts that cost tokens or cause errors:

- **Values filled in automatically.** These include the site URL, cloud ID, API version (Jira platform vs agile, Confluence v1 vs v2), authentication and `defaultProjectKey`. Pagination becomes async iterators with a `limit`. The page version is bumped on Confluence updates, and on Jira creates the `fields` wrapper is added.
- **Names instead of IDs where the API is awkward.** Custom fields can be addressed by name, transitions by status name, users by email or display name, and spaces by key. These already exist in `jira/field-resolution.ts`, `jira/transitions.ts`, `maybeResolveAssignee` and `confluence/space-resolution.ts`.
- **Jira text is Markdown in and out.** Descriptions and comments come back as Markdown converted from ADF (`jira/adf-markdown.ts`).
- **Confluence pages are written in storage format.** Builders produce the markup, a linter checks it before each write, and Markdown is used only for prose. See [Confluence pages](#confluence-pages). Page bodies can be read as Markdown or storage format.
- **Compact, flattened results.** For example `{ key, summary, status, assignee: { name, email }, updated, … }`, not `fields.status.statusCategory.…`. `fields: [...]` selects what comes back, and `raw: true` returns the unmodified REST object when something is missing.
- **Complete data.** Results are not truncated or shaped for display. Large text is the script's to filter, not the SDK's to cut.

### Shape

```ts
// Jira
jira.issues.search({ jql, fields?, limit? })        // AsyncIterable<Issue>
jira.issues.get(key, { fields?, expand? })          // comments, changelog, worklogs, links
jira.issues.create({ project?, type, summary, description?, fields? })
jira.issues.update(key, { fields })
jira.issues.transition(key, { to: "In Review", comment?, fields? })
jira.comments.list | add | update | delete
jira.worklogs.*, jira.links.*, jira.attachments.list | download | upload
jira.projects.get(key)                              // statuses, components, versions, link types
jira.users.search(query)
jira.boards.search | get, jira.sprints.get | issues | create | update | move
jira.backlog.move(issueKeys, { rank? })

// Confluence
confluence.search({ cql, limit? })
confluence.spaces.search | get
confluence.pages.get(id | { space, title }, { body?: "markdown" | "storage", children?, comments?, versions? })
confluence.pages.create({ space, title, parent?, body, format? })
confluence.pages.update(id, { title?, body?, format?, message? })
confluence.pages.move | delete
confluence.comments.*, confluence.labels.*, confluence.restrictions.*, confluence.attachments.*
```

This covers what the 28 tools do today. The `request()` escape hatch is an [open question](#open-questions).

### Documentation

- The tool description is about 400 characters long. It covers what the tool is, the two rules that cause most failures (print with `console.log` instead of using `return`; JQL must include a restriction), and a pointer to the guide.
- The built-in guide skill `atlassian-code-mode` (`packages/skills/src/guides/atlassian-code-mode/`) has a short `SKILL.md` and reference files the agent reads on demand: `jira.md`, `confluence.md` (including page style and linter rules) and `storage.md` (builders).
- `formatToolGuides` in `nerve-system-prompt.ts` adds the guide line when `atlassian_code_mode` is active.
- A drift test (`guide-coverage.test.ts`) fails when the method tables and the reference files disagree in either direction.

## Libraries and helpers

The engine runs only the script and small pure-JS helpers. Data-heavy work runs on the host as Rust or TS host functions with byte and row caps, so large data is not serialised through the interpreter.

| Need                                   | v1                                                                                                             | Runs in       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------- |
| CSV parse/write                        | papaparse                                                                                                      | sandbox       |
| Excel read                             | `calamine`                                                                                                     | host (Rust)   |
| Excel write                            | `rust_xlsxwriter`                                                                                              | host (Rust)   |
| Confluence storage builder             | in-house: tables, headings, panels and status, code, expand, toc, Jira issue macro, links, images, attachments | sandbox       |
| Markdown → ADF / storage               | in-house, grown from `jira/adf.ts` `textToAdf`; `marked` for tokenising if needed                              | sandbox       |
| Storage → Markdown                     | existing `isolatedHtmlToMarkdown` worker                                                                       | host          |
| Diagrams (Mermaid, PlantUML, D2, …)    | existing Kroki executor as `diagram.render({ type, source, format })`, output usable as a page attachment      | host, network |
| Workspace files (Excel in, report out) | `files.read(path)` / `files.write(path, data)`, checked as `read` and `write` calls                            | host          |

Later, each only when a task needs it: DuckDB (host-side, `enable_external_access=false`; tens of MB per platform), Arquero for dataframe work, chart rendering (Vega-Lite through Kroki), SheetJS (after its licence and distribution have been checked).

Kroki sends diagram source to the configured Kroki server, so `diagram.render` keeps the `kroki_export` risk and permission behaviour.

## Confluence pages

Confluence Cloud stores pages as ADF (JSON). The REST API also accepts storage format: XHTML with `ac:`/`ri:` macros, which Confluence converts to ADF on save. Markdown cannot express panels, status lozenges, layouts, image sizing or column widths, so it is only a convenience for prose.

We write storage format, not ADF. Models write XHTML far more reliably than ADF's verbose JSON, it costs fewer tokens, and Confluence converts it losslessly for everything the builders produce.

- **Builders** (`storage.*`, pure JS in the sandbox):
  - Text and structure: headings, paragraphs, links, dates, mentions, task lists, layouts.
  - Tables, with column widths.
  - Panels. Their types use the Cloud UI names: info, note, success, warning (yellow) and error (red).
  - Macros: status, table of contents, expand, code, single Jira issue, Jira issue list (with columns and width).
  - Images: attachment images.
  - Markdown for prose.
- **Linter** (`confluence/page-lint.ts`). It runs on every create and update. Malformed XML is rejected before any request. It applies safe fixes and reports them as `fixes`; everything else comes back as `warnings` in the method result, for the script to print or act on.
  - **Fixed automatically:**
    - headings are promoted so sections start at H1, because the page title is a separate field;
    - an opening H1 that repeats the title is removed;
    - a table of contents is added when there are at least 3 sections or about 600 words (`toc: false` opts out);
    - tables without widths get column widths sized to their content;
    - images are sized to at most the content width;
    - stray inline content at block level is wrapped in a paragraph;
    - Jira list macros get the default layout width.
  - **Warnings:**
    - skipped heading levels;
    - a panel whose title repeats the heading above it;
    - a heading that only repeats an embedded issue key;
    - empty sections;
    - SVG or WebP images;
    - explicit column widths too narrow for their longest word;
    - images scaled below 80%.
- **Attachments and diagrams:**
  - `confluence.attachments.upload`, and `attachments` on create/update. A workspace file is authorized as `read` as well.
  - GIF and WebP are converted to PNG with the native image module, and SVG is rejected.
  - `diagram.render` renders through Kroki to PNG, authorized as `kroki_export`. Its bytes stay on the host behind a handle.
  - Creating a page with attachments takes three requests: create, upload, then save again so `ri:attachment` references resolve.

**Live findings** (Confluence Cloud test site, Haiku 5.5, same prompt each time):

| Page     | Change                   | Result                                                                                                                                                                                                                           |
| -------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| baseline | Markdown-first SDK       | All sections H2, no TOC on 8 sections, equal-width columns, heading repeated as panel title, neutral note in a warning panel, no images                                                                                          |
| v2       | Storage-first and linter | H1/H2 structure, TOC added by the linter, column widths applied, diagram sized to 760 px. Jira list macros rendered at 1,761 px with wrong columns (`columns` separated by commas instead of semicolons); `warning` rendered red |
| v3       | Macro and panel fixes    | Lists at 760 px with the requested columns (`data-layout="default"` honoured), panel colours correct, no empty lists, pluralised counts. Remaining: an explicit 90 px Key column wrapped; a 1,100 px diagram scaled to 69%       |

Verified on the live site: the default content width is 760 px. The `wide` (960 px) and `full-width` (1,800 px) values are unverified.

## Runtime

**Engine:** QuickJS embedded through [`rquickjs`](https://github.com/DelSkayn/rquickjs) (0.14.0, MIT, actively released) in a new `sandbox` domain of `packages/native`.

- A context exposes only what we bind. There is no `std`/`os` module, filesystem, network, timers or `eval` of host code.
- Each script gets a fresh runtime on a dedicated native thread, so it never runs on the Node event loop.
- The runtime memory limit gives a hard cap (for example 256 MiB). An interrupt handler checks the deadline and a cancel token, so a busy loop stops promptly.
- Host functions are async. A call crosses to TS through a threadsafe function and resolves the script's promise, even after a long wait for approval.
- TypeScript is stripped in TS with Node's built-in `module.stripTypeScriptTypes`, which adds no dependency. On Node 24.21 it still emits an `ExperimentalWarning` and its options changed in Node 26; if that churn matters, `oxc` in Rust is the replacement. Features that need a transform, such as `enum`, fail before the script starts.
- Helper libraries are compiled to QuickJS bytecode once at build time and loaded per run.
- Calamine and rust_xlsxwriter live in the same domain, so workbook data can stay in Rust and pass to the script as rows only when asked.

**Why native instead of `quickjs-emscripten`:** native cancellation and memory limits, no asyncify cost, and Rust data libraries without a WASM boundary. `packages/native/AGENTS.md` limits native code to CPU-heavy kernels and OS primitives. A sandbox engine is an isolation primitive, but this exception needs explicit agreement. The cost is a few MB per prebuild target, on all six targets.

**Fallback:** `quickjs-emscripten` 0.32.0 (MIT, asyncify variant) in a worker thread, terminated on deadline. The SDK, host functions and records are the same, and only the engine adapter changes.

QuickJS does not JIT, so plain JS loops over 100k rows are slow. The guide says to push filtering into JQL and CQL and to do bulk data work in host functions.

## Proof of concept

Branch `poc/atlassian-code-mode`: a `sandbox` domain in `packages/native` (`native/src/sandbox/`, `src/sandbox/`) with no tool wiring.

- **Engine:** `rquickjs` 0.14.0, which bundles quickjs-ng. Each script gets a fresh `Runtime` and `Context::full` on its own thread. A small host loop drives the job queue and blocks on a channel for host replies, so no async executor is needed.
- **Bridge:** `__hostCall(method, json)` returns a promise. The request reaches TS through a threadsafe function, and `reply(id, ok, json)` settles it, however long TS takes. A base prelude provides `console.*` and `host.call()` and removes the raw globals.
- **Verified by tests** (10 Rust, 4 through N-API):
  - top-level await over parallel host calls;
  - host rejection surfacing as a catchable `HostError`;
  - uncaught errors reported with their stack;
  - a busy loop stopped at the deadline;
  - a host wait stopped at the deadline;
  - abort while waiting on the host;
  - the memory cap;
  - the host-call cap and output cap;
  - a promise that can never settle failing fast;
  - no `require`/`process`/`fetch`/`setTimeout`/`std`/`os` globals;
  - TypeScript stripping, and rejection of `enum`.
- **Measured on Linux x64 (Node 24.21, release build):**

  | Measure                                                             | Result                                     |
  | ------------------------------------------------------------------- | ------------------------------------------ |
  | Empty script, start to result (p50)                                 | 0.33 ms                                    |
  | With papaparse (19 KB) as a prelude (p50)                           | 1.8 ms                                     |
  | One host round trip (p50)                                           | 0.43 ms                                    |
  | 4.6 MB CSV (100k rows): transfer / papaparse parse / group-and-sort | 19 ms / 794 ms / 10 ms (Node: 95 ms parse) |
  | Script heap after the CSV run                                       | 45 MB                                      |
  | Addon size, linux-x64                                               | 15.37 → 16.94 MB (+1.57 MB)                |

- **Findings:**
  - QuickJS reports some out-of-memory failures as a bare `null` exception, so the runtime classifies a failure as `memory_limit` from usage near the cap.
  - Parsing in QuickJS is about 8× slower than in Node, which is fine at this size. That supports keeping Excel and large data host-side.
- **Cross-platform:** CI on PR #568 built the addon and ran the native tests, including the sandbox tests, on Linux, Windows and macOS. All passed.
- **Tool:**
  - `atlassian_code_mode` with Jira reads (`issues.search/get`, `projects.get`, `users.search`, `fields.list`).
  - Confluence reads and writes (spaces, page search/get/create/update, labels, comments, attachments).
  - `diagram.render`, the storage builders and the page linter.
  - The permission broker (see [Permissions and approvals](#permissions-and-approvals)), a tool-settings toggle and a tool card.
- **Tested against a live Jira and Confluence Cloud site:** see [Confluence pages](#confluence-pages).
- **Enablement enforced:** a model call to a tool its request did not offer now fails without running. Before this change, turning a tool off only removed it from the list sent to the model.
- **Not yet verified:**
  - Jira writes, which are not built yet.
  - Approvals inside a script.
  - Precompiling helper bytecode.
  - Excel host functions.
  - The `wide` and `full-width` content widths.

## Permissions and approvals

The executors do no permission checks; policy runs before dispatch in `scoped-permission-source.ts`. Every host call therefore goes through a broker:

1. Each SDK method declares its group (`jira`/`confluence`), its risk (`read`, `write`, `destructive`) and its target (issue key, project, space, page ID, file path).
2. The broker evaluates the conversation's policy for that operation, as it does for a direct call. `files.*` is evaluated as the matching `read` or `write` call, and `diagram.render` as `kroki_export`.
3. On `prompt`, the outer tool call moves to `awaiting_approval` with an interaction that describes the nested operation. The script waits on its pending promise. Approving resolves it; denying rejects it with the one-line denial reason.
4. Cancelling the outer call kills the runtime and aborts in-flight host calls. Calls that already finished stay in the record, and none of them are undone.
5. After a daemon restart the runtime is gone. The outer call settles as `indeterminate`, listing the nested calls that finished, and is never replayed.

**Finding (POC):** approval is a gate before dispatch, not something a running call can ask for. In `ToolCallService.process` (`conversation-core/src/tool-calls/tool-call.service.ts`), an `approval` decision sets the row to `awaiting_approval` with an `approval` interaction and returns. Resolving the interaction runs admission again from the start and only then dispatches. Once a call is `running`, nothing lets it raise an interaction and wait in memory. Nested approvals therefore need one of:

1. **Interaction on a running call.** The row stays `running` (or gets a new waiting state) with a nested `approval` interaction in the existing JSON `interaction` field. An in-memory resolver settles the script's pending promise. After a restart the call settles as `indeterminate`. This needs a state machine change in conversation-core, but no table or column.
2. **Up-front grant.** The outer call's approval shows the script, and approving it allows the nested calls that rule would prompt for, for that run only. This is simple, but the user approves code rather than concrete operations.
3. **Two runs.** The first run records intended writes without performing them and returns them. The user approves the list, and a second run performs exactly those writes. This avoids pausing a script, but it doubles the reads and breaks scripts whose writes depend on earlier writes.

The POC slice is read-only and uses neither: the broker (`workbench-server/src/core-host/code-mode-broker.ts`) evaluates every SDK call through `createExecutionAdmission` as the equivalent direct tool. `allow` proceeds, `deny` rejects with the reason, and `approval` is refused with its reason as "code mode cannot request approval yet".

Rule granularity: policies today target Jira and Confluence with `whole_tool`. Matching on the operation name (`jira.issues.transition`) and its target is a natural extension of the same rule language. See [open questions](#open-questions).

## Records and UI

- Nested calls are recorded in the outer result's `details`: operation, a summary of the arguments, outcome, duration and result size. They are not separate rows.
- The tool card shows the script (collapsed), the printed output, and a list of nested calls with their outcome. Later, Jira and Confluence nested calls can reuse `JiraIssueCard` and `AtlassianResultSurface` for the entities they touched.
- Files written by `files.write` and diagrams render as they do for `write` and `kroki_export`.

## Enablement

- Add `atlassian_code_mode` to `capabilityToggleToolNameSchema`. `scoped-turn-resources.ts` treats unknown names as enabled, so without this the tool would always be on.
- The tool is off by default (`{ enabled: false }` in the built-in defaults). In complete settings the entry is optional, so child settings frozen by earlier releases still validate, and a missing entry means off. No data migration is needed.
- It uses its own Atlassian account selection (`tools.atlassian_code_mode.profileId`) for both products.
- It needs a configured Jira or Confluence connection. The SDK exposes only the namespaces whose connection exists, and a missing connection fails on first use with the existing `*_NOT_CONFIGURED` message.
- It can be enabled alone or together with the 28 tools. Both together is allowed for manual comparison. The guide tells the agent to prefer code mode when both are present.

## Experiment

1. **Manual:** the user enables code mode alone on real projects and compares it with the tools.
2. **Benchmark:** a fixed set of tasks against a test Atlassian site, each with a written success check:
   - single lookups;
   - cross-call joins and filters;
   - bulk updates with approvals;
   - Excel to Confluence page with a diagram;
   - an edit with a known pitfall (custom field by name, transition with a required field).

   Run each task five times per model family (Claude, GPT) with code mode alone and with the tools alone. Report success rate, turns, total tokens (including the definition cost on every request) and approvals.

3. **Decision:** keep whichever interface wins clearly on at least one model family without losing on the other, and delete the other one, including its executors' display layer where it is no longer used.

## Delivery

1. Spike: done on Linux, Windows and macOS (see [Proof of concept](#proof-of-concept)).
2. Broker and nested approvals on the existing tool-call lifecycle, with read-only SDK methods first.
3. Jira and Confluence SDK (read, then write), with generated documentation and the guide skill.
4. Helpers: storage builder, Markdown → ADF/storage, CSV, Excel, `files.*`, `diagram.render`.
5. Tool card and records.
6. Benchmark and decision.

## Open questions

- **Nested approvals:** does the current interaction model support several sequential approvals inside one running call without schema changes?
- **Rule granularity:** should rules match SDK operations and targets, or only group and risk, as today?
- **Raw escape hatch:** should there be `jira.request(method, path, body?)` / `confluence.request(…)`, with GET treated as `read` and every other method as `write`? It removes coverage gaps but makes targets opaque. Proposed: leave it out of v1, and add it only if benchmark tasks hit SDK gaps.
- **Native exception:** is adding the sandbox engine (and calamine/xlsxwriter) to `packages/native` acceptable, given its "measured CPU kernels and OS primitives" rule and the per-target size?
- **Coexistence:** when both interfaces are enabled, does the agent pick code mode reliably, or should enabling one hide the other?
- **Generalisation:** the runtime, broker and records don't depend on Atlassian. If the experiment succeeds, should other integrations (web, future services) get SDK namespaces in the same tool?
