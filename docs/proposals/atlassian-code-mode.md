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
- General package installation, network access from scripts, or saved scripts. These were the core of the earlier TypeScript execution environment proposal, and they need an OS-level sandbox. Scripts get a fixed set of bundled libraries and a per-conversation artifact folder instead (see [Artifacts](#artifacts)).
- Database schema changes.

## Tool

```ts
atlassian_code_mode({
  code: string,       // TypeScript, ESM, top-level await
  timeout?: integer,  // seconds, default 120, capped at 600
})
```

- The code is passed inline, not as a file path. Writing a file and then running it would cost an extra round trip.
- A top-level `return value` prints the value compactly: an array of flat objects prints as a table, anything else as JSON. `console.log` still works.
- The result is the script's printed output, then the linter report for every page written, the artifacts created, and one footer line:

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
- **One calling convention.** Every method takes a single ID or one options object. Each resource has one ID name (`key` for issues, `id` for pages), without aliases, so the reference stays short.
- **Consistent verbs.** Each resource uses `search`/`get`/`create`/`update`/`delete`; workflow actions (`issues.transition`, `issues.comment`) are the exceptions.
- **Actionable errors.** An invalid value lists the valid ones, for example "No transition to 'Done' from 'Backlog'; available: In Progress, Selected for Development".
- **Stop on the first auth failure.** A 401 or 403 ends the whole script with one message ("Jira token is invalid", "no access to project APP") instead of failing every call in a loop.
- **Raw requests.** `jira.request(method, path, body?)` and `confluence.request(…)` cover everything the curated methods do not, so the SDK stays small without losing capabilities. `GET` is checked as a read and any other method as `destructive`.

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

This covers what the 28 tools do today. Jira workflow discovery also needs issue types with their create fields, workflows and transitions, boards, sprints, versions (releases) and components.

### Documentation

- The tool description is about 400 characters long. It covers what the tool is, the rule that causes most failures (JQL must include a restriction), and a pointer to the guide.
- The built-in guide skill `atlassian-code-mode` (`packages/skills/src/guides/atlassian-code-mode/`) has a short `SKILL.md` (globals, the rules that cause most failures, and a "read X when Y" table) and reference files the agent reads on demand:

  | File                               | Covers                                                                                                                     |
  | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
  | `references/sdk.d.ts`              | Every SDK method with request and response types, generated from the method tables                                         |
  | `references/files.md`              | Artifacts, workspace files, supported types (PNG/JPEG, CSV, XLSX, diagrams), the bundled libraries and limits              |
  | `references/confluence-writing.md` | Writing pages people can read: structure, headings, TOC, tables, panels, images, diagrams; the linter's fixes and warnings |
  | `references/storage.md`            | The `storage.*` builders                                                                                                   |
  | `references/jira-workflows.md`     | Discovering a project's conventions, then creating and updating tickets that follow them                                   |
  | `references/project-knowledge.md`  | Saving discovered conventions as a project skill                                                                           |

- `jira-workflows.md` describes a discovery pass: sample recent tickets per issue type; read workflows and transitions, epics, sprints, fix versions and releases, components, labels and required custom fields; summarise the conventions; confirm them with the user; then create or update tickets that follow them.
- `project-knowledge.md` tells the agent to offer to save those conventions with the built-in `skill-creator` skill, recommending the project-level `./.nerve/skills/<name>/`, and to write only after the user agrees. Later conversations read that skill instead of exploring again.
- `formatToolGuides` in `nerve-system-prompt.ts` adds the guide line when `atlassian_code_mode` is active.
- The type definitions are generated from the method tables, and a test fails when the committed `sdk.d.ts` is out of date, so the reference cannot drift.

## Libraries and helpers

**Rule:** prefer a well-known JavaScript library that runs inside the sandbox over a custom API. Agents already know `XLSX.read` and `Papa.parse`; a custom Excel SDK would be one more thing to document and get wrong. Host functions are used only where nothing well known runs in QuickJS, or where the work needs the network or native code.

| Need                                | Library                                                                                                                 | Runs in       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------- |
| Excel read/write                    | SheetJS CE (`XLSX`, Apache-2.0; its docs test it on QuickJS-NG), from the SheetJS CDN tarball, not the stale npm 0.18   | sandbox       |
| CSV parse/write                     | Papa Parse (`Papa`, MIT)                                                                                                | sandbox       |
| Confluence storage builders         | in-house `storage.*`                                                                                                    | sandbox       |
| Markdown → storage                  | the in-house converter, bundled into the sandbox so `storage.markdown()` returns real markup                            | sandbox       |
| Storage → Markdown                  | existing `isolatedHtmlToMarkdown` worker                                                                                | host          |
| Images (info, resize, crop, format) | a small `sharp`-style chain (`image(file).resize({ width: 760 }).png().save("name.png")`) over the native `image` crate | host (Rust)   |
| Diagrams (Mermaid, PlantUML, D2, …) | existing Kroki executor as `diagram.render({ type, source })`                                                           | host, network |
| Files                               | `files.read/write/list` over [artifacts](#artifacts) and the workspace                                                  | host          |

- Libraries are bundled at build time and evaluated lazily: `XLSX` and `Papa` are globals that load on first use, so scripts that do not need them pay nothing.
- Binary data crosses into the sandbox as `Uint8Array` (base64 on the JSON bridge) up to a size cap. Images never cross: image operations take and return file handles.
- QuickJS does not JIT, so very large sheets are slow. The guide says to filter early and keep sheets to tens of thousands of rows.

Later, each only when a task needs it: DuckDB (host-side, tens of MB per platform), Arquero for dataframe work, chart rendering (Vega-Lite through Kroki).

Kroki sends diagram source to the configured Kroki server, so `diagram.render` keeps the `kroki_export` risk and permission behaviour.

## Artifacts

Files a script produces (rendered diagrams, edited images, generated CSV and Excel files) live in one folder per conversation: `$NERVE_HOME/data/conversations/<id>/code-mode/`.

- Scripts refer to them by name (`artifact:status.png`), never by host path. `files.read`, `diagram.render`, `image(...)`, `confluence.attachments.upload` and page `attachments` all accept the same file handle, whether it names an artifact or a workspace file.
- Because the folder is per conversation, one script can render a diagram and a later one can upload it.
- Reading a workspace file is checked as a `read` call. `files.write` writes only artifacts; copying into the workspace is explicit (`files.write("./out/report.xlsx", data, { workspace: true })`) and checked as a `write` call.
- Each result lists the artifacts the run created, and the tool card shows them.
- Deleting the conversation deletes the folder (`deleteConversationFiles` already removes the conversation directory). Forking copies it.

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

**Why native instead of `quickjs-emscripten`:** native cancellation and memory limits, no asyncify cost, and native image processing without a WASM boundary. `packages/native/AGENTS.md` limits native code to CPU-heavy kernels and OS primitives. A sandbox engine is an isolation primitive, but this exception needs explicit agreement. The cost is a few MB per prebuild target, on all six targets.

**Fallback:** `quickjs-emscripten` 0.32.0 (MIT, asyncify variant) in a worker thread, terminated on deadline. The SDK, host functions and records are the same, and only the engine adapter changes.

QuickJS does not JIT, so plain JS loops over 100k rows are slow. The guide says to push filtering into JQL and CQL.

## Proof of concept

Branch `feat/atlassian-code-mode` (then `poc/atlassian-code-mode`): a `sandbox` domain in `packages/native` (`native/src/sandbox/`, `src/sandbox/`) with no tool wiring.

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
- **Cross-platform:** CI on PR #568 (now #569) built the addon and ran the native tests, including the sandbox tests, on Linux, Windows and macOS. All passed.
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
  - Excel and CSV libraries in the sandbox.
  - The `wide` and `full-width` content widths.

## Permissions and approvals

The script is approved as a whole, the way `bash` and `python_exec` commands are. The permission engine and rule model stay as they are; only the code-mode tool's risk becomes dynamic.

1. **Classify the script.** Before admission, Nerve scans the script for SDK calls (`jira.issues.create(`, `confluence.pages.update(`, `files.write(`, `jira.request("POST"`, …). The script's risk is the highest risk among them: reads only → `read`; any write → `workspace_write`-level write; deletes, a non-GET `request()` or a computed method name → `destructive`. Its targets (projects, spaces, page IDs, workspace paths) are collected where they are literals.
2. **Use the risk for rule matching.** `atlassian_code_mode` gets a `classifyRisk` and joins `async_bash` and `launch` as tools whose per-call risk feeds rule matching (`permission-policy.ts` `requestMetadata`). Existing rules such as "allow read" or "prompt on destructive" then apply unchanged.
3. **One approval.** When a rule prompts, the approval shows the script and the operations found ("creates Jira issues in APP; updates Confluence page 98506"). Approving runs the script.
4. **Runtime ceiling.** Scanning text can be fooled (`const j = jira; j["issues"]["create"]`). The broker (`code-mode-broker.ts`) therefore still checks every SDK call: a call whose risk exceeds the approved classification is refused, and deny rules apply to every call as they do today.
5. Cancelling the call kills the runtime and aborts in-flight host calls. Calls that already finished stay in the record and are not undone. After a daemon restart the call settles as `indeterminate` and is never replayed.

This needs no conversation-core state change and no database change.

**Alternatives considered:** pausing the running script for each nested approval (needs a new waiting state in conversation-core), and a preview run followed by an apply run (doubles reads and breaks writes that depend on earlier writes).

Rule granularity: policies today target Jira and Confluence with `whole_tool`. Matching on the operation name (`jira.issues.transition`) and its target is a natural extension of the same rule language. See [open questions](#open-questions).

## Records and UI

- Nested calls are recorded in the outer result's `details`: operation, a summary of the arguments, outcome, duration and result size. They are not separate rows.
- The tool card shows the script (collapsed), the printed output, and a list of nested calls with their outcome. Later, Jira and Confluence nested calls can reuse `JiraIssueCard` and `AtlassianResultSurface` for the entities they touched.
- Artifacts the run created are listed with previews for images, as `python_exec` artifacts are.

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
2. Broker, read-only Jira SDK, Confluence SDK with builders, linter, attachments and diagrams: done (PR #569).
3. **Simplify the SDK and runtime:** one calling convention, auth short-circuit, `return` printing, automatic lint and artifact report, bundled Markdown converter, `request()`, per-conversation artifacts and `files.*`, `image(...)`, lazily loaded SheetJS and Papa Parse.
4. **Guide skill reorganisation:** generated `sdk.d.ts`, plus the reference files listed in [Documentation](#documentation).
5. **Jira writes and discovery methods:** issues, comments, transitions, links, worklogs, attachments; issue types and create fields, workflows, boards, sprints, versions, components.
6. **Approvals:** script classification, dynamic risk and the runtime ceiling.
7. Benchmark and decision.

## Open questions

- **Rule granularity:** should rules match SDK operations and targets, or only group and risk, as today?
- **Native exception:** is adding the sandbox engine to `packages/native` acceptable, given its "measured CPU kernels and OS primitives" rule and the per-target size?
- **Coexistence:** when both interfaces are enabled, does the agent pick code mode reliably, or should enabling one hide the other?
- **Generalisation:** the runtime, broker and records don't depend on Atlassian. If the experiment succeeds, should other integrations (web, future services) get SDK namespaces in the same tool?
