# Phase 3: code mode for integrations

> **Status:** Proposal. Part of [agent tool interface](README.md). Replaces the earlier TypeScript execution environment proposal with a smaller first version. Start only if [benchmark](README.md#validation) tasks that join or filter across calls show a need the existing batch reads can't meet.

## Why

Code mode is scoped to where bash can't reach: Jira, Confluence and the web. Even there, the cheap alternatives come first:

- **Batch reads with field selection already exist.** "Summarise the status and assignee of these 15 Jira issues" is one `jira_search_issues` call today, with `jql: "key in (A, B, …)"` and a `fields` list. Field selection is where the token saving comes from.
- **Integrations are rarely used.** No Jira or Confluence tool is among the 25 most-used tools in the snapshot.

Code mode is only needed for tasks that join or filter across calls, for example "for every open bug in this sprint, find the Confluence runbook for its component and list the bugs with none". The benchmark must include tasks of that shape; if it doesn't, the cheap alternatives win by default.

Every tool call made from a script keeps its normal permission checks and audit record, which bash can't offer for these services.

## Tool

```ts
run_script({ code: string, timeout?: integer }) // seconds, default 60, capped at 300
```

Inline TypeScript (ESM, top-level await). No script files: writing a file and then running it would cost the round trip this tool exists to save.

```ts
const { issues } = await tools.jira_search_issues({
  jql: "sprint in openSprints() AND type = Bug AND status != Done",
  fields: ["components"],
});
for (const issue of issues) {
  const found = await tools.confluence_search({
    query: `runbook ${issue.components[0]}`,
  });
  if (found.results.length === 0) console.log(issue.key, issue.components[0]);
}
```

The tool and field names in this sketch are illustrative.

## SDK

- `tools.<name>(args)` for an allow-listed set: the Jira and Confluence read operations, `web_search` and `web_fetch`. `read` and `grep` are included only so scripts can combine integration data with local files.
- Arguments are exactly the direct tools' arguments, which are already in the model's context, so inputs need no extra documentation.
- Return values are the executors' structured results (the same records that become `details` today). Their TypeScript types are generated from the contracts and summarised in the tool description; keep that summary small.
- Check first that those records hold complete data, not display-shaped or truncated copies. `web_search` already caps each result's content to 300 chars in `details`; a script computing on that would get partial data without knowing it. The Jira and Confluence executors haven't been checked. Where a record is truncated, the SDK must return the full data or mark the truncation.
- A failed tool call throws an error with the same one-line message the direct call would return.
- Nothing else: no artifact publication, logging API or execution-context API in this version.

## Runtime

An orchestration-only process: the script can compute, but every external effect goes through `tools.*`.

- Fresh Node.js process per call. No direct filesystem, network, subprocess, worker or native addon access. Tool calls go to the host over a narrow broker channel.
- Node's permission model (`--permission` with no allow flags) is a second layer at most. On Node 24, which Nerve ships, it does not restrict network access. Node 25 added `--allow-net`, but it is experimental and has had a bypass through Unix domain sockets (CVE-2026-21636). The Node project also says the permission model is not a security boundary against malicious code. The real isolation (filesystem, network, processes) needs an OS-level mechanism, chosen and verified per supported platform before shipping. That is still simpler than the earlier proposal's requirement, because the script needs no file or network access at all.
- Limits: wall-clock timeout, memory cap, maximum tool calls per script (for example 50), and the `script_output` projection budget for printed output.
- Cancellation kills the process and cancels in-flight tool calls.
- No preinstalled libraries. Node built-ins that don't touch the filesystem, network or processes are enough for filtering and joining.

## Permissions and records

- Each brokered call is checked against the conversation's policy exactly as a direct call would be.
- **No approval prompts inside scripts in this version.** A call that would need user approval fails with the denial reason, and the agent can make that call directly. This avoids a script stalling mid-run on a prompt.
- Only read-only tools are allow-listed, so a script has no side effects to replay. After a daemon restart the call settles as `indeterminate`, as other tools do.
- Brokered calls are recorded in the parent tool call's result details (tool, arguments, outcome, size), not as separate rows. The UI shows them as a nested list. No database changes.

## Result

```text
<printed output>
13 tool calls (jira_search_issues 1, confluence_search 12). exit 0 · 4.2s
```

A thrown error ends with its message and the script line, using the same footer.

## Later, if the first version earns its place

Each of these needs its own proposal:

- Write-capable tools in scripts, with approval waits and replay rules.
- Saved scripts, a persistent artifacts directory, preinstalled libraries (`csv-parse`, `exceljs`, `pdf-lib` and similar), and published outputs. These were the main subject of the earlier TypeScript execution environment proposal.
- Replacing or merging `python_exec`.

## Validation

Use the cross-call integration tasks in the shared [benchmark](README.md#validation). Run each with and without `run_script` on Claude and GPT models, and compare turns, total tokens and success against the existing tools used well (batch JQL with `fields`). Keep code mode only if it wins clearly on at least one model family without making the other worse.

## Open questions

- OS-level isolation mechanism per supported platform (for example bubblewrap or Landlock on Linux, `sandbox-exec` on macOS, and something for Windows).
- How small the generated return-type summary can be while staying accurate.
- Whether GPT models, which rarely batch today, will use the tool at all.
