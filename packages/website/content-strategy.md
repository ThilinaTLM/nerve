# Nerve public website: content-first implementation plan

> **Editorial status (2026-11-02):** Pre-release refresh for 0.38.0, grounded in the verified fact sheet and source rather than the last release number. It covers agent profiles (replacing modes), live pull requests with linked conversations, presence-aware Notifications, the folder browser and drag-to-open, grouped conversation discovery with opt-in AI titles, quoting and the selection toolbar, the single five-theme picker, the compact mobile composer, safer upgrades, and the Launches refresh button. The docs are reorganized around user tasks (see “Documentation navigation” and “Redirect map”). Screenshots are being regenerated; this note does not certify every image or page as reviewed. Existing profile-based subagents, launch configurations, and async Bash remain part of the product story.

> **Reading this record:** The evidence inventory, claim guardrails, and page briefs are maintained editorial guidance. Initial framework/hosting decisions and the explicitly historical implementation plan record the site’s original rollout, not pending work or current design/validation requirements. Exact dependency versions belong to `package.json`.

## Objective and outcome

Maintain the private workspace package, `packages/website`, as a static public site at `https://nerve.tlmtech.dev`. The site will combine a concise marketing homepage with comprehensive, task-oriented product and developer documentation. Content discovery and claim correction come first; visual customization remains intentionally minimal until the documentation corpus is coherent and reviewed.

This plan supersedes the earlier “strategy only” boundary because the product owner explicitly approved beginning the website package, while retaining the requirement that content quality take priority over styling.

## Decisions

### Framework

Use **Astro + Starlight** with static output; exact versions are recorded in the package manifest.

- **Chosen: Starlight with a custom Astro homepage.** It provides accessible documentation navigation, full-text search, table of contents, Markdown/MDX, code rendering, mobile behavior, SEO metadata, and linkable headings without building a documentation shell. A custom `src/pages/index.astro` supplies a focused marketing page.
- **Rejected: fully custom Astro documentation UI.** It offers more visual control but would spend the first iteration on navigation, search, accessibility, and responsive behavior rather than content.
- **Rejected: a second-site generator or root `docs/` GitHub Pages source.** This would either add an unnecessary framework mismatch or mix deployable website source with repository engineering documents. GitHub Pages does not require root `docs/`.

The initial selection used Astro 7 and Starlight 0.41.5. Read `package.json` and the lockfile for current exact versions; this planning record is not a dependency catalog.

### Hosting and URL

- Publish through GitHub Pages as part of the tagged Release workflow.
- Set Astro `site` to `https://nerve.tlmtech.dev` with no `base` path.
- Add `packages/website/public/CNAME` containing `nerve.tlmtech.dev`.
- External setup required after merge: configure Cloudflare DNS `nerve` as a CNAME to `thilinatlm.github.io` (DNS-only while GitHub validates), choose **GitHub Actions** as the Pages source, set the custom domain, then enable HTTPS. These are deployment operations, not repository code.

### Content ownership

- `packages/website/src/content/docs/` is canonical for all public user, operations, integration, troubleshooting, architecture, protocol, and developer-reference prose.
- `packages/website/diagrams/` owns editable architecture sources; generated SVGs in `packages/website/public/diagrams/` are website assets.
- `packages/website/content-strategy.md` records the evidence inventory, editorial priorities, migration map, known claim constraints, and page backlog. It is package planning material, not a public page.
- Root `docs/` is reserved for maintainer and development workflow documents such as release engineering and performance profiling.
- `README.md` remains a concise repository landing page and quick start. It links to the website for detail instead of duplicating guides.
- Source schemas, catalogs, implementation, and focused tests remain authoritative for changing API/tool/limit behavior. Public prose explains those behaviors but is not an independent schema catalog.

### Initial editorial scope (historical)

Publish comprehensive first-pass pages, not placeholder stubs. Where behavior remains uncertain, make the initial copy conservative and explicit rather than publishing broad capability claims. Add no blog, analytics, newsletter, CMS, internationalization, version switcher, or elaborate animation in this phase.

## Evidence-backed feature inventory

This package-level inventory is the durable editorial source. Priorities are **P0** (getting started, safety, or defining value), **P1** (important daily workflow), and **P2** (advanced/reference).

### Workbench and conversation experience

| Capability                                    | User value                                                                                                  | Confirmed evidence                                                                                   | Constraints / accurate wording                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Priority |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Multi-project navigator and conversation tree | Move among repositories and sessions without losing context                                                 | `ProjectConversationNavigator.svelte`; folder browser; `project.service.ts`                          | Projects are directory-backed records; canonical paths are deduplicated. “Current project” is client selection, not global server state. Open a project from the folder browser (Places, path bar, filter, New folder), by dragging a folder onto the title bar, or with the native folder dialog on desktop with a local daemon; the switcher keeps recent projects.                                                                                                                                                                                            | P0       |
| Persistent center tabs                        | Keep conversations, files, PRs, command output, launch logs, auth, and settings together                    | `EditorSurface.svelte`; shell tab state; `AsyncBashOutputPane.svelte`                                | Notes are a dock panel. Background command output and launch-run logs are distinct views.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | P1       |
| Movable/resizable docks                       | Shape the workbench around the work                                                                         | `app/composition/registries/panel-registry.ts`; `WorkbenchShell.svelte`                              | Six registered views: Conversations, Files, Git Changes, Pull Requests, Launches, Scratch Notes. Layout persists locally; Context is not a registered dock.                                                                                                                                                                                                                                                                                                                                                                                                      | P1       |
| Responsive/mobile workbench                   | Use the same UI in browser, tablet, or phone                                                                | `MobileWorkbenchHost.svelte`; mobile navigation and screen primitives                                | Compact below 1024px; below 640px, Inbox, Projects, and Activity are the three primary tabs. Project home contains conversations, Workspace tools, and Repository links; Workspace is a section, not a tab. Mobile access still needs a reachable, secured daemon.                                                                                                                                                                                                                                                                                               | P1       |
| Rich streaming transcript                     | See text, thinking, calls, outputs, approvals, questions, plans, command activity, compaction, and failures | `TranscriptList.svelte`; `TranscriptRow.svelte`; stream projections                                  | Virtualized and replay-aware; do not imply hidden reasoning is available when a provider does not return it.                                                                                                                                                                                                                                                                                                                                                                                                                                                     | P0       |
| Conversation history graph and branches       | Inspect decisions and continue from an earlier point                                                        | `ConversationHistoryGraph.svelte`; `navigation-service.ts`; active-entry lineage                     | Navigation changes the active branch. “Fork” is branch navigation, not a separate generic clone button. Optional summaries are local/extractive.                                                                                                                                                                                                                                                                                                                                                                                                                 | P1       |
| Edit and resend prior prompts                 | Correct or branch from an earlier instruction                                                               | `ConversationShell.svelte:editConversationEntry`                                                     | Editing navigates to the parent and loads text into the composer; it does not send automatically.                                                                                                                                                                                                                                                                                                                                                                                                                                                                | P1       |
| Retry and recovery                            | Recover from provider or daemon failure                                                                     | conversation-core `runtime/conversation-runner.ts`; `runtime/recovery.ts`                            | Restart recovery reconciles tools, queued inputs and async Bash, marks interrupted execution, and wakes deliverable input. It does not restart providers merely to repair an old execution; avoid retired checkpoint-route claims.                                                                                                                                                                                                                                                                                                                               | P0       |
| Conversation history backup                   | Preserve local history                                                                                      | `contracts/src/domains/core/core-operations.ts`; core storage; storage migration implementation      | Current operations expose history/tree retrieval, not conversation bundle import or JSON/Markdown/HTML export. Back up the complete stopped Nerve home and project directories separately; retired export formats are not a supported workflow.                                                                                                                                                                                                                                                                                                                  | P2       |
| File view and editor                          | Inspect files and make focused text edits                                                                   | `FilePane.svelte`; filesystem routes                                                                 | Small regular in-project text files are revision-checked and editable; external, linked, binary, truncated, and >1 MiB files remain read-only.                                                                                                                                                                                                                                                                                                                                                                                                                   | P1       |
| Context indicators and usage meter            | Understand model context pressure                                                                           | Composer context/usage components                                                                    | Usage may remain unknown until provider usage arrives. Do not advertise a Context dock; the panel registry is authoritative.                                                                                                                                                                                                                                                                                                                                                                                                                                     | P1       |
| Project scratch notes                         | Keep lightweight project-specific notes                                                                     | `NotesPanelView.svelte`; conversation-core `scratch-note.repository.ts`                              | Notes live in a docked panel and core storage, not repository files or center tabs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | P2       |
| Git workbench                                 | Review changes and manage repositories while remote work runs                                               | `GitPanel.svelte`; `git-remote-actions.ts`; Git operation services                                   | Repository chips, staged/unstaged scope actions, diffs, stash, branch actions, background fetch/pull/push/sync, and multi-repository actions. Cancel does not roll back completed effects. Destructive actions use confirmation.                                                                                                                                                                                                                                                                                                                                 | P1       |
| GitHub PR workbench                           | Review, check out, and merge PRs                                                                            | `GitHubPrPane.svelte`; `pr-resource-loader.ts`; GitHub routes/service                                | Requires a GitHub remote and authenticated `gh`. Conversation/Commits/Checks/Files load independently; section retries retain usable content and failures report to header Notifications. PRs stay live: the daemon keeps a shared snapshot fresh with conditional GitHub requests, refreshes after pushes, merges, and agent `gh pr create`, and backs off on rate limits. The details pane shows a merge-state header, activity, linked conversations, commits by day, live checks, unified diffs, and merge. Workbench UI/server behavior, not an agent tool. | P1       |
| Launch configurations and run logs            | Reuse project commands for servers and watchers                                                             | `launch-definition.ts`; `launch-definition.service.ts`; `launch.service.ts`; `launch-log.service.ts` | User-managed project definitions; single/concurrent run policies and separate run history/logs. Agents operate existing definitions through `launch`, not create/edit them.                                                                                                                                                                                                                                                                                                                                                                                      | P1       |
| App logs, diagnostics, storage cleanup        | Inspect and maintain local state                                                                            | `NerveLogsPane.svelte`; log/storage routes; crash reports                                            | Logs are queryable/prunable; crash reports are files, not browsable through a dedicated crash-report UI. Cleanup cancellation occurs between targets.                                                                                                                                                                                                                                                                                                                                                                                                            | P1       |
| Themes, zoom, shortcuts, notifications        | Adapt the workbench and stay aware of completion                                                            | appearance/shortcut/notification state                                                               | One Theme picker (Settings → Workbench → Appearance) with five themes: Nerve Light, Nerve Dark (default), Melange Light, Melange Dark, Graphite; stored per client, with no System/light/dark setting. Retired themes migrate automatically and are never named. Zoom is a daemon setting (-8…8); bindings are currently fixed; notification preferences live in Settings → Notifications; sound is separate.                                                                                                                                                    | P2       |

