# Backend hardening and structure

> **Status:** Proposal. A grouped set of small-to-medium backend items from the code-quality review. Each item is independent, can ship alone, and lists its own risk. Items that touch persisted data or wire formats are flagged **[approval]**. Currently none of the items require a DB schema change.

Package dependency rules come from `scripts/shared/workspace-architecture.mjs`: `contracts`, `native`, `ui-kit` have no internal deps; `protocol → contracts`; `harness → contracts, native`; `tools → contracts, native, skills`; `conversation-core → contracts, native, harness, skills, tools`; `workbench-server → everything backend`; `desktop-shell → contracts, workbench-server`.

---

## (a) One canonical project-relative path parser

### Problem

"Is this a safe project-relative path?" is implemented at least six times, with different answers about `.` segments, trailing slashes, backslashes, empty input and error type:

| Site                                                                                                                                                                   | Behavior                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `workbench-server/src/domains/completions/file-completion-candidates.ts:318` `normalizeRelativePath`                                                                   | Returns `undefined`; strips leading `./` and trailing `/`; rejects `..` and empty segments; allows `.` mid-path |
| `workbench-server/src/domains/projects/project-launch-target.ts:39` `normalizeRelativePath`                                                                            | Throws `invalidPath`; empty means root; rejects `.`, `..`, empty segments                                       |
| `workbench-server/src/domains/filesystem/project-listing.ts:33` `normalizeProjectRelativeDirectory` (used by `project-entry-mutations.ts:31`, `filesystem.service.ts`) | Throws; own rules                                                                                               |
| `tools/src/execution/filesystem/path.ts` `expandToolPathInput`/`resolveToCwd`                                                                                          | Not a validator: expands `~`, `@`, unicode spaces; resolves anything, including outside cwd                     |
| `harness/src/paths.ts:97` `relativeEnvPath`                                                                                                                            | Computes relative path for ignore matching, handles Windows-like paths case-insensitively                       |
| `harness/src/environment/node-environment.ts:28` `resolvePath`                                                                                                         | `isAbsolute(path) ? path : resolve(cwd, path)`                                                                  |
| `desktop-shell/src/ipc/project-entry-path.ts`                                                                                                                          | A seventh copy: root + relativePath with `posix`/`win32` selection and containment check                        |

Some of these legitimately differ (tool paths accept absolute paths and `~`), but the _project-relative, untrusted-input_ ones (completions, launch target, listing/mutations, desktop IPC) are the same security rule in four dialects. A fix in one (for example Windows drive-letter handling) does not reach the others.

### Proposal

A single pure parser, with explicit options for the legitimate variations:

```ts
// @nervekit/contracts/paths  (string-only; no node:path, no fs)
export type ProjectRelativePath = string & {
  readonly __brand: "ProjectRelativePath";
};

export type ProjectPathResult =
  | { ok: true; path: ProjectRelativePath; segments: readonly string[] }
  | {
      ok: false;
      reason:
        | "empty"
        | "absolute"
        | "drive"
        | "nul"
        | "dot_segment"
        | "parent_segment"
        | "empty_segment";
    };

export function parseProjectRelativePath(
  input: string,
  options?: {
    allowEmpty?: boolean;
    allowDot?: boolean;
    trimTrailingSlash?: boolean;
  },
): ProjectPathResult;
```

**Home package: `contracts`.** It is the only package every consumer can import under the architecture rules (`harness` cannot import `tools`; `desktop-shell` can import only `contracts` and `workbench-server`; the workbench-app can use it too if it ever validates client-side). The function is pure string logic, so it respects "contracts stay transport-neutral". Containment (`resolve` + `relative` + `realpath`) is filesystem policy and stays in node-side code: `workbench-server/src/domains/filesystem` gets one `resolveInsideProject(root, parsed)` helper that `desktop-shell` replaces with its own platform-aware equivalent built on the same parsed segments. `native` is rejected as home because it is a Rust binding and would force a native rebuild for a string rule.

Callers adapt result → their error style (`undefined`, `ApplicationError(400, …)`, `Error`). Tool paths (`tools/.../path.ts`) and the harness `relativeEnvPath` are **not** migrated; they solve a different problem. Document that boundary in the module header so a future reader does not merge them.

### Migration

