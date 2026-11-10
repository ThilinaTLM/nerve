# Phase 3: code mode

> **Status:** Proposal. Part of [agent tool interface](README.md). Replaces the earlier TypeScript execution environment proposal with a smaller first version.

## Why

86% of turns make one tool call, and much exploration is a chain of small lookups. Claude models already batch these into bash one-liners: of their roughly 14k bash calls that search or read files, a quarter run two or more searches and a fifth read two or more files ([review.md](review.md#shell-first-models)). Code mode offers the same batching through Nerve's own tools:

- several lookups in one call, with loops and conditions between them;
- structured results instead of re-parsing text;
- intermediate data stays out of context; only what the script prints is returned;
- every tool call keeps its normal permission checks and audit record.

## Tool

```ts
run_script({ code: string, timeout?: integer }) // seconds, default 60, maximum 300
```

Inline TypeScript (ESM, top-level await). No script files: writing a file and then running it would cost the round trip this tool exists to save.

```ts
const hits = await tools.grep({ pattern: "classifyRisk", glob: "*.ts" });
for (const file of new Set(hits.matches.map((m) => m.path))) {
  const { content } = await tools.read({ path: file, limit: 40 });
  console.log(
    file,
    content.split("\n").find((l) => l.includes("export")),
  );
}
```

## SDK

- `tools.<name>(args)` for an allow-listed set: `read`, `grep`, `find`, `ls`, `web_search`, `web_fetch`, and the Jira and Confluence read operations.
- Arguments are exactly the direct tools' arguments, which are already in the model's context, so inputs need no extra documentation.
- Return values are the executors' structured results (the same records that become `details` today). Their TypeScript types are generated from the contracts and summarised in the tool description; keep that summary small.
- A failed tool call throws an error with the same one-line message the direct call would return.
- Nothing else: no artifact publication, logging API or execution-context API in this version.

## Runtime

An orchestration-only process: the script can compute, but every external effect goes through `tools.*`.

- Fresh Node.js process per call. No direct filesystem, network, subprocess, worker or native addon access. Tool calls go to the host over a narrow broker channel.
- Candidate: Node's permission model (`--permission` with no allow flags). On Node 24, which Nerve ships, it does not restrict network access. Node 25 added `--allow-net`, but it is experimental and has had a bypass through Unix domain sockets (CVE-2026-21636). The Node project also says the permission model is not a security boundary against malicious code. Use it as a second layer at most. The real isolation (filesystem, network, processes) needs an OS-level mechanism, chosen and verified per supported platform before shipping. That is still simpler than the earlier proposal's requirement, because the script needs no file or network access at all.
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
3 tool calls (grep 1, read 2). exit 0 · 1.2s
```

A thrown error ends with its message and the script line, using the same footer.

## Later, if the first version earns its place

Each of these needs its own proposal:

- Write-capable tools (`edit`, `write`) in scripts, with approval waits and replay rules.
- Saved scripts, a persistent artifacts directory, preinstalled libraries (`csv-parse`, `exceljs`, `pdf-lib` and similar), and published outputs. These were the main subject of the earlier TypeScript execution environment proposal.
- Replacing or merging `python_exec`.

## Validation

Build a fixed task set of exploration and integration tasks (for example "which tools call `classifyRisk`, and what do they return", or "summarise the status of these 15 Jira issues"). Run each with and without `run_script` on Claude and GPT models, and compare turns, total tokens and success. Keep code mode only if it wins clearly on at least one model family without making the other worse.

## Open questions

- OS-level isolation mechanism per supported platform (for example bubblewrap or Landlock on Linux, `sandbox-exec` on macOS, and something for Windows).
- How small the generated return-type summary can be while staying accurate.
- Whether GPT models, which rarely batch today, will use the tool at all.