The header bell opens the **Notifications** popover (sections: Needs you, Running, Finished, plus a System heading for notices). Entries have inline actions (Open, Stop, Retry, Delete all, ×). Clearing or stopping does not undo completed effects. **Mute 1 h** / **Unmute** silences sounds, toasts, and system pop-ups in this window for an hour.

- Presence-aware delivery: nothing is shown while you watch that conversation; a toast appears when you are elsewhere in the app; an OS notification appears when you are away (window unfocused or no input for 60 s).
- Unseen-result indicators mark finished or failed conversations you have not looked at; the desktop app shows a badge.
- Preferences: Settings → Notifications (General, Sounds).

### Conversation discovery, titles, and references

- The conversation list is searchable and grouped: Needs you, Pinned, Today, Yesterday, Previous 7 days, Older. Status rails show state; conversations can be marked complete.
- **AI titles** are opt-in (Settings → Titles). Every new conversation gets an instant local title; the AI title replaces it once in the background and never overrides a name you set.
- GitHub PR and issue references mentioned in a conversation are extracted and linked; the PR details pane lists linked conversations.
- Closing the window **quits** by default. Settings → Workbench → Desktop has an opt-in **Close to system tray** toggle; running launches and processes stop when Nerve quits. Do not describe the tray as the default close behavior.

### Quote, mobile composer, upgrades, and launches

- **Quote:** selecting text in an assistant message shows a floating toolbar with **Quote** and **Quote & dictate** (mic only where voice is supported). Markdown is preserved (numbered lists, fences, tables, links); quote blocks are styled in the composer, and Backspace at the start turns one back into plain text.
- **Mobile composer:** narrow composers show model, a permission icon only when non-default, ⚙ conversation settings, todos, context, mic, and send/stop. Profile, permissions, and capabilities are reached through ⚙. On phones, popovers open as bottom sheets you can pull down to dismiss.
- **Streaming:** Markdown streams without transcript jumping; finished Mermaid diagrams stay put.
- **Safer upgrades:** a broken conversation or settings file is quarantined and reported once in Notifications. A corrupted project file offers **Open file**, **Reload**, and a confirmed **Reset** (saves cannot overwrite it); a file from a newer version is read-only; old project file names offer a confirmed **Remove old files**. Unreadable conversations appear in Notifications with per-row delete and **Delete all**.
- **Launches refresh:** the Launches header has a refresh button that reloads definitions edited outside Nerve.

Tool rendering uses shared argument/result regions across lifecycle stages, bounded previews, and on-demand details. Evidence: `ToolCallCard.svelte` and the lifecycle registry. Motion budgets reduce animation during bursts and respect reduced-motion preferences; do not claim a measured frame-rate improvement.

### Composer and human-in-the-loop controls

| Capability                                | User value                                                                  | Confirmed evidence                                                                                                     | Constraints / accurate wording                                                                                                                                                                                                                       | Priority |
| ----------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Text sending and stopping                 | Direct and interrupt work                                                   | `ComposerEditor.svelte`; `prompt-send.ts`; run-control tests                                                           | Enter and Ctrl/Cmd+Enter submit unless completion is open; stop targets the active run with race protection.                                                                                                                                         | P0       |
| Queued prompts                            | Redirect ongoing work without waiting for execution to finish               | conversation-core `inputs/input-queue.service.ts`; app `core-conversation-store.svelte.ts`                             | Prompts use `input.submit` and durable queued input, delivered at an eligible boundary (next turn by default); pending inputs can be cancelled through `input.cancel`. Do not describe the retired `run.steer` route.                                | P0       |
| `/` command completion                    | Discover inline commands                                                    | `ComposerEditor.svelte:completionSource`                                                                               | Completion list is host-supplied and capped with the shared completion result limit.                                                                                                                                                                 | P1       |
| `@` reference completion                  | Find project context without leaving the editor                             | `composer-reference-completions.ts`; `unified-completion-service.ts`; contracts `unified-completion.ts`                | Scopes `file:`, `pr:`, `issue:`, `skill:`, `tool:`, `agent:`, `launch:`; a bare `@` shows Recent; typed prefixes narrow results. Sources report freshness/availability. Selection never bypasses trust or permissions. Shared with question replies. | P1       |
| Desktop file/folder path drops            | Mention existing filesystem items without typing their paths                | `handleFileDrop`; `resolveDroppedPaths`; Electron preload                                                              | Electron only. Inserts editable path mentions at the selection; project items become relative, outside items remain absolute, and whitespace is quoted. It does not copy, upload, or attach items.                                                   | P1       |
| Clipboard image paste                     | Give image-capable models local image input                                 | `handlePaste`; `saveAttachment`                                                                                        | Clipboard images become OS-temp file paths. This is separate from path drops. No generic file picker, durable attachment UI, or thumbnail. MIME whitelist exists, but no size/signature guarantee.                                                   | P1       |
| Voice input                               | Dictate prompts and question responses                                      | voice session/controller; `ComposerDictationBridge`; `AskUserQuestion.svelte`                                          | Inline recording/transcription chip at the insertion point in both editors; one shared session. Requires ChatGPT OAuth, not an API key; 8 minutes, 25 MB, three client retries. Audio leaves the machine; Escape/right-click cancels.                | P1       |
| Prompt suggestions                        | Reuse contextual actions                                                    | suggestion app/server domain; `docs/prompt-suggestions.md`                                                             | Built-in/user/project precedence; JS predicates execute only after hash-bound trust approval.                                                                                                                                                        | P1       |
| Model/thinking/profile/permission toolbar | Change how the next model request works without recreating the conversation | `ComposerToolbar.svelte`; agent update routes/harness                                                                  | During a run, model/thinking changes apply to the next provider request. Choices depend on model metadata.                                                                                                                                           | P0       |
| Approval, question, and plan cards        | Resolve risky or ambiguous work explicitly                                  | conversation-core `tool-calls/tool-call-interactions.service.ts`; app composer availability and tool interaction views | Pending tool interactions require a matching resolution. Composer gating is a UI availability decision, not a blanket runtime input prohibition. Do not promise optional legacy plan actions (compact-first/new chat) from presentation props alone. | P0       |
| Context/todo indicators                   | See token pressure and active work state                                    | composer toolbar/context/todo components                                                                               | Usage may be unavailable; todos are agent-maintained task state, not background processes.                                                                                                                                                           | P1       |

