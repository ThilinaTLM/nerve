# TypeScript execution environment

> **Status:** Proposal. This document describes intended behavior, not an available tool or SDK.

## Summary

Introduce a file-first TypeScript execution tool for composing existing Nerve tools, processing files, and generating artifacts. Scripts run on Node.js in an isolated environment with familiar, preinstalled libraries. A small Nerve SDK supplies tool access, structured logging, execution context, and artifact publication rather than wrapping third-party libraries in new interfaces.

Use the conversation's persistent artifacts directory as the working directory:

```text
<NERVE_HOME>/data/conversations/<conversationId>/artifacts/
```

Reuse existing write/read/edit tools to maintain scripts. The execution tool accepts a script path, not inline source. A built-in skill documents the runtime, available packages, SDK, and recommended file conventions.

## Goals

- Let agents combine multiple tool calls and local transformations without returning every intermediate result to model context.
- Support iterative scripts: write once, execute, inspect diagnostics, edit a small region, and execute again.
- Reuse popular libraries and their established APIs and documentation.
- Preserve scripts, outputs, and execution diagnostics for later inspection.
- Preserve existing permission, approval, cancellation, and audit boundaries when code invokes tools.
- Keep the initial implementation small, with no new database tables or columns proposed.

## Non-goals

- A persistent REPL or notebook kernel with cross-execution JavaScript state.
- A replacement for existing write/edit tools, integration tools, or shell tools.
- Unrestricted host access, arbitrary package installation, or access to service credentials.
- A universal document abstraction or a promise of lossless Office document editing.
- Automatically retrying or replaying scripts with external side effects.

## Execution workflow

1. The agent discovers the execution capability and loads its built-in skill as needed.
2. Tool context provides the resolved conversation artifacts path and runtime-visible paths.
3. The agent uses existing write/edit tools to create or update a script.
4. The agent invokes the execution tool with a path relative to the artifacts root and optional arguments.
5. The runner starts a fresh isolated Node.js process, streams diagnostics, and records execution results.
6. The agent inspects results or logs, makes targeted edits, and reruns as needed.

Illustrative interface; the final tool name and schema remain to be selected:

```ts
execute_script({
  path: "scripts/report.ts",
  args: ["--input", "inputs/issues.json"],
  timeoutMs: 60_000,
});
```

No inline-source parameter or separate write subcommand is included initially. Existing file tools already provide the required editing behavior. File-first execution reduces repeated source transmission during iteration, though a new execution still runs the whole script unless the script implements its own checkpointing.

The runner supports TypeScript with ESM imports and top-level await. Validate TypeScript before execution and report bounded diagnostics with file names and line numbers. Pin the supported Node.js version and compiler configuration; users should not need a package manifest or project configuration for a simple script.

Each invocation has a fresh runtime, module cache, and temporary directory. Files persist between invocations; variables and open connections do not. Concurrent executions have independent identities and temporary storage, but share conversation files, so scripts must avoid conflicting writes.

## Workspace and file conventions

Recommended layout:

```text
artifacts/
├── scripts/                  # Reusable TypeScript scripts and local modules
├── inputs/                   # Source files
├── outputs/                  # Deliverables
├── scratch/                  # Intermediate files
└── runs/
    └── <executionId>/
        ├── execution.json    # Script identity, arguments, timing, status
        ├── events.jsonl      # Structured SDK logs
        ├── stdout.log
        └── stderr.log
```

The layout for script-authored files is a documented convention, not an enforced schema. Runner-owned execution records have a stable internal layout and are protected from script modification. Do not recursively publish everything under this directory.

The working directory is the artifacts root, making paths such as `inputs/issues.json` and `outputs/report.xlsx` portable between conversations. Expose `NERVE_ARTIFACTS_DIR` inside the runtime. Separately provide existing file tools with the actual writable host path: an environment variable is not sufficient unless those tools explicitly support expansion. If sandbox and host paths differ, document both and their mapping clearly.

Scripts should receive input paths through arguments rather than hardcoding conversation-specific absolute paths. Document whether reruns overwrite, append to, or create new outputs. A stored file is not automatically a user-facing attachment; publication is explicit and uses existing asset ownership and result-projection mechanisms.

Conversation deletion owns cleanup of these files. Retention and size limits for logs, snapshots, and scratch data must be defined before rollout. This extends the file-based model described in [storage architecture](../architecture/storage.md), without requiring database schema changes.

## Built-in libraries

Provide familiar packages directly, with pinned versions, rather than inventing a wrapper for every operation. The following is a candidate catalog, subject to runtime compatibility, security, licensing, and packaging review:

| Area       | Candidate packages                            | Scope and limitations                                                   |
| ---------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| Validation | `zod`                                         | Runtime schemas and validation                                          |
| CSV / TSV  | `csv-parse`, `csv-stringify`                  | Reading, writing, streaming                                             |
| XML        | `fast-xml-parser`                             | Parsing and building with safe entity handling                          |
| XLSX       | `exceljs`                                     | Worksheets, values, formulas, formatting; no formula calculation engine |
| DOCX       | `docx`, `mammoth`                             | Creation and text/HTML extraction; not lossless general editing         |
| PPTX       | `pptxgenjs`                                   | Presentation generation; not general editing of existing decks          |
| PDF        | `pdf-lib`, `pdfjs-dist`                       | Manipulation and text extraction; scanned documents need OCR separately |
| HTML       | `cheerio`                                     | Parsing and transformation                                              |
| Markdown   | `unified`, `remark-parse`, `remark-stringify` | Parsing and transformation                                              |
| Images     | `sharp`                                       | Image processing, subject to native dependency support                  |
| ZIP        | `fflate`                                      | Archive processing within enforced resource limits                      |

Standard JavaScript APIs and permitted Node.js modules are available according to the sandbox policy. Package availability does not imply unrestricted network, filesystem, worker, or subprocess access. Test actual imports and common operations in the packaged runtime, including native dependencies and PDF worker setup.

Google Docs, Sheets, and Slides are integrations, not local file formats. Access them through existing tool capabilities. Legacy Office conversion, Office-to-PDF rendering, browser automation, OCR, FFmpeg, and expensive media operations can be added through separately isolated workers or existing tools rather than exposed through unrestricted subprocess execution.

Example using the library's own API:

```ts
import ExcelJS from "exceljs";
import { artifacts, log } from "@nerve/sdk";

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet("Summary");
sheet.addRow(["Project", "Open issues"]);
sheet.addRow(["APP", 12]);

await workbook.xlsx.writeFile("outputs/summary.xlsx");
log.info("Workbook generated", { path: "outputs/summary.xlsx" });
await artifacts.publish({ path: "outputs/summary.xlsx" });
```

All SDK examples in this proposal are illustrative, not existing contracts.

## Small Nerve SDK

Reserve custom SDK interfaces for Nerve-specific concerns:

- **Tool discovery and invocation:** search available capabilities, inspect input/output schemas, and call tools through a trusted broker.
- **Artifact publication:** publish a scoped file through existing asset/result mechanisms; add buffer/file convenience helpers only where useful.
- **Execution context:** execution ID, cancellation signal, and remaining execution budget.
- **Structured logging:** progress and diagnostics that are both streamed and persisted.

Do not duplicate Jira, Confluence, GitHub, or web integrations inside the runner. Generic invocation can be the initial interface; generated typed clients may improve ergonomics later, provided both use the same broker and permissions.

Tool calls from scripts retain conversation identity and normal approval behavior. Broker-side concurrency and rate limits still apply. Waiting for an approval must have defined timeout semantics. Cancellation must stop the runtime and propagate to in-flight tool work where supported, without claiming to undo completed external side effects.

Reject recursive invocation of the execution tool and restrict lifecycle-changing tool calls unless their behavior is explicitly supported.

## Structured logging and outputs

Provide a small logging helper:

```ts
import { log } from "@nerve/sdk";

log.info("Loading issues", { project: "APP" });
log.progress("Processing issues", { completed: 20, total: 100 });
log.warn("Skipping issue", { key: "APP-42", reason: "Missing owner" });
log.error("Report generation failed", { error });
```

The helper attaches timestamps and execution identity, safely serializes errors and bounded metadata, and streams events to the tool UI while persisting them as JSONL. Capture ordinary stdout and stderr as well; third-party libraries do not need to adopt the helper.

Important distinctions:

- Logs explain what happened; files contain generated results.
- Progress is observability, not a checkpoint or success signal.
- `log.error()` does not fail execution; throwing or a nonzero exit does.
- Large datasets belong in files, not logs or model context.
- Scripts must not log secrets; secret redaction is defense in depth, not a guarantee.

Bound event size, nesting, output volume, and progress frequency. Explicitly mark dropped or truncated output. Full retained logs are available by file reference, subject to retention limits. The agent-facing result should include execution identity, terminal status, exit code when available, bounded diagnostics, and references to logs and explicitly published outputs. Reuse [tool-result projection](../architecture/tool-result-projection.md) rather than creating a separate transcript mechanism.

