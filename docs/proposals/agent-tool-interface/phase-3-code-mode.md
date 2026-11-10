# TypeScript execution environment

> **Status:** Proposal. This document describes intended behavior, not an available tool or SDK.

## Summary

A file-first TypeScript execution tool lets agents compose existing Nerve tools, process files and generate artifacts. Scripts run on Node.js in an isolated environment with familiar, preinstalled libraries. A small Nerve SDK supplies tool access, structured logging, execution context and artifact publication; third-party libraries are not wrapped.

The working directory is the conversation's persistent artifacts directory (`<NERVE_HOME>/data/conversations/<conversationId>/artifacts/`). Existing write/read/edit tools maintain scripts, and the execution tool accepts a script path, not inline source. A built-in skill documents the runtime, packages and SDK.

## Goals

- Combine multiple tool calls and local transformations without returning every intermediate result to model context.
- Support iterative scripts: write, execute, inspect diagnostics, edit a small region, rerun.
- Reuse popular libraries and their documentation.
- Preserve scripts, outputs and diagnostics for later inspection.
- Preserve permission, approval, cancellation and audit boundaries when code invokes tools.
- Stay small, with no new database tables or columns.

## Non-goals

- A persistent REPL or kernel with cross-execution state.
- Replacing write/edit, integration or shell tools.
- Unrestricted host access, arbitrary package installation or access to service credentials.
- Lossless Office document editing.
- Automatically retrying or replaying scripts with external side effects.

## Execution model

Illustrative interface; the tool name and schema are open:

```ts
execute_script({
  path: "scripts/report.ts",
  args: ["--input", "inputs/issues.json"],
  timeoutMs: 60_000,
});
```

- Each invocation starts a fresh isolated Node.js process with its own module cache and temporary directory. Files persist between invocations; variables and connections do not. Concurrent executions share conversation files, so scripts must avoid conflicting writes.
- TypeScript with ESM and top-level await runs without a package manifest. Validate before execution and report bounded diagnostics with file and line. Pin the Node.js version and compiler configuration.
- File-first execution avoids resending source during iteration; a rerun still executes the whole script.
- Script-authored file layout (`scripts/`, `inputs/`, `outputs/`, `scratch/`) is a documented convention. Runner-owned records (`runs/<executionId>/` with execution metadata, structured events, stdout and stderr) have a stable layout and are protected from scripts.
- `NERVE_ARTIFACTS_DIR` is exposed in the runtime. File tools need the actual host path, since an environment variable alone is not enough; if sandbox and host paths differ, document the mapping.
- A stored file is not a user-facing attachment; publication is explicit and uses existing asset and [result projection](../architecture/tool-result-projection.md) mechanisms. Conversation deletion owns cleanup, and retention and size limits must be defined before rollout.

### Libraries

Provide familiar packages with pinned versions (for example `zod`, `csv-parse`, `exceljs`, `docx`, `pdf-lib`, `cheerio`, `sharp`, `fflate`) instead of wrappers. The catalog is subject to compatibility, security, licensing and packaging review. Package availability does not imply network, filesystem or subprocess access. Google Workspace documents are integrations reached through existing tools. Heavy conversion, OCR or media work belongs in separately isolated workers or existing tools.

### Nerve SDK

Custom interfaces cover only Nerve-specific concerns:

- tool discovery and invocation through a trusted broker;
- artifact publication through existing asset mechanisms;
- execution context: ID, cancellation signal, remaining budget;
- structured logging (info, progress, warn, error), streamed and persisted as JSONL, alongside ordinary stdout and stderr.

Integrations such as Jira or GitHub are not duplicated in the runner. Tool calls from scripts keep conversation identity and normal approvals; approval waits need defined timeout semantics. Cancellation stops the runtime and propagates to in-flight tool work without claiming to undo completed side effects. Recursive invocation of the execution tool is rejected, as are lifecycle-changing tool calls unless explicitly supported.

Logs explain what happened and files hold results. Progress is not a checkpoint, `log.error()` does not fail execution, and large data stays out of logs and model context. Bound event size, output volume and progress frequency, and mark truncation. The agent-facing result includes execution identity, terminal status, bounded diagnostics and references to logs and published outputs.

### Records and reproducibility

Record timestamps, status, arguments, runtime and package versions and source identity in runner-owned files. Capture a source bundle (entrypoint and resolved local imports) with its hash before execution, so later edits do not change the meaning of past records. This records code identity, not reproducibility. Never replay interrupted scripts automatically; a daemon restart marks unfinished executions interrupted or lost through existing lifecycle mechanisms.

## Isolation requirement

A working directory, TypeScript checking or Node.js `vm` is not a sandbox. A real process, filesystem and network isolation mechanism must be selected and validated before untrusted execution is enabled. It must:

- scope filesystem access to approved conversation files and read-only runtime dependencies, with safe path and symlink handling and protected runner records;
- keep credentials and daemon internals outside the runtime, with authenticated operations going through the broker;
- deny network and subprocess creation by default;
- enforce wall-clock, memory, CPU, filesystem, output and concurrency budgets, including child cleanup;
- bound archive expansion and XML parsing, and never execute document macros;
- treat fetched content as untrusted data, not authority to invoke tools;
- keep approvals and audit attribution for every brokered call.

Existing write/edit tools must handle script files without gaining authority over unrelated host paths.

## Built-in skill

A small `SKILL.md` with on-demand references covers runtime imports, package versions, directory conventions, rerun behavior, limits, permissions, cancellation and publication, with tested recipes. Generate package and SDK references from runtime metadata where possible and link version-matched upstream documentation instead of rewriting library APIs.

## Implementation boundaries

- Shared schemas go in `packages/contracts`; transport-neutral lifecycle mechanics in `packages/protocol`.
- Isolation, package provisioning, credential-bearing brokers and path mapping belong in host infrastructure.
- Reuse the existing tool lifecycle, permission, asset and result-projection boundaries.
- Any database schema change needs separate discussion and approval.

Delivery order: isolation mechanism and minimum package set; file-first execution with diagnostics, cancellation, limits and records; logging, publication and brokered tools; the skill; further packages by workload. Sandbox and end-to-end security validation is a rollout requirement separate from unit tests.

## Open decisions

- Isolation technology and supported operating systems, especially native package support.
- Tool name, synchronous versus background execution, and approval-wait timeout.
- Minimum package catalog, distribution size and update policy.
- Runtime-visible path mapping and how file tools receive the host artifact path.
- Local import capture and restrictions on dynamic loading.
- Log retention, quotas and progress presentation in the UI.