The composer now uses one card and a single bottom toolbar (`ComposerShell.svelte`). Multi-question `ask_user` cards retain options and recorded answers; each question supports detail, unified reference completion, and shared dictation (`AskUserQuestion.svelte`). A single option question with no typed detail can submit immediately. Capability changes are resolved for the next provider request, not the already prepared request (`runtime/model-turn.ts`, server `turn-resources.adapter.ts`).

### Agent runtime, models, and providers

| Capability                                    | User value                                                                        | Confirmed evidence                                                                                         | Constraints / accurate wording                                                                                                                                                                                                                                                | Priority |
| --------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Coding and Planning profiles                  | Separate implementation from researched planning                                  | `policy.ts`; planning tools; plan storage                                                                  | Planning is enforced as well as prompted: file writes only in plan storage, limited shell guardrails, no mutating integrations or process launches. Bash restrictions are guardrails, not a security sandbox.                                                                 | P0       |
| Read-only, supervised, autonomous permissions | Match agent authority to risk tolerance                                           | `tools/src/policy/rule-sets/read_only.json`; permission evaluator and profile availability checks          | Read only explicitly allows interaction, read-risk tools, and `subagent_prompt`/`subagent_stop`; it does not mean “no delegation.” Child profile availability and effective policy still apply. Permission rules are tool policy, not an OS sandbox.                          | P0       |
| Shared conversation execution                 | Follow streaming, queued input, tool calls, and delegation                        | `packages/conversation-core/src/core.ts`; `ports.ts`; `storage/core-storage.ts`                            | Conversation-core owns execution and durable conversation state; server host ports connect providers/tools/processes. pi-ai supplies provider streaming, not the whole application runtime.                                                                                   | P0       |
| Automatic context compaction                  | Continue long sessions with bounded context                                       | conversation-core `runtime/conversation-runner.ts`; `context/compaction.ts`                                | Effective compaction settings govern pre-turn compaction; the runner also retries context overflow after compaction once per turn. Summaries can omit details. Do not carry forward the retired three-auto-continuation guarantee.                                            | P1       |
| Resource and skill loading                    | Add project/user and opt-in Built-in Nerve guidance without modifying the harness | `@nervekit/skills`; `resource-loader.ts`; skill tests                                                      | Project definitions win by name; built-ins are disabled by default; `.nerve`/`.agents` precedence must be documented exactly. Legacy `.pi` is not loaded. Capability changes are resolved for subsequent provider requests; previously loaded instructions remain in history. | P1       |
| Provider authentication                       | Use API keys or supported subscriptions                                           | auth schemas/manager/OAuth flow                                                                            | API key and OAuth are mutually exclusive per provider. OAuth flows vary and only one callback-server flow can be active for selected providers. Credentials use encrypted secret storage.                                                                                     | P0       |
| Dynamic provider/model catalog                | Choose models exposed by the current runtime                                      | Provider/model services; provider metadata and picker                                                      | Authenticated runtime catalog is the support boundary. Avoid fixed provider counts, model counts, or underlying transport promises.                                                                                                                                           | P0       |
| Custom providers/models                       | Connect compatible endpoints and describe model behavior                          | provider catalog schemas and settings dialogs                                                              | Provider IDs are lowercase slugs; transports come from supported pi-ai API types. Definitions can declare context/output/cost/reasoning/images, but not all metadata is exposed in the picker.                                                                                | P1       |
| Defaults, scopes, and agent profiles          | Choose lead models and configure delegated work separately                        | Scoped model settings; `contracts/src/domains/agent-profiles/agent-profile.ts`; `agent-profile.service.ts` | Explore and Developer are profiles, not separate agent systems. Built-ins inherit lead model/thinking; profile layers can override them. Do not describe an independent Explore default setting.                                                                              | P1       |
| Thinking levels                               | Trade latency/cost for depth                                                      | thinking contracts/model picker                                                                            | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`; runtime clamps to model support.                                                                                                                                                                                   | P1       |
| Usage and subscription windows                | Observe tokens, cost, context, and selected plan limits                           | composer usage UI; subscription service                                                                    | Per-conversation values require provider usage events. Subscription windows exist only for OAuth Anthropic and OpenAI Codex; not general API-key billing.                                                                                                                     | P1       |
| Image-capable model calls                     | Analyze images when a model supports them                                         | model definition modalities; harness image blocks                                                          | Composer does not gate image paste by selected model, and public model info omits modality. Copy must tell users to select a model known to support images.                                                                                                                   | P1       |

### Tools and integrations

| Capability                             | User value                                                           | Confirmed evidence                                                                                                     | Constraints / accurate wording                                                                                                                                                                                                                     | Priority |
| -------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| File/search tools                      | Inspect and safely modify a workspace                                | contracts tool names; filesystem catalog/executors                                                                     | `read`, `grep`, `find`, `ls`, `edit`, `write`; bounded output, precise/atomic edits, mutation serialization. `read` can return image blocks.                                                                                                       | P0       |
| Bash and asynchronous commands         | Run validation without blocking conversation work                    | `core/shell.tools.ts`; `orchestration/process.tools.ts`; conversation-core async-bash                                  | Explicit background execution or configured automatic promotion; completion notices, retained output, `async_bash` list/logs/stop. Use launch definitions for recurring project servers.                                                           | P0       |
| Finite Python                          | Perform data/script work with artifacts                              | Python catalog/executor                                                                                                | Optional runtime and globally disableable; exactly one code/file input; ≤600s; no stdin; env secret-name rejection. Planning guards are not a hard sandbox.                                                                                        | P1       |
| Web search/fetch                       | Research current external information                                | web executors                                                                                                          | Individually disableable. Search requires Tavily. Fetch: redirects, 60s, 10 MiB, raw/artifact fallback. Arbitrary outbound URLs mean internal-network safety must not be claimed.                                                                  | P1       |
| Jira                                   | Read and update delivery work                                        | Jira tool catalog                                                                                                      | Profile/credential gated; single-target issues, boards, sprints, backlog, attachments, comments, worklogs, and links; mutations are supervised by tool policy.                                                                                     | P1       |
| Confluence                             | Read and publish project knowledge                                   | Confluence tool catalog                                                                                                | Profile/credential gated; single-page search/download/update plus comments, lifecycle, labels, restrictions, and attachments; no bulk publishing.                                                                                                  | P1       |
| Questions and todos                    | Resolve ambiguity and track work                                     | host tools/contracts                                                                                                   | `ask_user` suspends for a reply; todos are structured current-run state.                                                                                                                                                                           | P0       |
| Planning-profile tools                 | Research, write a plan, and request review                           | plan tool catalog/policy                                                                                               | Plans live in Nerve plan storage; implementation waits for explicit acceptance.                                                                                                                                                                    | P0       |
| Launch tool                            | Operate the user’s configured project processes                      | `orchestration/process.tools.ts`; `core-host/launch-tool.ts`                                                           | `launch` status/start/restart/stop/logs selects existing definitions by name. It cannot create or edit definitions. Do not carry forward old task-tool names, environment, or timeout guarantees.                                                  | P1       |
| Profile-based async subagents          | Delegate research and implementation with retained follow-up context | `orchestration/subagent.tools.ts`; `contracts/src/domains/agent-profiles/agent-profile.ts`; `agent-profile.service.ts` | Built-in Explore and Developer profiles are enabled; named children run asynchronously in the shared worktree without the lead transcript. `subagent_prompt` queues follow-ups; completion notices wake the lead.                                  | P1       |
| Explore and Developer profile controls | Tune delegated authority and resources by scope                      | `builtInSubagentProfiles`; `agent-profile.service.ts`; profile availability checks                                     | Explore defaults to read-only research; Developer to autonomous implementation. User/project/conversation layers configure profiles; effective policy and availability still apply. Old separate Explore launch limits are not current guarantees. | P1       |
| Agent Browser skill                    | Add optional CLI-provided browser guidance                           | `agent-browser-skills.ts`                                                                                              | It is opt-in `SKILL.md` prompt guidance discovered from the CLI, not a native browser automation tool/executor.                                                                                                                                    | P2       |
| Tool settings and lifecycle            | Limit capabilities and inspect execution                             | tool settings/records/adapter                                                                                          | Only web search, web fetch, and Python are globally user-toggleable individual tools. Jira/Confluence use layered enablement plus profile selection. Every call has persisted lifecycle states and bounded output.                                 | P0       |

### Desktop, connectivity, storage, and protocol

| Capability                     | User value                                                 | Confirmed evidence                                                                           | Constraints / accurate wording                                                                                                                                                                                                      | Priority |
| ------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| npm/pnpm desktop launcher      | Start without native installers                            | desktop `bin.ts`; package/release scripts                                                    | Node 24+; Linux, Windows 11, macOS; Electron binary may download; no signed/notarized installers.                                                                                                                                   | P0       |
| Electron-owned local daemon    | Keep a local-first one-app workflow                        | desktop main/profile/supervisor                                                              | Defaults `127.0.0.1:3747`; health/restart supervision; only owned children are stopped. Chromium profile remains outside `NERVE_HOME`.                                                                                              | P0       |
| Browser/PWA                    | Use the workbench outside Electron                         | Vite PWA and app startup                                                                     | Service worker is browser-only, deliberately disabled in Electron. Browser still depends on a running daemon.                                                                                                                       | P1       |
| LAN/mobile HTTPS               | Reach Nerve on a trusted LAN                               | server bind gate and TLS material                                                            | Explicit remote opt-in; HTTPS default 3748; self-signed local CA; token URLs are password-like. Not safe for public Internet exposure by itself.                                                                                    | P0       |
| Remote daemon desktop mode     | Connect Electron to an existing daemon                     | connection service                                                                           | Requires `--connect` and token; monitor-only, never owns/restarts/stops remote daemon.                                                                                                                                              | P1       |
| Token authentication           | Protect HTTP/WebSocket access                              | auth middleware/app server                                                                   | Bearer/cookie/query bootstrap. UI query token is exchanged for Strict HttpOnly cookie; token leakage remains material.                                                                                                              | P0       |
| Configuration and ports        | Isolate/customize operation                                | daemon CLI/env/settings                                                                      | Document CLI/env/default precedence and all supported overrides. Source launcher defaults ports via env, which can outrank saved settings.                                                                                          | P1       |
| Local storage and cleanup      | Understand backup and disk use                             | conversation-core `storage/core-storage.ts`; server storage bootstrap and launch persistence | Core SQLite stores conversations/events/tool calls/inputs/assets/async Bash; payloads and server-owned configuration/logs remain separate. `NERVE_HOME` defaults to `~/.nerve`; do not describe all state as one database.          | P0       |
| Storage migration              | Upgrade with backups and explicit ownership                | `infrastructure/migrations/steps/0001-conversation-core/`; project-open migration tests      | Distinguish older selective legacy import from current conversation-core conversion and project-open migration. Do not reuse the old “no conversations migrate” blanket claim; follow the current storage guide and implementation. | P0       |
| Proxy/platform troubleshooting | Operate behind corporate networks and Linux display stacks | desktop proxy/bin/main; README                                                               | Electron downloader and runtime proxy are separate; redacted diagnostics available. XWayland override remains a workaround for freezes.                                                                                             | P1       |
| Nerve Protocol v1              | Reconnect and recover UI/server state                      | Contracts/protocol/session implementation and tests                                          | Typed RPC, event streams, replay/snapshot/resync; no wire ACK. Transport lifecycle belongs to protocol, not conversation-core.                                                                                                      | P2       |

### Native computation and performance claim boundaries

- `packages/native` exposes Git reads, managed processes, monitoring, and lexical search through one Rust N-API addon. `createSearchIndex` indexes typed documents, not only file paths; TypeScript owns discovery, freshness, permissions, contextual ranking, and selection effects. Git mutations still use the CLI.
- Recent history: `6dd2e0dc3` introduced native completion indexing and single-pass storage accounting; current search ownership is documented by `packages/native/README.md` and `src/search/`. `d4229718a` reduced full-history status reads and skips migration-worker startup for a validated, current ledger. Storage accounting remains TypeScript (`storage-usage.service.ts`, `storage-files.ts`), not a Rust rewrite.
- Describe targeted work and observable workflows. Do not publish synthetic benchmark numbers as product-wide speedups, imply all computation is native, or treat execution-environment proposals as shipped behavior.

## Audience and journey taxonomy

Organize navigation by what readers are trying to accomplish, not by package or implementation feature.

1. **Evaluators** — “What is Nerve, why is it different, does it fit my security/workflow needs?” Journey: homepage → capabilities → local-first/security → install.
2. **First-time users** — “Install it, connect a model, open a project, complete a safe first task.” Journey: install → provider auth → first project → first conversation → approvals/review.
3. **Daily practitioners** — “Use the composer, conversations, Git, launches, async commands, subagents, skills, suggestions, and recovery efficiently.” Journey: workflow guides linked contextually rather than one giant feature tour.
4. **Integrators/power users** — “Enable network/data integrations, custom providers, browser/mobile access, or remote topology.” Journey: integration prerequisites → configuration → permissions/security → troubleshooting.
5. **Operators/security-conscious users** — “Know where data lives, what is exposed, how auth/migration/cleanup/diagnostics work.” Journey: advanced operation → security model → storage → troubleshooting.
6. **Contributors/extension authors** — “Understand architecture, protocol, contracts, tools, package boundaries, and contribution/release expectations.” Journey: architecture → extension model/protocol → development → repository governance.

Each public page starts with who it is for and the outcome, then prerequisites, steps/concepts, constraints/warnings, and next links. Package names appear only in developer pages.

## Information architecture

### Marketing homepage (`/`) — retained planning brief

The pillars/order below record editorial intent, not an instruction to alter the current landing page. This documentation refresh preserves its source, layout, and marketing.

Message pillars, in priority order:

1. **Token and cost efficiency** — a lean system prompt, a gated tool surface, bounded tool results, and automatic compaction, so a plan or budget goes further. This is the lead: local-first trust matters, but it is not what makes someone switch.
2. **Use the AI access you already have** — supported subscription OAuth or your own API key.
3. **Visible, steerable, branchable work** — typed events, live retuning, history as a tree.
4. **Authority you tune** — permission levels, modes, rule sets, approvals.
5. **Real codebases** — multiple projects and repositories, worked in parallel.
6. **Delegation with oversight** — profile-based async research/implementation teammates, background command notices, and reusable launch configurations.
7. **Free, open source, and local-first** — ownership and an honest data boundary, stated plainly rather than sold as the headline.

Section order:

1. Hero: category, evidence-backed value, install command, and GitHub star call to action. Any efficiency figures need a current reproducible measurement, not a copied prompt-length metric.
2. Verifiable fact strip.
3. Use the access you already pay for — OAuth, API keys, usage windows.
4. Token efficiency — lean prompt and tool surface, then projection and compaction.
5. One workbench, the whole loop — real screenshots.
6. Retune while it runs.
7. Typed events and evidence.
8. Branchable history.
9. Permission authority.
10. Multiple projects and repositories.
11. Delegation: async agent profiles, background Bash, and launches.
12. Local by default, connected by choice — boundary diagram.
13. Details that add up — resilience and productivity grid.
14. Mobile and LAN access.
15. Three-step install close with an open-source and star request.

Avoid unsupported comparative claims, exhaustive provider logos, fabricated testimonials, download buttons for nonexistent installers, or “fully sandboxed/private” language.

### Claim guardrails

Use these formulations consistently across the homepage, README, metadata, and documentation.

- Say **local-first**, not “everything stays offline” or “nothing leaves your machine”.
- Say **no product analytics**, and distinguish local logs and diagnostics from external tracking.
- Explain conditional guidance/tool loading, bounded output, and compaction without brittle prompt-length or percentage-saving claims. Quote a metric only with a current reproducible measurement; model/task behavior varies.
- Say **supported subscriptions**, with examples rather than a permanent provider matrix; the installed catalog decides.
- Say model, profile, and permission changes apply to **the next provider request**.
- Say reasoning is shown **when the provider returns it**.
- Say branching **navigates to an earlier entry and preserves lineage**; it is not a generic conversation clone.
- Say projections and compaction **reduce context pressure**; do not claim lossless context or a guaranteed token saving.
- Say complete tool output is **retained and retrievable**, while model and transcript projections are bounded.
- Say permissions enforce **Nerve's tool policy and review points**; never call them a sandbox.
- Say **Explore and Developer are profiles in one async subagent system**. Built-in Explore is read-only; Developer implements in the shared worktree. Do not reuse retired Explore-only limits or imply worktree isolation.
- Say subscription usage figures are **operational estimates**; provider accounting is authoritative.
- Say voice transcription **uploads audio to the configured transcription service** and returns editable text.

### Screenshots

Published screenshots are produced by the pipeline in `scripts/screenshots/` from synthetic demo data, not captured by hand from a real workspace. See `scripts/screenshots/README.md`.

### Documentation navigation

The sidebar follows user tasks, in this order:

- **Get started** (`/start/`) — hub, What is Nerve?, Install, Connect a model (quick path; links to `models/providers-and-auth` for auth detail), Open a project, Your first task, Discover and in-app guides (`start/learn-in-app`).
- **Everyday work** (`/guides/`) — workflow overview, workbench, composer (references, quoting, compact mobile composer), images and voice, profile/model/permissions, approvals/questions/plans, conversations (grouped discovery, AI titles, references), history and branches, Notifications and activity, files/context/notes.
- **Review and ship** — Git changes (`guides/git`), Pull requests (`guides/pull-requests`), external editors (`integrations/external-editors`).
- **Delegate and automate** — sub-agents, launches and background commands, prompt suggestions (how-to), skills.
- **Customize** — Themes and appearance (`personalize`), Settings at a glance, keyboard shortcuts (links to the reference).
- **Models and integrations** — `models/*` (including `models/usage`, “Usage and limits”) and `integrations/*`.
- **Set up and operate** (`/operations/`) — configuration (files, env, flags), remote daemon, LAN and mobile, browser/PWA, security, diagnostics, back up/move/upgrade data (`storage-migration`).
- **Troubleshooting** — unchanged symptom pages.
- **Reference** — unchanged; `reference/prompt-suggestions` keeps only the catalog and syntax.
- **Developers** — last and collapsed; routes unchanged.

User pages open with one sentence on what the reader will accomplish, organize sections around tasks (Starlight `Steps` for procedures), use at most one or two screenshots through `DocsScreenshot`, and keep limits in a short “Good to know” list. Mechanism detail and exhaustive precedence rules belong in Reference or Developers.

#### Redirect map

Configured with Astro `redirects` in `astro.config.mjs`; `scripts/check-content.mjs` verifies every target is a known route and no internal link points at a source.

| Old route                        | New route                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| `/start/guides/`                 | `/start/learn-in-app/`                                                                       |
| `/guides/git-and-pull-requests/` | `/guides/git/` (pull-request content moves to `/guides/pull-requests/`)                      |
| `/guides/import-export-editors/` | `/operations/storage-migration/` (editor content moves to `/integrations/external-editors/`) |
| `/models/usage-images-voice/`    | `/models/usage/` (image and voice content moves to `/guides/images-and-voice/`)              |

Backup guidance from the old import/export page now lives in `/operations/storage-migration/`. Anchors on split pages do not carry over through redirects.

- **Start here** — guided `/start/` hub, overview, install, first project, providers, first task.
- **Workflows** — workbench, composer, conversations/history, controls, review gates, files/context/notes, Git/PRs, launches/async commands, agent profiles, suggestions, skills, personalization, backups and external editors.
- **Models & integrations** — model/provider concepts, custom definitions, usage/images/voice, web/Python, Jira, Confluence, Agent Browser, editors.
- **Operate safely** — browser/PWA, LAN/mobile, remote daemon, configuration, storage/migration, security, diagnostics.
- **Troubleshooting** — decision-oriented symptom pages.
- **Developers** — architecture, harness, tools/policy, persistence/security boundary, Nerve Protocol v1, extension model, development and contribution.
- **Reference** — CLI/env, shortcuts, tool catalog, resource precedence, suggestion format, storage formats and backup boundaries.

## Page-level content backlog

The tables are editorial briefs for the existing corpus and refresh backlog, not a list of unimplemented routes. Retain existing route slugs where practical (for example, `background-tasks` now explains launches and async Bash). “Visual / warning” specifies either a useful asset or the warning that must be prominent. Every page must include “Next steps” links.

### Homepage and start here

| Route                   | Purpose and key sections                                                                                           | Prerequisites / cross-links                        | Visual / warning                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/`                     | Positioning, proof, workflow, capabilities, topology, beta/open-source CTA                                         | Links to install, security, workbench, GitHub      | Hero workbench image; 3-node Electron/UI/daemon diagram; beta and trusted-network warning       |
| `/start/overview/`      | Explain desktop workbench, daemon, project relationship, core terms                                                | None → install, architecture                       | Annotated overview screenshot; avoid calling Nerve an IDE/editor                                |
| `/start/install/`       | Node 24 requirement; `npx`/`pnpm dlx`; first Electron download; platform support; source alternative               | Overview → provider setup, install troubleshooting | Terminal snippet; no native-installer implication                                               |
| `/start/providers/`     | Add provider; API key vs OAuth; choose default/scoped models and explain agent profile inheritance; thinking level | Installed app → first project, model guide         | Auth/settings screenshot; credential and provider-specific warning                              |
| `/start/first-project/` | Directory picker, project record, first conversation, supervised default, send/review/stop                         | Install + provider → first task                    | Project picker and composer screenshots; selected directory gives tools direct workspace access |
| `/start/first-task/`    | Safe walkthrough: ask for inspection, review plan/diff, approve mutation, run validation                           | First project → permissions, Git                   | Transcript approval screenshot; use disposable/committed workspace                              |

### Use Nerve

| Route                            | Purpose and key sections                                                                                                                                  | Prerequisites / cross-links                                 | Visual / warning                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `/guides/workbench/`             | Three-pane shell, tabs, panels, moving/hiding/resizing, responsive sheets, project search                                                                 | First project → panels, shortcuts                           | Annotated desktop + mobile screenshot                                                             |
| `/guides/composer/`              | Send/stop, keyboard behavior, `/` commands, grouped `@` references, desktop file/folder path drops, queue/cancel-edit, context/todos                      | First project → images/voice, controls                      | Toolbar + completion + queued prompt sequence; distinguish path mentions from uploads/attachments |
| `/guides/images-and-voice/`      | Paste image paths, distinguish dropped existing paths, supported clipboard MIME behavior, model compatibility, recording/transcription                    | Composer + compatible model/OAuth → model guide             | Paste/voice states; temp-file, external transcription, 8m/25MB warning                            |
| `/guides/agent-controls/`        | Coding/planning, read-only/supervised/autonomous, read autoapproval, durable supervised grants, live model/thinking changes                               | Provider setup → approvals, security                        | Composer controls screenshot; “next model request” wording                                        |
| `/guides/reviews/`               | Tool approvals, user questions, current plan interaction actions, resolution cards and composer availability                                              | Agent controls → planning, permissions                      | One transcript showing all card types                                                             |
| `/guides/conversations/`         | Create/name/search/delete, active status, tabs, transcript behavior                                                                                       | First project → history, backups                            | Conversation navigator screenshot                                                                 |
| `/guides/history-and-recovery/`  | History graph, navigate/branch, edit-resend, compaction entries, retries, failure continuation                                                            | Conversations → context, troubleshooting                    | History graph screenshot; branch and checkpoint limitations                                       |
| `/guides/files-context-notes/`   | File viewing/editing, save conflicts, line targeting/wrap/Markdown, context indicators/activity island, project notes                                     | Workbench → resources and delegation                        | Combined panel screenshot; editable-file boundaries and truncation warning                        |
| `/guides/git-and-pull-requests/` | Repo overview, staging, branches, sync, PR list/detail/checks/files/checkout/merge, follow-up prompts                                                     | Git repo; GitHub requires `gh` auth → troubleshooting       | Git + PR screenshots; destructive/remote action warning; UI integration ≠ tool                    |
| `/guides/background-tasks/`      | Launch definitions/runs, single vs concurrent, start/stop/restart/logs/history; async Bash promotion, completion notices, activity island and output tabs | Project → tools/profile reference, recovery troubleshooting | Launches dock + command log tab; distinguish saved project definitions from conversation commands |
| `/guides/agents-and-delegation/` | Unified async subagents, Explore/Developer defaults, named follow-ups, completion notices, activity island and profile layers                             | Project + available profile → controls, profile reference   | Shared-worktree warning; children do not receive the lead transcript                              |
| `/guides/prompt-suggestions/`    | Built-ins, user/project definitions, precedence, toggles, contextual chips, JS trust                                                                      | Project → suggestion-format reference                       | Settings/chips/trust dialog; arbitrary JS trust warning                                           |
| `/guides/skills-and-resources/`  | AGENTS/SYSTEM/context/skills locations, Built-in Nerve skills, precedence, toggles, effective next-run behavior                                           | Project → resource reference, Agent Browser                 | Skills settings + precedence diagram; project files are trusted instructions                      |
| `/guides/personalize/`           | Themes, zoom, fixed shortcuts, notifications/sounds, panel layout                                                                                         | Workbench → shortcut ref, browser operation                 | Appearance/settings screenshot; browser permission caveat                                         |
| `/guides/import-export-editors/` | Stopped-home history backup, external editors/terminals, project removal and pruning                                                                      | Existing conversation/project → storage                     | Legacy slug retained; do not advertise retired bundle import/export or an export menu             |

### Models and integrations

| Route                             | Purpose and key sections                                                                               | Prerequisites / cross-links                              | Visual / warning                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `/models/providers-and-auth/`     | Dynamic provider catalog; API key vs OAuth; credential replacement/removal; OAuth flow troubleshooting | Installed app → model selection, security                | Provider settings screenshot; do not freeze a “supports every pi-ai provider” list |
| `/models/selecting-models/`       | Defaults, last selection, scopes, agent profile model/thinking inheritance, context/output metadata    | Authenticated provider → usage/custom models             | Picker/scopes screenshot; runtime catalog and stale-scope behavior                 |
| `/models/custom-providers/`       | Endpoint URL, supported transport, headers/compatibility, auth, custom model fields                    | Compatible endpoint knowledge → security/troubleshooting | Provider/model dialogs; removal cascades model/secret data                         |
| `/models/usage-images-voice/`     | Conversation tokens/cache/cost/context, limited subscription windows, image declarations, voice auth   | Provider setup → composer media guide                    | Usage meter screenshot; not billing authority; modality is not picker-gated        |
| `/integrations/web/`              | Enable search/fetch, Tavily setup, output/artifacts, limits                                            | Network permission + key → tool/permission ref           | Tool settings/call screenshot; outbound URL and retrieved-content trust warning    |
| `/integrations/python/`           | Runtime discovery/path, enabling, finite scripts, artifacts/env/timeouts                               | Local Python → launches/async Bash, tool ref             | Settings + artifact result; not server use or hard sandbox                         |
| `/integrations/jira/`             | Enable/connect, read vs mutation tools, common workflows, approvals                                    | Atlassian credentials → permissions                      | Integration settings + issue tool card; data leaves local machine                  |
| `/integrations/confluence/`       | Enable/connect, search/download/publish/attachments, artifacts/approvals                               | Atlassian credentials → permissions                      | Page tool card; mutation and attachment warning                                    |
| `/integrations/agent-browser/`    | CLI prerequisite, skill discovery/toggle, prompt guidance behavior                                     | Installed Agent Browser CLI → skills                     | Skills screenshot; explicitly not native browser-control executor                  |
| `/integrations/external-editors/` | VS Code/Zed discovery and launching                                                                    | Editor installed → project guide                         | Project action screenshot; only these editors confirmed                            |

### Advanced operation and troubleshooting

| Route                                     | Purpose and key sections                                                                                                           | Prerequisites / cross-links                      | Visual / warning                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `/operations/browser-pwa/`                | Start daemon/UI, browser use, install PWA, service-worker behavior, responsive layout                                              | Running daemon → LAN/mobile                      | Desktop/browser topology diagram; PWA does not host the daemon                                |
| `/operations/lan-mobile/`                 | Explicit bind, `--allow-remote`, `--mobile-https`, CA installation, token bootstrap, tray URLs                                     | Trusted LAN → security/connectivity troubleshoot | LAN sequence diagram; token URL/CA/public Internet warning                                    |
| `/operations/remote-daemon/`              | `--connect`/token, ownership and monitor-only semantics, reconnect behavior                                                        | Existing reachable daemon → config/security      | Local vs remote topology diagram; shell will not manage remote daemon                         |
| `/operations/configuration/`              | CLI flags, env vars, saved setting precedence, ports 3747/3748, isolation overrides                                                | Advanced user → CLI ref, connectivity            | Precedence diagram; source launcher env can override saved ports                              |
| `/operations/storage-migration/`          | `NERVE_HOME`, profile separation, state categories, backup, cleanup/prune, conversation-core conversion and project-open migration | Backup awareness → diagnostics/security          | Storage boundary diagram; distinguish legacy import from current conversion; preserve backups |
| `/operations/security/`                   | Local-first boundary, token auth, permissions vs sandboxing, network tools, credentials, LAN threats, Electron hardening           | All users → integrations/LAN/SECURITY.md         | Trust-boundary diagram; beta/no-untrusted-network warning                                     |
| `/operations/diagnostics/`                | Logs UI/files, desktop/daemon JSONL, crash reports, storage inspection/cleanup, redacted proxy diagnostics                         | Failure symptom → troubleshooting                | Logs pane screenshot; crash files may contain sensitive operational context                   |
| `/troubleshooting/`                       | Symptom decision tree linking focused pages                                                                                        | None → all troubleshooting pages                 | No screenshot; collect version/platform/redacted logs first                                   |
| `/troubleshooting/install-and-proxy/`     | Electron download, corporate proxy/CA/mirror/cache, missing binary                                                                 | Install → diagnostics                            | Command blocks for shell/PowerShell; never commit proxy credentials                           |
| `/troubleshooting/connectivity/`          | Port conflicts, daemon health, token/cookie, LAN certificate, remote reconnect                                                     | Operations guides → diagnostics                  | Connection flow; never post token-bearing URLs                                                |
| `/troubleshooting/providers/`             | API-key/OAuth failures, callback concurrency, TLS/proxy/PKCE restart, missing/truncated models, voice auth                         | Provider guide → diagnostics                     | OAuth states; Anthropic paid-extra-usage disclosure                                           |
| `/troubleshooting/platform/`              | Linux Wayland/XWayland, Windows/macOS process caveats, Electron profile reset boundaries                                           | Install → storage                                | No screenshot; platform support does not mean signed installers                               |
| `/troubleshooting/tasks-and-recovery/`    | Launch and async-command interruptions, retained output, completion notices, safe stop/restart and restart limitations             | Launches/async Bash → diagnostics                | State diagram; do not signal unverifiable/reused PID                                          |
| `/troubleshooting/storage-and-migration/` | incompatible/malformed/future state, conversation-core and legacy migration boundaries, backup recovery, cleanup cancellation      | Storage guide → release engineering docs         | Migration flow; stop all Nerve processes before manual state work                             |

### Developers and reference

| Route                               | Purpose and key sections                                                                                                                                                                  | Prerequisites / cross-links                | Visual / warning                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `/developers/architecture/`         | Runtime topology, package responsibilities, data/control boundaries                                                                                                                       | Source checkout → package map/protocol     | Rendered system/desktop diagrams corrected to remove ACK claims                                                           |
| `/developers/packages/`             | Contracts, protocol, conversation-core, harness, tools, server hosts, app, shell, ui-kit responsibilities and allowed dependencies                                                        | Architecture → contribution guide          | Dependency diagram sourced from corrected PlantUML                                                                        |
| `/developers/harness/`              | conversation-core execution and host ports, pi-ai boundary, input queues, compaction, recovery, delegation and resources                                                                  | Architecture → tools/models                | Agent/run sequence diagram; distinguish underlying library capabilities                                                   |
| `/developers/tools-policy/`         | Manifest, local/host executors, risk traits, lifecycle, approvals, planning/read-only enforcement                                                                                         | Harness → tool catalog/extension model     | Policy decision diagram; policy is not OS sandboxing                                                                      |
| `/developers/persistence-security/` | core SQLite records/events/tool calls/inputs/assets/async Bash, payload files, server-owned launches/configuration, secrets, auth and migration                                           | Architecture → protocol/security           | Storage/trust diagram; schema allowance is not a redaction guarantee                                                      |
| `/developers/protocol/`             | Protocol goals, roles, handshake, RPC, event streams, replay/snapshot/resync, versioning                                                                                                  | Architecture → v1 reference pages          | Sequence diagram; explicitly no wire ACK                                                                                  |
| `/developers/protocol/v1/*`         | Migrate and correct the existing v1 overview, envelope, HTTP, lifecycle, stream, recovery, backpressure, errors/security, extension, examples, implementation guide/status/coverage pages | Protocol overview → contracts              | Keep versioned; completeness/status claims must match integration evidence                                                |
| `/developers/extensions/`           | Add operation/event schemas, handlers/reducers, tools, skills/suggestions; capability negotiation and tests                                                                               | Protocol/tools → contributing              | Extension flow diagram; no v1 aliases/raw private frames                                                                  |
| `/developers/development/`          | Node/pnpm setup, root scripts, source launch, UI-only dev target, tests/build                                                                                                             | Source checkout → contributing/release     | Command blocks; use isolated overrides for risky migration testing                                                        |
| `/developers/contributing/`         | Focused changes, test philosophy, boundaries, docs editing, security reporting                                                                                                            | Development → GitHub CONTRIBUTING/SECURITY | No screenshot; vulnerabilities remain private                                                                             |
| `/reference/cli-environment/`       | Desktop/server flags and environment variables with defaults/precedence                                                                                                                   | Operations config                          | Warning markers for secret/token/debug values                                                                             |
| `/reference/shortcuts/`             | Current fixed shortcut table grouped by navigation/run/composer/appearance                                                                                                                | Workbench/personalize                      | OS modifier notation; generated/verified from shortcut registry during writing                                            |
| `/reference/tools/`                 | Agent tool names grouped by file, execution/async Bash, launch, web, Atlassian, interaction, agent profiles and planning; risk/prereq/availability                                        | Tools policy/integrations                  | State that Git/PR UI and Agent Browser are not tool entries                                                               |
| `/reference/agent-profiles/`        | Built-in/user/project/conversation layers, inheritance, model/thinking/permission/skills/compaction, availability and trust                                                               | Delegation guide → resources/security      | Profiles configure one async system; distinguish defaults from effective authority                                        |
| `/reference/resources/`             | Exact AGENTS/SYSTEM/skills path and precedence tables; toggle semantics                                                                                                                   | Skills guide                               | Root-to-project precedence diagram; no legacy `.pi` loading                                                               |
| `/reference/prompt-suggestions/`    | Full frontmatter/conditions/JS contract, paths, precedence/trust                                                                                                                          | Suggestions guide                          | Code examples; JS trust warning                                                                                           |
| `/reference/data-formats/`          | Core database and managed files, state/log/crash locations, launch/async-command artifacts and temporary media                                                                            | Storage/backups                            | No current conversation bundle import/export; legacy query-cache is migration input/cleanup, not an active cache workflow |

## Canonical-source map

| Current item                               | Canonical owner | Boundary                                                                                                                 |
| ------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `packages/website/src/content/docs/**`     | Website package | Public user, operations, architecture, protocol, lifecycle, reliability, troubleshooting, and developer-reference prose. |
| `packages/website/diagrams/**`             | Website package | Editable architecture sources; update the generated SVGs in the same change.                                             |
| `packages/website/public/diagrams/**`      | Website package | Static visuals embedded by public pages; generated from the editable sources.                                            |
| `packages/website/content-strategy.md`     | Website package | Editorial evidence, page backlog, and claim-review plan; not a public route.                                             |
| `docs/runbooks/release.md`                 | Root docs       | Maintainer release procedure, signing, packaging, and publication operations.                                            |
| `docs/runbooks/performance-diagnostics.md` | Root docs       | Development-only diagnostics and incident analysis procedure.                                                            |
| `docs/architecture/**`                     | Root docs       | Concise current cross-package architecture that links owning code.                                                       |
| `docs/decisions/**`                        | Root docs       | Accepted cross-package design rationale without copied catalogs or schemas.                                              |
| `docs/proposals/**`                        | Root docs       | Active, explicitly unimplemented target designs.                                                                         |
| `docs/README.md`                           | Root docs       | Index explaining the root/website/package ownership boundary.                                                            |
| `CONTRIBUTING.md`, `SECURITY.md`           | Repository root | Governance and vulnerability reporting; website pages summarize and link to these files.                                 |

Duplicate-source rules:

1. Public procedures and architecture explanations live only in website Markdown; README links to them.
2. Maintainer release and development profiling workflows live only in root `docs/`; the website links or summarizes them without copying operational secrets.
3. Protocol, tool, and storage prose lives in the website tree; TypeScript schemas, catalogs, implementation, and tests define changing behavior.
4. Editable architecture sources and generated visuals live together in the website package; generated assets must be regenerated when a source diagram changes.
5. Tables likely to drift (tools, shortcuts, env vars) must cite the owning symbols and be rechecked during relevant code reviews.

## Known gaps and conservative initial-copy resolutions

These are not unresolved implementation decisions. They are editorial constraints for the first release and product follow-ups.

| Gap / potentially stale claim                             | Initial publication decision                                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which pi-ai providers are officially “supported”          | Describe the catalog as dynamically exposed through Nerve; name OAuth examples only as current observed options, not a permanent compatibility promise. Do not turn the underlying transport catalog into a support promise.                                                  |
| Images accepted with a text-only selected model           | Document paste behavior and require a model known to support image input; explicitly say the picker currently does not enforce modality.                                                                                                                                      |
| Anthropic OAuth may incur paid extra usage                | Repeat the in-product warning on auth/provider troubleshooting pages.                                                                                                                                                                                                         |
| Provider/model catalog size                               | Do not publish a fixed eight-model cap or provider count without current owning-source evidence; direct users to the authenticated runtime catalog.                                                                                                                           |
| Subscription usage appears only for Anthropic/Codex OAuth | Label it subscription-window information, not generic billing or API-key usage.                                                                                                                                                                                               |
| “Live configuration changes”                              | Limit the claim to agent model/thinking/profile/permission changes applying to subsequent work; do not say every server setting hot-reloads. Mention Python runtime path as the confirmed immediate refresh.                                                                  |
| “Fork” and “scratch notes in tabs” README language        | Use “navigate/branch from history” and “Notes panel.”                                                                                                                                                                                                                         |
| Composer attachments                                      | Distinguish desktop path drops from clipboard image paste. Dropped items become editable existing-path mentions, not copied/uploaded attachments; pasted images become temporary local files. Do not claim a generic file picker, thumbnail attachment UI, or durable upload. |
| Agent Browser                                             | Call it imported prompt-skill guidance, not browser automation.                                                                                                                                                                                                               |
| Git/GitHub                                                | Separate Workbench UI routes from agent-callable tools; agent Git use is indirect through Bash.                                                                                                                                                                               |
| Web fetch security                                        | Warn that it performs outbound fetches and do not claim SSRF/internal-network isolation.                                                                                                                                                                                      |
| Python planning guards                                    | Call them guardrails, not a sandbox.                                                                                                                                                                                                                                          |
| Crash diagnostics                                         | Explain filesystem reports; do not promise an in-app crash-report browser.                                                                                                                                                                                                    |
| Storage migration                                         | Separate historical selective imports from current conversation-core conversion and project-open migration. Follow current migration tests; the old query-cache database is legacy migration material, not an active runtime store.                                           |
| Protocol ACK references                                   | Replace with processed cursors, subscriptions, replay, and resync. Explain any retained `ACK_INVALID` enum as reserved/legacy if it remains in public reference.                                                                                                              |
| Native release CI assertions                              | State only what workflows currently execute; do not claim workbench-server native release tests where release workflow does not run them.                                                                                                                                     |
| Token-bearing LAN URLs                                    | Prominently warn against sharing, logs, screenshots, clipboard history, and untrusted browser history; HTTPS does not neutralize token disclosure.                                                                                                                            |

Before polishing final marketing copy, product ownership can later decide whether to formalize a provider support matrix, add model-modality gating, define a stronger web-fetch network boundary, expose crash reports in UI, or broaden editor support. The first site does not depend on those future decisions.

## Historical initial rollout plan

The steps below are retained as historical planning context. They are not current TODOs: the site, marketing motion system, public corpus, and capture pipeline already exist. Follow root `AGENTS.md`, current package instructions, and the active assignment for validation and ownership; this historical plan does not authorize landing changes or broad test suites.

### Implementation steps (historical)

### 1. Create the editorial source of truth first

Maintain `packages/website/content-strategy.md` as the evidence inventory, audience taxonomy, IA, backlog, cleanup map, known constraints, screenshot checklist, and page-status record (`not started`, `drafted`, `evidence reviewed`, `copy reviewed`, `published`). Keep `docs/README.md` as the short root ownership index.

This commit stage makes claim review possible before visual work and ensures another writer can trace every important statement to implementation.

### 2. Scaffold the private static-site workspace

Create:

- `packages/website/package.json` (`@nervekit/website`, private, Node >=24; scripts `dev`, `build`, `check`, `preview`)
- `packages/website/astro.config.mjs` (static output, `site`, Starlight, sitemap, title/description, GitHub/social/edit links, sidebar)
- `packages/website/tsconfig.json`
- `packages/website/src/content.config.ts`
- `packages/website/README.md` (authoring, ownership, local commands, deployment, screenshot guidance)
- `packages/website/public/CNAME`
- minimal brand assets copied from canonical root `assets/brand` only where Astro public delivery requires them

Keep the package independent of contracts, UI kit, Svelte, and runtime packages. The website documents the product; it does not import product runtime code into the static build.

### 3. Build a minimal, content-led homepage and theme

Create `src/pages/index.astro`, a few small semantic Astro components under `src/components/`, and one minimal custom stylesheet under `src/styles/`.

- Reuse the Nerve mark and existing screenshots.
- Use Starlight’s typography/navigation behavior and accessible defaults.
- Limit custom design to brand tokens, readable content widths, a simple hero, capability grid, screenshot frame, topology section, and responsive spacing.
- Support light/dark mode through Starlight; no JavaScript animation, carousel, decorative canvas, custom component system, or duplicated workbench UI kit.
- Ensure all calls to action work without JavaScript and all screenshots have useful alt text.

### 4. Write Start Here and core daily-workflow pages

Write complete prose for all Start Here pages and the P0/P1 daily workflow pages in the backlog. Use tested command examples and concise task-oriented procedures. Capture or reuse screenshots only after page structure is stable. Every behavioral claim must be checked against the evidence inventory.

The first coherent review slice is:

1. Homepage
2. Install
3. Provider setup
4. First project and first task
5. Workbench
6. Composer
7. Agent controls and reviews
8. Conversations/history/recovery
9. Git/PRs
10. Background tasks

### 5. Write models, integrations, and advanced operation

Add provider/model/auth pages, then integration pages with prerequisites and explicit network/credential boundaries. Add browser/PWA, LAN/mobile, remote-daemon, configuration, storage/migration, security, and diagnostics pages. Prefer diagrams for topology and trust boundaries over extra decoration.

### 6. Write troubleshooting and reference

Convert existing README troubleshooting into symptom-oriented pages, correcting migration behavior and retaining platform-specific shell examples. Build exact reference tables from owning source symbols:

- CLI/env from desktop/server parsers and profile builders
- shortcuts from `DEFAULT_SHORTCUTS`
- tool inventory from contracts/catalog manifest
- resource precedence from `resource-loader.ts`
- suggestion schema from server parser/tests
- paths/formats from storage/export/transcription implementations

### 7. Migrate public docs and correct engineering drift

- Move prompt suggestions, tasks, protocol v1, and public screenshots to their canonical website locations.
- Update all repository links before deleting obsolete public-doc files.
- Correct `README.md` migration wording, notes/fork terminology where retained, protocol ACK wording, and links to the new site.
- Keep ACK wording in `packages/website/diagrams/01-system-context.puml`, `02-package-dependencies.puml`, and `03-desktop-runtime.puml` aligned with Protocol v1 and current contracts.
- Correct any release/native-validation overclaims in `docs/runbooks/release.md` and `/developers/platform-reliability/` to match current workflows.
- Preserve only release and performance-profiling workflow documents in root `docs/`; public architecture and lifecycle material belongs to the website package.

### 8. Add GitHub Pages deployment

Add the website build and deployment jobs to `.github/workflows/release.yml`:

- deploy only from the stable and prerelease version tags handled by the release workflow, not from ordinary `main` pushes;
- grant `contents: read`, `pages: write`, and `id-token: write` only to the Pages jobs;
- keep a `github-pages` concurrency group with in-progress cancellation;
- checkout, use pnpm 11.20.0 and Node 24, and install the frozen root workspace;
- run `pnpm --filter @nervekit/website check` and `build` after release validation;
- upload `packages/website/dist` with `actions/upload-pages-artifact` and deploy with `actions/deploy-pages` after npm publication;
- use the `github-pages` environment and expose the deployment URL.

Do not modify the existing CI workflow’s permissions for deployment. Root CI will naturally include website package checks/tests through recursive scripts.

### 9. Review content before visual polish

Review in this order:

1. **Evidence review:** implementation owner validates claims/limits and all warnings.
2. **Journey review:** a new user can install, authenticate, open a project, supervise a task, and recover from a common failure without reading architecture pages.
3. **Security review:** tokens, OAuth, network tools, LAN, Python, JavaScript suggestions, destructive Git, storage, and logs are accurately bounded.
4. **Editorial review:** terminology is consistent; concepts are introduced before reference detail; no page is a package/file inventory disguised as a guide.
5. **Visual review:** only then capture final light/dark desktop and compact/mobile screenshots and adjust minimal styling.

## Validation (historical rollout checklist)

During implementation, validate incrementally with focused package commands, then run the repository-required full chain before completion.

1. `pnpm --filter @nervekit/website check`
2. `pnpm --filter @nervekit/website build`
3. Preview the built site and manually verify:
   - homepage and all sidebar routes;
   - search indexing;
   - internal links, heading anchors, code copy controls, 404;
   - canonical URLs, sitemap, robots metadata, favicon/social metadata, and `CNAME` in output;
   - keyboard navigation, visible focus, semantic heading order, image alt text;
   - light/dark and widths around 1440, 1024, 768, and 390 px;
   - no request to localhost/runtime APIs from the static site.
4. Review command snippets on Linux syntax and retain separate PowerShell blocks where needed.
5. Grep for stale/high-risk phrases: wire “ACK,” “scratch notes in tabs,” generic “file upload,” “all pi-ai providers,” “sandboxed,” “safe public Internet,” and old migration exclusions.
6. Run in one Bash invocation: `pnpm fix && pnpm check && pnpm run test:full`. Fix failures and rerun the complete chain.
7. Run `pnpm build` to verify the website composes with all workspace builds and the existing workbench asset staging step.
8. After repository merge and external Pages/DNS setup, verify `https://nerve.tlmtech.dev`, HTTPS certificate issuance, redirect/canonical behavior, sitemap/search assets, and a clean browser load.

## Risks and mitigations (initial rollout context)

- **Scope/content volume:** Do not trade accuracy for page count. Write in the ordered review slices above; no empty pages are deployed. The IA can contain only pages that have complete first-pass copy at launch.
- **Rapid product drift:** Keep the evidence matrix and symbol owners; require docs updates in code reviews that change user-visible contracts, tool catalogs, shortcuts, CLI flags, or storage behavior.
- **Duplicate sources:** Complete moves atomically with link updates and deletion of old public prose. Root documents summarize/link rather than mirror.
- **Custom-domain outage:** GitHub Pages configuration and Cloudflare DNS are external prerequisites. The built artifact remains valid at the Pages deployment URL while DNS validates, but canonical metadata targets `nerve.tlmtech.dev`.
- **Protocol status overstatement:** Retain explicit implementation-status/coverage pages and qualify package-test evidence versus end-to-end compatibility.
- **Security marketing risk:** Never equate local-first with offline-only, permissions with sandboxing, self-signed HTTPS with Internet-safe exposure, or encrypted credential storage with zero trust.
- **Screenshot churn:** Use existing images for first drafts, maintain a shot list, and capture final assets only after workflows and page sections settle.
- **Framework over-customization:** Use Starlight defaults and small Astro components; postpone bespoke visual systems until content and navigation have user feedback.

## Phased content-writing and review plan (historical)

1. **Phase A — inventory and terminology (first artifact):** maintain `packages/website/content-strategy.md`, correct high-risk factual drift, establish canonical ownership and glossary.
2. **Phase B — successful first hour:** homepage + Start Here + agent controls/reviews. Review with a clean-home user journey.
3. **Phase C — daily coding workflow:** workbench, composer, conversation history, context/files/notes, Git/PRs, tasks, skills/suggestions, import/export. Review against UI and focused tests.
4. **Phase D — models and integrations:** auth, model scopes/thinking/usage, custom providers, media/voice, Web/Python/Atlassian/Agent Browser/editors. Review credentials, data flow, and provider limitations.
5. **Phase E — operation and safety:** browser/PWA, LAN/mobile, remote daemon, configuration, storage/migration, diagnostics, security. Perform dedicated security and migration review.
6. **Phase F — troubleshooting and reference:** symptom pages, exact tables, protocol v1 migration/corrections, contributor architecture. Validate source symbols and links.
7. **Phase G — publish and learn:** deploy to GitHub Pages/custom domain, verify production, collect issue feedback, then decide whether richer homepage styling, videos, changelog/versioning, or translations are justified.

Website implementation begins in Phase B only after Phase A’s inventory artifact is written; within each later phase, prose and evidence review precede screenshot polish and layout customization.