1. Add `parseProjectRelativePath` with a table-driven test covering every divergence above (`.`, `./a`, `a//b`, `a/`, `a\\b`, `C:/x`, `\0`, `..`).
2. Migrate `file-completion-candidates`, `project-launch-target`, `project-listing` in that order; each keeps its existing tests as the behavior check. Decide per site whether the stricter or looser rule wins; call out any behavior differences in the PR.
3. Migrate `desktop-shell/src/ipc/project-entry-path.ts` after (d) lands.

**Deleted:** four private normalizers (~15-25 lines each). **Risk:** accidentally tightening a user-visible rule (e.g. completions currently allow `a/./b`). **Effort:** S-M.

---

## (b) Schema-validated JSON readers and Atlassian clients

### Problem

- `workbench-server/src/infrastructure/storage-bootstrap/json.ts`: `readJsonFile<T>` (`JSON.parse(raw) as T`) and `readJsonLines<T>`, `readJsonLinesTail<T>`, `forEachJsonLine<T>`, `filterJsonLinesToFile<T>` cast parsed data to a caller-chosen `T`. The generic claims a shape nobody checked. Several callers already pass `<unknown>` and validate (`pi-ai-models-store.ts:40`, `home-configuration.ts:277`, `storage-postconditions.ts:6` with `nerveHomeManifestSchema.parse`), which shows the intended pattern; the generic form invites the unsafe one.
- `tools/src/execution/jira/client.ts` (lines ~109-136) and `confluence/client.ts` (~109-150): `return JSON.parse(text) as T`, `undefined as T`, and `text as T` on a parse failure. A server returning HTML (proxy error page) is returned to the caller typed as a JSON model.

### Proposal

**JSON readers.** Make validation part of the signature:

```ts
export async function readJsonFile<S extends z.ZodType>(
  path: string,
  schema: S,
): Promise<z.infer<S>>;
export async function readJsonFileUnknown(path: string): Promise<unknown>; // explicit opt-out
export async function readJsonLines<S extends z.ZodType>(
  path: string,
  schema: S,
  onInvalid?: (line: number, error: unknown) => void,
): Promise<z.infer<S>[]>;
```

Invalid JSONL lines are already skipped with `process.emitWarning`; schema failures follow the same path (skip + warn) so a corrupt journal line never blocks startup. Remove the bare generics; the `<unknown>` callers move to the unknown variant or pass their existing schema.

**Atlassian clients.** Give the shared request helper an optional schema and a discriminated result:

```ts
request<S extends z.ZodType>(path: string, init: RequestInit, schema: S): Promise<z.infer<S>>;
requestVoid(path: string, init: RequestInit): Promise<void>;   // 204 / empty body
requestText(path: string, init: RequestInit): Promise<string>; // attachments, exports
```

A non-JSON body on a JSON request becomes an error carrying status, content type and a truncated snippet. Schemas can be minimal (`z.looseObject` with the fields the tool reads); the point is to fail at the boundary rather than deep inside result formatting. The two clients are near copies (the 115-line request function appears identically in both); extract the shared request core into `tools/src/execution/atlassian/http.ts` at the same time.

### Notes

- No storage-format change: the same files are read; only the failure mode changes. A file that fails validation today "works" with wrong types; tomorrow it is rejected or skipped. **Audit each `readJsonFile` caller for files written by older versions** before enforcing schemas, otherwise old data stops loading.
- Do not touch frozen migration code under `infrastructure/migrations/steps/**`; if it imports these helpers, keep a local unvalidated reader there.

**Effort:** S for Atlassian, M for the readers (caller audit).

---

## (c) Local token bootstrap: stop spreading `?token=`

### Problem

The daemon's local token is accepted and re-emitted via query string in several places:

- `workbench-server/src/app/server.ts:23-41` `remoteUiAuthRedirect`: any request with `?token=<localToken>` gets a 302 and a long-lived cookie (`Max-Age=31536000`, `cookieHeader` in `adapters/http/auth-middleware.ts:85`).
- `server.ts:44-62` `mobileSetupPage`: validates `?token=` and _re-emits_ it into the secure app URL.
- `adapters/http/auth-middleware.ts:97` `isWebSocketAuthorized`: accepts `url.searchParams.get("token")` for every WebSocket upgrade.
- `desktop-shell/src/daemon/urls.ts:76,94,100`: builds app, share and mobile-setup URLs with the token embedded.

