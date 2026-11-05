# Backend hardening and structure

> **Status:** Proposal. A grouped set of small-to-medium backend items from the code-quality review. Each item is independent, can ship alone, and lists its own risk. Items that touch persisted data or wire formats are flagged **[approval]**. None of the items require a DB schema change. Authentication for remote, self-hosted and mobile access is a separate proposal, [`remote-access-authentication.md`](remote-access-authentication.md); items (c) and (d) touch its edges.

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

## (c) Local token hygiene (phase 0 of remote-access authentication)

> A broader authentication redesign for remote, self-hosted and mobile access is covered in [`remote-access-authentication.md`](remote-access-authentication.md). This item is deliberately small: it is that proposal's **phase 0**, a set of hygiene fixes that ship independently and do not change how the desktop shell, share links or the mobile QR flow work.

### Problem

The daemon's local token is accepted and re-emitted via query string in several places:

- `workbench-server/src/app/server.ts:23-41` `remoteUiAuthRedirect` (also called from `app/lifecycle/boot-app.ts:38`): any request with `?token=<localToken>` gets a 302 to the same URL without the token and a long-lived cookie (`Max-Age=31536000`, `cookieHeader` in `adapters/http/auth-middleware.ts:85`, already `HttpOnly; SameSite=Strict`, `Secure` on HTTPS). So the address bar is already cleaned on this path.
- `server.ts:44-62` `mobileSetupPage`: validates `?token=` and _re-emits_ it into the secure app URL (`secureAppUrl.searchParams.set("token", ...)`), so the token travels into another generated URL and onto a page that renders links.
- `adapters/http/auth-middleware.ts:97` `isWebSocketAuthorized`: accepts `url.searchParams.get("token")` for every WebSocket upgrade.
- `desktop-shell/src/daemon/urls.ts:76,94,100`: builds the share URL, secure share URL and mobile-setup URL with the token embedded.
- No response sets `Referrer-Policy` for these routes (the only occurrences are the HTML preview routes: `adapters/http/routes/html-preview-routes.ts:64`, `domains/filesystem/html-preview.service.ts:258`). The mobile-setup page, loaded at a URL that contains the token, can therefore leak it through `Referer` to anything it links or loads.

### Proposal: small, compatible fixes

Decision: keep desktop share links and the mobile QR (`desktop-shell/src/daemon/urls.ts:69-100`) working exactly as today. Do not introduce one-time bootstrap codes here; that belongs to the broader auth proposal.

1. **Strip from the address bar after exchange.** Already true for `remoteUiAuthRedirect`; make it the _only_ place a `?token=` request is accepted for UI routes, and keep the redirect path free of any body.
2. **`Referrer-Policy: no-referrer`** on every response from the token-bearing routes: the `remoteUiAuthRedirect` 302, `mobileSetupPage` (success and 401), and the CA download. Simplest: one Hono middleware in `server.ts`/`boot-app.ts` for non-API HTML routes, and the header set directly on the 302.
3. **Stop re-emitting the token into other generated URLs.** `mobileSetupPage` redeems the token itself: its response sets the same cookie (`cookieHeader`) and the "open the app" link becomes `https://host:port/` with no `token` parameter. Cookies are not port-isolated, so a cookie set on the setup origin is sent to the secure origin on the same host; the HTTPS redirect then re-sets it with `Secure`. **Verify on a real phone (iOS Safari, Android Chrome)** before dropping the fallback: if a browser does not carry the cookie across, keep `?token=` on the secure URL only for the mobile-setup hand-off and record that exception in the auth proposal.
4. **WebSocket query token.** Audit callers (`pnpm dev:ui` proxy, desktop shell, scripts; a repository search finds no client code that builds `?token=` for WebSockets) and remove `searchParams.get("token")` from `isWebSocketAuthorized` if none exist. If one does, leave it and track it in the auth proposal.
5. Cookie lifetime (one year for a bearer-equivalent secret) is left to the auth proposal.

### Risks

- **Dev flows**: `pnpm dev:ui` and dev proxies that inject bearer tokens (see the comment in `auth-middleware.ts:34`) must keep working; check `scripts/` for URLs with `?token=`.
- Mobile cookie hand-off (step 3) is the only behavior change visible to users; it needs a device test.
- No DB change. Security-sensitive: focused review of the headers and mobile-setup route.

**Effort:** S.

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
- Authentication: main's calls to the daemon use the desktop token it already holds. If the auth proposal ([`remote-access-authentication.md`](remote-access-authentication.md)) changes how the desktop shell authenticates to the daemon, `KnownProjectRoots` should consume that client rather than reading the token itself.

**Effort:** M.

---

## (e) Git read-only shell classification as an allowlist

### Problem