## Execution records and reproducibility

Record start/end timestamps, status, arguments, runtime/package versions, source identity, and relevant result references in runner-owned files. Arguments may contain sensitive data; do not use them for secrets and apply an explicit exposure policy to execution records.

Capture the source before execution so later edits do not change the meaning of past records. Resolve local imports and execute a captured source bundle or equivalent snapshot, retaining its hash and original path mapping. Copying only the entrypoint while executing mutable imported files is insufficient. Dynamic local loading needs an explicit supported policy.

This records code identity, not complete reproducibility: inputs can change, services return different results, and external side effects cannot be rolled back. Do not automatically rerun interrupted scripts. A daemon restart should mark unfinished executions interrupted or lost using existing lifecycle mechanisms rather than replaying them.

## Security and resource boundaries

A working directory, TypeScript checking, or Node.js `vm` is not a security sandbox. Select and validate an actual process/filesystem/network isolation mechanism before enabling untrusted execution.

Required boundaries:

- Scope filesystem access to approved conversation files and runtime dependencies. Resolve paths and symlinks safely; prevent traversal, symlink races, and modification of runner-owned records.
- Keep credentials and daemon internals outside the runtime. Perform authenticated tool operations through the broker.
- Deny arbitrary network access and subprocess creation by default. Approved capabilities must not be bypassed through library APIs.
- Enforce wall-clock, memory, CPU, filesystem, output, and concurrency budgets, including cleanup of child work.
- Limit archive expansion and reject path traversal; bound XML parsing and prohibit external entity resolution. Never execute document macros.
- Treat fetched content and documents as untrusted data, not instructions or implicit authority to invoke tools.
- Preserve approvals and audit attribution for every brokered tool invocation, including concurrent calls and partial failures.

Existing write/edit tools must remain usable for intended script files without expanding their authority to unrelated host paths. Read-only runtime dependencies may be exposed to the sandbox, but writable shared package directories must not be.

## Built-in skill and documentation

Ship a built-in skill with a small entrypoint and references loaded on demand:

```text
code-execution/
├── SKILL.md
├── references/
│   ├── runtime.md
│   ├── sdk.md
│   ├── packages.md
│   ├── files-and-artifacts.md
│   └── logging.md
└── examples/
```

Document runtime imports, exact package versions, directory conventions, script inputs/outputs, rerun behavior, limits, permissions, errors, cancellation, and publication. Include tested recipes using the actual installed libraries. Link or bundle version-matched upstream documentation, respecting licenses; avoid maintaining rewritten copies of entire library APIs.

Generate the installed package catalog and SDK references from authoritative runtime metadata and schemas where possible. Models' prior library knowledge is helpful but does not replace version-specific documentation. Runtime capability discovery remains authoritative when integrations differ by conversation.

## Implementation boundaries

- Shared execution/tool/event schemas belong in `packages/contracts` where applicable.
- Session/RPC/transport lifecycle mechanics belong in `packages/protocol` where applicable and remain transport-neutral.
- Host isolation, package provisioning, credential-bearing brokers, and filesystem mapping belong in host infrastructure, not shared contracts.
- Reuse existing tool lifecycle, permission, asset, and result-projection boundaries rather than creating a parallel system.
- Any later database schema proposal requires separate discussion and explicit approval; this proposal assumes files and existing records suffice.

## Delivery and validation

1. Select the isolation mechanism and prove compatibility with the minimum package set.
2. Implement file-first execution, diagnostics, cancellation, limits, and execution records using existing lifecycle infrastructure.
3. Add structured logging, artifact publication, and brokered tool discovery/invocation.
4. Ship the built-in skill and a small set of tested package recipes.
5. Expand document/media packages and worker capabilities based on actual workloads.

Validate targeted behaviors at their owning layer: path confinement, output limits, status/error handling, cancellation, broker approvals, source capture, and concurrent execution isolation. Include documented import/recipe smoke checks in implementation planning. Broader sandbox and end-to-end security validation is a rollout requirement, separate from ordinary unit tests.

## Open decisions before implementation

- Isolation technology and supported operating systems, especially native package support.
- Final tool name, synchronous versus background execution, and approval-wait timeout behavior.
- Minimum package catalog, distribution size, and dependency update policy.
- Runtime-visible path mapping and how existing file tools receive the host artifact path.
- Local import capture policy and restrictions on dynamic module loading.
- Log/snapshot retention, quotas, and presentation of execution progress in the UI.