A long-lived secret in URLs lands in browser history, referrers, proxy and access logs (`adapters/http/request-log-path.ts` exists, which suggests this was already felt) and copied share links.

### Proposal: one-time exchange

```ts
// POST /auth/exchange  or  GET /auth/enter?code=...
interface BootstrapCode {
  code: string;
  expiresAt: number;
  singleUse: true;
  purpose: "desktop" | "share" | "mobile";
}
```

1. The desktop shell (which already holds the token) asks the daemon for a short-lived (≈60 s), single-use bootstrap code over its authenticated channel, and builds URLs containing `?code=`.
2. A single route redeems the code and sets the cookie (`HttpOnly; SameSite=Strict`, `Secure` on HTTPS), then redirects to the clean URL.
3. WebSocket and API auth accept bearer or cookie only; `searchParams.get("token")` is removed from `isWebSocketAuthorized` and the redirect.
4. `mobileSetupPage` takes a code, and hands the secure app a _new_ code rather than the token.

In-memory code storage is enough (daemon restart invalidates pending codes). The cookie lifetime should also be reconsidered; one year for a bearer-equivalent secret is long.

### Risks

- **Dev flows**: `pnpm dev:ui` and dev proxies that inject bearer tokens (see the comment in `auth-middleware.ts:34`) must keep working; check `scripts/` for URLs with `?token=`.
- **Existing bookmarks/share links** break once; acceptable for a local tool but mention in release notes.
- No DB change. Security-sensitive: needs a focused review of the redeem route (rate limit, constant-time compare, Origin checks).

**Effort:** M.

---

## (d) Desktop IPC: main-process known-project-root registry

### Problem

`desktop-shell/src/ipc/files-ipc.ts` implements `desktop.files.openProjectEntry`, `revealProjectEntry`, `trashProjectEntry`. The renderer sends `{ root, relativePath }`; `project-entry-path.ts` checks the relative path and containment inside `root`, **but `root` itself is attacker-controlled input from the renderer's point of view**: a compromised renderer can pass `root: "/"` and trash or open anything. (Sender-window checking and `realpath` hardening are being done separately and are out of scope here.)

The main process has no notion of valid roots: projects live in the daemon, not in `desktop-shell`.

### Options