`tools/src/policy/shell/assessment.ts:51` treats any segment whose root is `git` as read-only (`if (root === "git") return true;`), after `isBlockedCommandSegment(tokens)` has run `isBlockedGitInvocation` (`tools/src/policy/shell/git-rules.ts:62`, called from `plan-mode.ts:95`). That is a blocklist (`BLOCKED_GIT_SUBCOMMANDS`: `add, am, apply, bisect, checkout, cherry-pick, clean, clone, commit, fetch, gc, init, merge, mv, pull, push, rebase, reflog, reset, restore, revert, rm, stash, submodule, switch, tag, worktree`) plus special cases for `branch` (only `-d/-D/-m/-M/--delete/--move`), `config` (needs a read flag), `diff` (`--output`) and `remote` (only `get-url`/`show`/no action). It fails open:

- Any subcommand not listed is "read-only": `git archive -o`, `git format-patch -o`, `git update-ref`, `git update-index`, `git symbolic-ref HEAD x`, `git hash-object -w`, `git notes add`, `git filter-branch`, `git replace`, `git prune`, `git repack`, `git maintenance`, `git sparse-checkout`.
- `git branch new-name`, `git branch -c`, `git branch -f`, `git branch --set-upstream-to` create or modify refs but are not in the `branch` deny set.
- `getGitSubcommandIndex` skips `-c <k=v>` (and `-C`, `--git-dir`, `--work-tree`, `--namespace`) and any other leading `-` option, so `git -c core.pager=cmd ...`, `git -c alias.x='!cmd' x`, `--exec-path=...` are classified by the subcommand alone.
- `git log|show --output=file` and `git grep -O/--open-files-in-pager` (runs a command) are not denied; `git diff --ext-diff` runs an external program.

### Proposal

Invert it: an explicit table of allowed subcommands, each with allowed forms or flags. Anything not in the table, and any global option outside a small safe set, is not read-only and falls to the existing approval path (`unsupported(...)`). Unknown is safe by default; the cost is an approval prompt for rare read commands, which users can allow by rule.

```ts
interface GitReadRule {
  /** Positional forms permitted as first argument (e.g. stash: list | show). Absent = any. */
  forms?: readonly string[];
  /** If set, every flag must be in this set (config, branch, tag). */
  onlyFlags?: readonly string[];
  /** Flags that run a program or write a file, denied even in otherwise-read subcommands. */
  denyFlags?: readonly (string | RegExp)[];
}

const GLOBAL_DENY = [
  /^--output(=|$)/,
  "--ext-diff",
  "--open-files-in-pager",
  "-O",
  "--exec-path",
];
const SAFE_GLOBAL_OPTIONS = [
  "-C",
  "--no-pager",
  "--paginate",
  "--no-optional-locks",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--bare",
];

const READ_ONLY_GIT: Record<string, GitReadRule> = {
  status: {},
  log: {},
  diff: {},
  show: {},
  reflog: { forms: ["", "show"] }, // not expire | delete | exists
  shortlog: {},
  describe: {},
  blame: {},
  "rev-parse": {},
  "ls-files": {},
  "ls-tree": {},
  "cat-file": { onlyFlags: ["-p", "-t", "-s", "-e"] },
  grep: {},
  "show-ref": {},
  "merge-base": {},
  "name-rev": {},
  "for-each-ref": {},
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
      "--no-contains",
      "--merged",
      "--no-merged",
      "--points-at",
      "--sort",
      "--format",
    ],
  },
  tag: {
    onlyFlags: [
      "--list",
      "-l",
      "-n",
      "--contains",
      "--no-contains",
      "--merged",
      "--no-merged",
      "--points-at",
      "--sort",
      "--format",
    ],
  },
  remote: { forms: ["", "-v", "show", "get-url"] },
  config: {
    onlyFlags: [
      "--get",
      "--get-all",
      "--get-regexp",
      "--list",
      "-l",
      "--name-only",
      "--show-origin",
      "--local",
      "--global",
      "--system",
      "--worktree",
      "--type",
      "--default",
      "-z",
      "--null",
    ],
  },
  worktree: { forms: ["list"] },
  stash: { forms: ["list", "show"] },
};
```

Rules: the subcommand must be in the table; `-c`/`--config-env`/`--exec-path` and any other leading option not in `SAFE_GLOBAL_OPTIONS` make the invocation non-read-only; `GLOBAL_DENY` flags are rejected for every subcommand; a `branch`/`tag` invocation with a positional argument is a creation, so it is allowed only together with a list flag (`git branch --list 'feat/*'`, `git tag -l 'v*'`).

### Classification changes versus today

Verified against `git-rules.ts` behavior:

| Command                                                                                                                                                                                                          | Today                                                  | With the table                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| `git reflog`, `git reflog show`                                                                                                                                                                                  | blocked (listed)                                       | **read-only** (`expire`, `delete`, `exists` stay non-read-only)    |
| `git worktree list`                                                                                                                                                                                              | blocked (listed)                                       | **read-only** (`add`, `remove`, `move`, `prune`, `lock` still not) |
| `git stash list`, `git stash show`                                                                                                                                                                               | blocked (listed)                                       | **read-only** (`push`, `pop`, `drop`, `apply`, `clear` still not)  |
| `git tag`, `git tag -l/--list/-n/--contains`                                                                                                                                                                     | blocked (listed)                                       | **read-only** (`git tag v1`, `-d`, `-a`, `-f` still not)           |
| `git shortlog`, `describe`, `blame`, `ls-files`, `ls-tree`, `show-ref`, `merge-base`, `name-rev`, `for-each-ref`, `grep`, `rev-parse`, `cat-file -p/-t/-s`                                                       | read-only (unlisted)                                   | unchanged, now explicit                                            |
| `git branch <name>`, `-c`, `-C`, `-f`, `--set-upstream-to`, `-u`, `--unset-upstream`, `--edit-description`                                                                                                       | read-only (only `-d/-m` family blocked)                | **needs approval**                                                 |
| `git remote -v` / `git remote`                                                                                                                                                                                   | read-only                                              | unchanged                                                          |
| `git remote add/remove/rename/set-url/update/prune`                                                                                                                                                              | blocked                                                | unchanged                                                          |
| `git config` with a write flag mixed with a read flag (e.g. `--get x --unset`, `--list --edit`)                                                                                                                  | read-only (any one read flag suffices)                 | **needs approval** (every flag must be a read flag)                |
| `git log                                                                                                                                                                                                         | show --output=f`, `git diff --ext-diff`, `git grep -O` | read-only                                                          | **needs approval** |
| `git -c k=v <read>`, `git --exec-path=... <read>`, other unknown global options                                                                                                                                  | read-only                                              | **needs approval**                                                 |
| `git archive`, `format-patch`, `update-ref`, `update-index`, `symbolic-ref`, `hash-object`, `notes`, `replace`, `prune`, `repack`, `maintenance`, `sparse-checkout`, `fsck`, `lfs`, any alias/unknown subcommand | read-only (unlisted)                                   | **needs approval**                                                 |
| `git checkout`, `switch`, `reset`, `clean`, `commit`, `push`, `merge`, `rebase`, ...                                                                                                                             | blocked                                                | unchanged                                                          |

### Plan mode shares the code

`isBlockedGitInvocation` is also consumed by `plan-mode.ts:95` through `isBlockedCommandSegment`, so plan-mode bash gets the same inversion: a git command is allowed in plan mode only if the table says read-only. That makes plan mode strictly safer, but newly allows `git reflog`, `git stash list`, `git worktree list` and `git tag -l` there. Keep one function, `isReadOnlyGitInvocation(tokens)`, and define `isBlockedGitInvocation = isGit && !isReadOnlyGitInvocation` so both call sites agree.

### Migration

1. Add the table and `isReadOnlyGitInvocation` in `git-rules.ts`; keep `getGitSubcommandIndex` for the global-option scan.
2. Extend `tools/test/policy/command-policy.test.ts` (the existing git cases at lines ~133-155 are the baseline): one differential case per row of the table above, in particular every "needs approval" row, and the compound-command forms (`git -C . status && git diff --stat`).
3. Switch `assessment.ts:51` to `isReadOnlyGitInvocation` and delete the blocklist set and the special-case branches in `git-rules.ts`.

**Risk:** more approval prompts for niche read commands; the table is generous on purpose to keep that rare. **Effort:** S.

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
- Extract `BackgroundPromotion` (`tool-calls/background-promotion.ts`): given a `backgrounded` result, cancel-on-abort, adopt, and produce the final result payload. It is the natural seam to the `BackgroundTaskService` in `background-jobs.md`, so do these in order: extract first, then replace its inner `adopt` with the unified service.
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

## (j) Tool risk vocabulary: two concepts, one shared mapping

### Problem

Two risk enums exist and are easy to mistake for duplicates. They are **not**; they are two concepts with a missing shared mapping between them:

- **`StaticToolRisk`** (`staticToolRiskSchema`, `contracts/src/domains/permissions/permission-rule-sets.ts:37`: `read, write, network, secret, destructive, deployment, agent_spawn, interaction, unknown`): the **static category** of a tool, used by rule sets (`baseRisks`, line ~260; `baseRisk`, line ~429) and `permissionMetadataForTool(name).baseRisk` (`tools/src/catalog/permission-metadata.ts`).
- **`ToolRisk`** (`toolRiskSchema`, `contracts/src/domains/permissions/permissions.ts:4`: `read, workspace_write, command, network, secret, destructive, agent_spawn, deployment, interaction`): the **effective risk of one call**. It is **persisted**: `supervisionSchema.effectiveRisk: toolRiskSchema.optional()` (`contracts/src/domains/core/tool-call.ts:70`) is written into the `supervision` JSON column of the `tool_call` table (`conversation-core/src/storage/schema.ts:55`), set by `classifyToolRisk` (`tools/src/catalog/manifest.ts:144`, which calls the per-tool `classifyRisk`: `classifyCommandRisk` in `shell.tools.ts:68` via `assessShellCommand`, plus jira/confluence/`orchestration/process.tools.ts`, falling back to the definition's `baseRisk`) in `workbench-server/src/core-host/scoped-permission-source.ts:354`. The app reads it back (`core-transcript.adapter.ts:271`, `presentation/cards/lead-chip.ts:112-118`).

Because the enums differ in more than names (`write` vs `workspace_write`, `unknown` vs `command`), converting between them needs a table, and today there are three half-copies of it:

1. `tools/src/runtime/runtime-tool-permission.ts:60` private `toolRisk(StaticToolRisk): ToolRisk` (`write`→`workspace_write`, `unknown`→`command`, otherwise identity).
2. The deprecated `risk: toolRiskSchema` field on `toolDescriptorSchema` (`contracts/src/domains/tools/records.ts:52-53`), populated in `tools/src/catalog/descriptors.ts:27` from `definition.baseRisk` (a `ToolRisk` on the tool definition) while the sibling `baseRisk` on the same descriptor comes from `metadata.baseRisk` (a `StaticToolRisk`). Two tables describe one tool and can disagree.
3. The app's `conversationCatalog.toolRisks` (`WorkbenchComposerAdapter.svelte:227-229`, `features/conversations/state/conversation-catalog.svelte.ts:5`) is built from that deprecated `tool.risk` and feeds `core-transcript.adapter.ts:205,266,539` and `ApprovalPrompt.svelte` (`riskTone`, line 84).

### Proposal

Keep both enums; document and connect them.

- **Names and docs.** Document `StaticToolRisk` as the _static category_ (what rule sets match on) and `ToolRisk` as the _effective risk_ (what a specific call was classified as, persisted in supervision). A comment on each schema states the relationship and points at the mapping.
- **One shared mapping in contracts.** Move `toolRisk()` out of `tools/src/runtime/runtime-tool-permission.ts:60` into `contracts/src/domains/permissions/` as an exported `effectiveRiskForCategory(risk: StaticToolRisk): ToolRisk` (pure, with a table test covering every `StaticToolRisk` value). `runtime-tool-permission.ts` imports it.
- **Delete the deprecated descriptor field.** Remove `risk` from `toolDescriptorSchema` (`records.ts:52-53`) and its population in `tools/src/catalog/descriptors.ts:27`. Descriptors are served over the API and not persisted, so this is a normal contract change shipped with the app.
- **App display risk.** The app derives the display risk from `baseRisk` through the shared mapping (`effectiveRiskForCategory(tool.baseRisk)`) when building `conversationCatalog.toolRisks`, and prefers the call's own `supervision.effectiveRisk` when present (already available on the call record, so `ApprovalPrompt`/`lead-chip` show the argument-sensitive value, for example a `bash` call classified `read`). The mapping import is allowed in the app (it already uses contracts); presentation still owns tone (`riskTone`).
- **`definition.baseRisk` on `ToolDefinition`** keeps the `ToolRisk` type (it is the fallback for `classifyToolRisk`); no change.

### Storage / wire impact

**None for persisted data.** `effectiveRisk` values are `ToolRisk`, unchanged; `toolRiskSchema` stays. No migration, no schema change. The only wire change is the removed descriptor `risk` field (API response, app and server ship together).

### Migration

1. Add `effectiveRiskForCategory` + table test in contracts; switch `runtime-tool-permission.ts` to it.
2. Switch `WorkbenchComposerAdapter.svelte` to build `toolRisks` from `baseRisk` via the mapping; let transcript adapters prefer `supervision.effectiveRisk`.
3. Remove `risk` from `toolDescriptorSchema` and `descriptors.ts`; fix tests/fixtures that set it.

**Effort:** S.

---

## Suggested order

1. (g), (e), (b-Atlassian): small, self-contained, no behavior risk.
2. (a) then (d): shared path parser first, then registry using it.
3. (j), (h), (f): contract and structure work; coordinate (h) with `background-jobs.md` and `interaction-handlers.md`.
4. (c) and (b-readers): security and data-handling reviews.
5. (i): opportunistic.
