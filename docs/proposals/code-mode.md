# Code mode: `quick_script`

> **Status:** Proposal. Atlassian code mode is implemented as the experimental `atlassian_code_mode` tool (off by default; PRs #569, #571, not yet released). This proposal generalises it into `quick_script` an integration and utility runtime, and plans the removal of the 28 direct `jira_*` / `confluence_*` tools. How the implemented tool works: [architecture/code-mode.md](../architecture/code-mode.md).

## Summary

`quick_script` runs a short agent-written TypeScript script in the embedded QuickJS sandbox. The script gets typed SDK namespaces for integrations (Jira and Confluence today, the web next) and well-known libraries for document work (xlsx, csv, docx, pptx, images, diagrams). One script loops, filters and joins, and only its output reaches the model's context. Every external effect is a host call with the same permission check as a direct tool call.

## Why

- **The tool already outgrew its name.** `files`, `image`, `diagram`, `XLSX` and `Papa` have nothing to do with Atlassian. An Excel-to-chart task should not need an Atlassian connection or an Atlassian-named tool.
- **Atlassian coupling is incidental.** Today the tool sits in the `jira` permission group, has a single Atlassian account picker, describes only Jira and Confluence, and needs an Atlassian connection to be useful. The runtime, permission broker and run records are already integration-neutral.
- **Integrations become namespaces, not tools.** Each new service adds a namespace and a reference file instead of a set of tool definitions that every request pays for.
- **Direct tools duplicate the SDK.** Field use showed code mode covers the direct tools once the field-report gaps were closed (#571). Keeping both costs tokens on every request and splits agent behaviour.

## Positioning

| Tool           | Use for                                                                                        | Runs                                         |
| -------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `quick_script` | Integrations (Jira, Confluence, web) and document utilities; getting multi-step work done fast | Sandboxed TypeScript; effects via host calls |
| `python_exec`  | General Python scripting with pure Python                                                      | Local Python; not a security boundary        |
| `bash`         | The local machine: builds, git, processes                                                      | Local shell                                  |

The descriptions carry this split; the guide repeats it in one line.

## Name

`quick_script` is chosen to feel like scripting and to avoid a false runtime expectation. Rejected: `tsx` and `deno` (agents expect Node or Deno APIs, `fetch`, imports, JSX), `code_mode` (says nothing about when to choose it), `macro` (clashes with Confluence macros), `sdk` and `integrations` (hide the file utilities). Whatever the name, the description's first line states "Sandboxed TypeScript (no Node APIs, imports or JSX)" and lists the active globals; `import`, `require` and JSX fail with an error naming the alternative.

The rename is free while the tool is unreleased: no settings, rules or stored calls use the old name.

## Namespaces

Each integration is a self-contained namespace module:

- a method table (the single source for dispatch, the risk scan and the generated `.d.ts`);
- its connection and account selection;
- a guide reference (`<namespace>.d.ts`, plus a workflow file when the domain needs one).

A namespace is exposed only when it is enabled and its account is configured ([settings](#settings)); utilities are always present. A call into an unconfigured namespace fails with the existing `*_NOT_CONFIGURED` message.

| Namespace                              | Status                                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `atlassian`, `jira`, `confluence`      | Implemented                                                                                                       |
| `files`, `image`, `diagram`, `storage` | Implemented utilities                                                                                             |
| `web` (`fetch`, `search`)              | Next: host calls authorized as `web_fetch` / `web_search`; existing web policy applies until operation rules land |

### Namespace design rules

These held up in the Atlassian SDK and apply to every namespace:

- **Follow the service's own API vocabulary** (resource names, query languages, IDs) so models reuse what they know; fill in site, version, auth and pagination.
- **Names instead of awkward IDs** where the API makes them painful (custom fields, transitions, users, spaces).
- **One calling convention:** a bare ID or one options object; one ID name per resource; no aliases.
- **Compact, complete results:** flattened, never truncated for display; `raw: true` when something is missing.
- **Actionable errors** that list the valid values, with a closed `e.code` set; a 401 ends the run.
- **A raw `request()` escape hatch** plus a recipes reference, so the typed surface stays small. Promote a recipe to a method only when agents keep getting it wrong.
- **Writes report what they created** (`Created:` footer line) and protect user content (stale-version `CONFLICT`, lossy-update guard on Confluence pages).

## Libraries

Rule: prefer a well-known JavaScript library that runs inside the sandbox over a custom API; agents already know `XLSX.read` and `Papa.parse`. Host functions only where nothing runs in QuickJS or the work needs the network or native code. Libraries load lazily on first mention.

| Need              | Library                                  | Status                              |
| ----------------- | ---------------------------------------- | ----------------------------------- |
| Excel, CSV        | SheetJS CE (`XLSX`), Papa Parse (`Papa`) | Implemented                         |
| Images, diagrams  | native `image(...)` chain, Kroki         | Implemented (host)                  |
| Word write / read | `docx` / `mammoth`                       | Proposed; verify on QuickJS (JSZip) |
| PowerPoint write  | `pptxgenjs`                              | Proposed; verify on QuickJS         |
| PowerPoint read   | none well known; JSZip + slide XML text  | Open                                |

Each new library needs: a QuickJS run test, its bundle size, and a short section in `files.md`.

## Tool description

Built per conversation from a fixed template plus one fragment per active capability, in a fixed order. `scoped-turn-resources.ts` already rewrites descriptions per turn. The text changes only when settings change, like toggling any tool, so the prompt cache holds. With everything enabled (about 650 characters):

```text
Run a sandboxed TypeScript script: no Node APIs, imports, JSX, network or filesystem; only the globals below. Use it for integration work and document/data tasks, especially multi-step ones — one script loops, filters and joins, and only its output returns. Use python_exec for general Python, bash for the local machine.
Integrations: jira (bounded JQL, e.g. `project = X`), confluence (page bodies are storage XHTML), web (fetch, search).
Utilities: files, XLSX, Papa, docx, pptx, image, diagram (Kroki).
Print with console.log or a top-level `return`. Write to integrations only on explicit user request. Read {{skill:quick-script}} before first use.
```

- Each integration fragment carries only its most common pitfall; everything else is in the guide.
- The write restriction stays in the description ([tool-writing rules](../architecture/system-prompt.md#tool-writing-rules)).
- The guide pointer lives only in the description; `formatToolGuides` adds no system-prompt line for this tool.
- The description is the authority on what exists: the guide says "only the globals listed in the tool description exist".

## Settings

All configuration lives in the tool's settings entry, so agent profiles carry it too:

```ts
tools.quick_script = {
  enabled: boolean,
  settings: {
    jira?: { enabled: boolean; profileId?: string },        // Atlassian account
    confluence?: { enabled: boolean; profileId?: string },  // Atlassian account; may differ from Jira's
    web?: { enabled: boolean; profileId?: string },         // Tavily account for search; fetch needs none
    diagram?: KrokiToolSettings,                            // { url }, same schema as kroki_export; default https://kroki.io/
  },
}
```

- Utilities are always on; the tool works with no integration enabled. The current `MISSING_ACCOUNT` gate on the whole call goes away.
- An integration that is enabled but lacks an account or token is left out of the description and the SDK, and the settings page warns. A script that calls it anyway gets an error naming the setting to fix.
- The settings dialog has an Integrations section (toggle and account per integration) and a Utilities section (Kroki server).
- `quick_script` gets its own permission group instead of `jira`. Its risk stays dynamic, from the script classification. Planning and Read-only allow scripts classified as read; the other built-in rule sets behave as today.
- No settings migration: the tool is unreleased, so homes that saved `atlassian_code_mode` (development slots only) are reset by hand.

## Guide

One built-in skill, `quick-script`, split into small files so the agent reads only what the task needs:

```text
quick-script/
  SKILL.md                    runtime, output, rules, error codes, approvals; "read X when Y" by namespace
  references/
    files.d.ts, files.md      artifacts, workspace files, xlsx/csv/docx/pptx/image/diagram
    jira.d.ts, jira-workflows.md, jira-raw.md
    confluence.d.ts, confluence-writing.md, storage.md, confluence-raw.md
    atlassian.d.ts
    web.d.ts
    project-knowledge.md
```

- **Static, sectioned SKILL.md** (under about 3 KB, one example): a heading per integration, so an agent skips sections for integrations the description doesn't list.
- **Signatures live only in the generated `.d.ts` files.** The `.md` files hold workflows and judgement and never repeat signatures.
- **Destructive methods are marked by the generator** (`/** destructive */` from each method's declared risk), replacing the hand-kept list in SKILL.md.
- **Raw recipes are split per integration** so a Jira task never loads Confluence recipes.

## Permissions: operation-level rules

Today each SDK call is checked as its equivalent direct tool (see [architecture](../architecture/code-mode.md#permissions)). Removing the direct tools removes those permission identities, so rules target SDK operations instead:

- A rule for `quick_script` may match an **operation** (`jira.issues.create`, `confluence.pages.*`), its **targets** (project key, space key, page ID, URL host) and **risk**. Each method declares its operation name, risk and target extraction in its method table.
- The script scan, the user-approval ceiling and "deny always wins" stay as they are.
- Raw requests become operations with method and path targets (`jira.request` `DELETE /rest/api/3/issue/*`), so rules can allow specific raw writes and the raw-request special case in the broker disappears.
- The rule contract change lives in `packages/contracts`; no database change.

This resolves the earlier open question on rule granularity.

## Removing the direct tools

1. Confirm parity on the field report's capability tables (typed method or raw recipe for each row) and run the benchmark below.
2. Ship operation-level rules and migrate built-in rule sets.
3. Delete the 28 tools, their guides and their presentation code. Migrate user and project rules that reference `jira_*` / `confluence_*`, and the `jira` / `confluence` tool settings, in the release's single migration step.

## Experiment

A fixed task set against the test Atlassian site, each with a written success check: single lookups; cross-call joins; bulk updates with approvals; Excel to a Confluence page with a diagram; edits with known pitfalls (custom field by name, required transition field, stale page version). Five runs per model family (Claude, GPT) with `quick_script` alone versus the direct tools alone. Report success rate, turns, total tokens (including definition cost) and approvals. Proceed with removal unless the direct tools win clearly on a model family.

## Delivery

1. **Rename and decouple:** `atlassian_code_mode` → `quick_script`, own permission group, the [settings](#settings) above, works without integrations, [description](#tool-description) built from active namespaces. Code moves from `execution/atlassian-code-mode/` to a neutral folder with one subfolder per namespace.
2. **Guide reorganisation** into `quick-script` as above.
3. **`web` namespace.**
4. **Document libraries:** `docx`, `mammoth`, `pptxgenjs` after QuickJS checks.
5. **Benchmark**, then **operation-level rules**, then **direct-tool removal** with migration.

Steps 1–4 ship together in one PR; step 5 follows separately.

## Open questions

- **Other namespaces:** GitHub/GitLab (PR-sync credentials exist) once the web namespace proves the model.