1. **Renderer/daemon registers roots with main over IPC.** After the app loads a project list, the renderer calls `desktop.projects.setKnownRoots(roots)`. Cheap, but the registering caller is the same untrusted renderer, so it only helps if registration is restricted to a trusted source (e.g. the preload bridge fed by the main process). As written, it adds ceremony without a trust boundary.
2. **Main queries the daemon.** Main already talks to the daemon (`desktop-shell/src/daemon/`, token in hand). On each files IPC call, or with a short TTL cache invalidated on project changes, main asks the daemon "is this a known project root?" over the authenticated HTTP API, and canonicalizes with `realpath`. The trust anchor is the daemon database, not the renderer.
3. **Send a project id instead of a root.** The renderer passes `{ projectId, relativePath }`; main resolves `projectId → root` through the daemon (option 2's query) and never sees a renderer-supplied root. This removes the attack surface entirely and fits the existing protocol vocabulary.

**Recommendation:** option 3 using option 2's mechanism, with a small `KnownProjectRoots` class in `desktop-shell/src/ipc/` holding a TTL cache and a `resolve(projectId)` method. Option 1 only if the daemon is unreachable during a files operation and a cached last-known list is acceptable. Pair with item (a) so path parsing is shared.

### Notes

- Needs a daemon endpoint (or reuse of `projects.list`) readable by the desktop token; the project record must expose the canonical root. Check this against the existing operation contracts; no DB change.
- Behavior if the daemon is down: fail closed.

**Effort:** M.

---

## (e) Git read-only shell classification as an allowlist

### Problem

`tools/src/policy/shell/assessment.ts:34` treats any segment whose root is `git` as read-only: `if (root === "git") return true;` and relies on `isBlockedCommandSegment(tokens)` → `isBlockedGitInvocation` in `tools/src/policy/shell/git-rules.ts:63` to exclude mutating subcommands via a blocklist (`stash`, `submodule`, `switch`, `tag`, `worktree`, …). A blocklist fails open: any git subcommand or flag added later, any alias (`git -c alias.x=...`, `core.pager`, `core.fsmonitor`, `--exec-path`), `git config` writes, or `git diff --output=file` is "read-only" unless someone remembered to list it.

### Proposal

Invert it: an explicit table of allowed subcommands with allowed/forbidden flags.

```ts
const READ_ONLY_GIT: Record<
  string,
  { allowFlags?: RegExp; denyFlags?: string[]; maxPositionals?: number }
> = {
  status: {},
  log: {},
  show: {},
  diff: { denyFlags: ["--output", "--ext-diff", "--no-index"] },
  "rev-parse": {},
  "ls-files": {},
  "ls-tree": {},
  blame: {},
  "cat-file": {},
  branch: {
    onlyFlags: [
      "--list",
      "-l",
      "-a",
      "-r",
      "--show-current",
      "-v",
      "-vv",
      "--contains",
      "--merged",
      "--no-merged",
    ],
  },
  remote: { onlyForms: ["", "-v", "show"] },
  config: { onlyFlags: ["--get", "--get-all", "--list", "-l"] },
};
```

Global rules stay: reject `-c`/`--config-env`/`--exec-path`/`--git-dir` style prefixes (existing `getGitSubcommandIndex` already parses those), `--ext-diff`, `--textconv` unless proven safe, and any unknown subcommand falls to "requires approval" (the existing `unsupported(...)` path). Unknown is safe by default; the cost is more approval prompts for rare read commands, which users can allow by rule.

### Migration

1. Add the allowlist table and a differential test that every currently-"read-only" git command in `tools/test` assessment cases is still read-only _or_ is intentionally demoted (document each).
2. Switch `isReadOnlySegment` to consult the table; delete the git blocklist in `git-rules.ts` except the global-option parsing.

**Risk:** more approval prompts for niche commands (`git reflog`, `git shortlog`, `git describe` can be added to the table up front). **Effort:** S.

---

## (f) Protocol receive-queue head-of-line blocking

### Problem

`protocol/src/connections/protocol-connection.ts:47-72`: every inbound frame is chained onto `#receiveTail` (`.then(async () => … await this.receive(frame))`). Frames are therefore processed strictly serially: one slow or hung handler (for example an RPC handler awaiting a stuck upstream) blocks heartbeats, cancels and every later frame on that connection indefinitely. In addition `close()` calls `dispose()` then `await this.drain()`, which awaits `#receiveTail` with no bound, so closing a connection whose handler is hung never completes. The queue is also unbounded in memory while a handler is slow.

Strict ordering is a deliberate property (replay/ack sequencing), so the fix should not parallelise arbitrarily.

### Proposal

1. **Bounded drain/close.** `drain({ timeoutMs })` races `#receiveTail` against a timer from the injected clock; `close()` uses a default (e.g. 5 s) and logs `drain timed out` via `onError`. Because `dispose()` already aborts `#abort` and bumps `#generation`, late completions are already discarded.
2. **Slow-handler watchdog.** Track `receiveStartedAt` for the current frame. If a frame exceeds `slowHandlerMs` (default ~30 s), report once through `onError` with the frame type and optionally close the connection (`4408` style code) so the peer reconnects and replays rather than hanging. Make the action configurable: `onSlowHandler: "report" | "close"`.
3. **Inbound depth limit.** Count queued-but-unstarted frames; above `maxQueuedFrames` close with a backpressure code instead of growing without bound.
4. Keep control-plane frames (heartbeat, cancel) independent if the codec can classify them cheaply before queuing: handle them inline, ahead of the serial queue. This should be validated against `server-heartbeat.test.ts` semantics.

Needs fake-clock tests (see `testing-improvements.md`): a hung handler, `close()` returning within the bound, a cancel frame processed while an RPC handler hangs.

**Wire impact:** a new close code only if (2)/(3) close the connection; confirm it is registered with the contracts protocol constants. No persisted format change. **Effort:** M.

---

## (g) Relocate `ServerAdapterContexts`; add the boundary rule

### Problem

`ServerAdapterContexts` is defined as `ReturnType<typeof createServerAdapterContexts>` in `workbench-server/src/app/bootstrap/create-server-adapter-contexts.ts:173`. 22 files under `src/adapters/**` do `import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js"` (for example `adapters/http/routes/auth-routes.ts:7`, `project-asset-routes.ts:2`) and index into it (`ServerAdapterContexts["http"]["auth"]`). So adapters depend on the composition root's return type, a cycle in intent even though `import type` erases it at runtime. `scripts/checks/package-boundary-checks.mjs:105-116` already forbids two specific `app/` imports from adapters (`runtime-lifecycle`, `create-runtime-services`) but not the rest of `app/`, which is how this slipped through.

### Proposal

1. Define the context shapes where they are consumed: `adapters/contexts.ts` (or per-adapter-group files `adapters/http/contexts.ts`, `adapters/ws/contexts.ts`) exporting explicit interfaces (`HttpAuthContext`, …). The composition root `create-server-adapter-contexts.ts` imports those and returns objects that satisfy them (`satisfies ServerAdapterContexts`). Dependency direction becomes `app → adapters`.
2. Replace `ServerAdapterContexts["http"]["auth"]` in the 22 adapter files with the named interface.
3. Tighten the boundary check to a general rule: a file under `packages/workbench-server/src/adapters/` must not resolve to anything under `src/app/` (type or value), replacing the two special cases. Add a case in `scripts/checks/test/` for it.

Mechanical, no behavior change. **Effort:** S-M (22 files, mostly one import line each).

---

## (h) Splitting `ToolCallService` and `ProcessPort.start`

### `ToolCallService`

`conversation-core/src/tool-calls/tool-call.service.ts` (635 lines) mixes exported types (`ToolCallChange` line 34, `AsyncBashAdopter` line 50, `ToolCallServiceOptions` line 59), the admission/execution pipeline, and the "promote a backgrounded tool to async bash" step (lines ~511-560: `result.kind === "backgrounded"` → `asyncBash.adopt` → asset linking → `asyncBashId` on the tool result). Direction:

- Move the types to `tool-call.types.ts`; `tool-call-interactions.service.ts` currently imports `ToolCallServiceOptions` from the service, a cycle between the service and its helper, which this fixes.
- Extract `BackgroundPromotion` (`tool-calls/background-promotion.ts`): given a `backgrounded` result, cancel-on-abort, adopt, and produce the final result payload. It is the natural seam to the `BackgroundJobService` in `background-jobs.md`, so do these in order: extract first, then replace its inner `adopt` with the unified service.
- Interaction handling follows `interaction-handlers.md`.

### `ProcessPort.start`

`conversation-core/src/ports.ts:119-140`: one call starts the process, captures output, **and** performs readiness detection (`ready?: ProcessReadiness`, `timeoutMs?`), returning `{ process, readiness? }`. Readiness (URL polling, URL detection, output pattern) is a policy over a running process, not part of spawning it, and it forces every host to implement three readiness strategies inside `start`. `AsyncBashService.start` also carries the awkward start-then-adopt-or-cancel `try/catch`.

Proposed split:

```ts
interface ProcessPort {
  start(input: StartInput /* no ready */): Promise<BackgroundProcess>;
  reattach(ref: string): Promise<BackgroundProcess | null>;
}
// conversation-core owns it, host-independent:
function awaitReadiness(
  process: BackgroundProcess,
  ready: ProcessReadiness,
  signal: AbortSignal,
): Promise<ReadinessResult>;
```

`awaitReadiness` needs the process's output stream/files (already `outputFiles` on `BackgroundProcess`) plus a `fetch`-style probe for `kind: "url"`, injected. Host (workbench-server) code that currently implements readiness moves into conversation-core's `ready.ts`, deleting the duplicated logic on the host side. Check that the host process adapter's implementation does not rely on spawn-time hooks for pattern detection (output must be observable from the start; use `outputFiles` + a tail reader, or a `onOutput` subscription on `BackgroundProcess`).

**Effort:** S for the type extraction, M for the readiness split.

---

## (i) Oversized backend files: decomposition direction

No rewrites; split along existing seams, one PR each, behavior-preserving, with tests unchanged.

- `tools/src/git/git-service.ts` (1627 lines): divide by capability — `git-status.ts` (status/branches), `git-diff.ts`, `git-commit.ts` (stage/commit/amend), `git-history.ts` (log/show/blame), `git-stash.ts`, `git-remote.ts` (fetch/push/pull), plus a thin `GitService` facade that composes them over the shared `runGit` executor and parsing helpers. Public surface and `index` exports stay identical.
- `tools/src/git/git-github-service.ts` (1126): separate `gh` process execution/JSON parsing from PR, checks and review operations (`git-github-pr.ts`, `git-github-checks.ts`), and move result mappers to `git-github-mappers.ts` where they can get pure unit tests.
- `harness/src/harness/agent-harness.ts` (976): extract the turn loop, tool-execution orchestration and message/queue management into collaborators held by `AgentHarness`; start with whichever has no shared mutable state (tool execution dispatch, retry policy). Re-read the file for the real seams before cutting; do not split by line count.

**Effort:** M each. Lowest priority; do opportunistically alongside feature work in these files.

---

## (j) Tool risk vocabulary unification

### Problem

Two risk enums describe the same concept and both ride on every tool descriptor:

- `staticToolRiskSchema` (`contracts/src/domains/permissions/permission-rule-sets.ts:37`): the policy-facing vocabulary (`read`, `write`, `network`, …), used by rule sets (`baseRisks`, line 260; `baseRisk`, line 429).
- `toolRiskSchema` (`contracts/src/domains/permissions/permissions.ts:4`): the older display vocabulary (`read`, `workspace_write`, `command`, …).

`toolDescriptorSchema` in `contracts/src/domains/tools/records.ts` has both: `baseRisk: staticToolRiskSchema` (line 49) and `/** @deprecated Use baseRisk. */ risk: toolRiskSchema` (line 52). They are populated from different sources in the same function: `tools/src/catalog/descriptors.ts:27` sets `baseRisk: metadata.baseRisk` (permission metadata) and `risk: definition.baseRisk` (the tool definition), so two tables can disagree. `tools/src/runtime/runtime-tool-permission.ts:60` has a `toolRisk(StaticToolRisk): ToolRisk` mapping, a second translation, and the UI consumes the deprecated one: `workbench-app/src/lib/app/composition/conversations/WorkbenchComposerAdapter.svelte:228` builds `conversationCatalog.toolRisks` from `tool.risk`, which feeds `features/conversations/adapters/core-transcript.adapter.ts` and `presentation/tools/tool-call/ApprovalPrompt.svelte` (`riskTone`).

### Proposal

Prefer **one vocabulary**: keep `staticToolRiskSchema` (it is the one permission rules and policy already use), delete `toolRiskSchema` and the descriptor's `risk` field.

- The UI maps `baseRisk` to a tone in one function placed next to `riskTone` (presentation owns tone; contracts owns the enum).
- If the display needs distinctions `StaticToolRisk` does not have (for example, effective risk after argument-sensitive classification: `effectiveRisk` already exists on `supervisionSchema` in `core/tool-call.ts`), the call-time field uses the same enum widened by the specific values, not a second enum.
- If removing `toolRiskSchema` outright is too large, fallback: keep a single exported `staticToRiskDisplay(risk): ToolRisk` mapping in `contracts/permissions` (replacing the private copy in `runtime-tool-permission.ts:60`) and compute `risk` from `baseRisk` in the descriptor builder so they cannot disagree. This is a smaller step on the way to deletion.

### Migration

1. Inventory `ToolRisk`/`toolRiskSchema` users (`grep` shows contracts, tools runtime, workbench-server permission code, app). Decide per use whether it needs the enum at all.
2. Switch the app to `tool.baseRisk` (`WorkbenchComposerAdapter.svelte`, `conversation-catalog.svelte.ts`, `core-transcript.adapter.ts`, `ApprovalPrompt.svelte`).
3. Remove `risk` from `toolDescriptorSchema` and `descriptors.ts`; remove the mapping in `runtime-tool-permission.ts`; delete `toolRiskSchema` if unused.

### Storage / wire impact

Descriptors are served over the API, not persisted, as far as `records.ts` shows. **Verify** whether `ToolRisk` values are stored anywhere (tool call records, supervision `effectiveRisk`, stored permission rules, replayed events). If `toolRiskSchema` values appear in persisted events or rules, removing it is a stored-data change **[approval]**, to be handled in the single pending migration step. If they appear only in the live descriptor, it is a normal contract change shipped with the app in lockstep.

**Effort:** S-M.

---

## Suggested order

1. (g), (e), (b-Atlassian): small, self-contained, no behavior risk.
2. (a) then (d): shared path parser first, then registry using it.
3. (j), (h), (f): contract and structure work; coordinate (h) with `background-jobs.md` and `interaction-handlers.md`.
4. (c) and (b-readers): security and data-handling reviews.
5. (i): opportunistic.
