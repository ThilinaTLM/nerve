# Nerve public website: content-first implementation plan

> **Editorial status (2026-09-04):** Public copy was re-audited against v0.27.0 plus the project-switcher work at HEAD. Current deltas for project navigation, prompt-suggestion storage, native package ownership, and active Protocol v1 roles are reflected in the corpus. The docs now have a guided `/start/` entry point, content-integrity checks, and instructional use of the existing approved screenshots. A new production screenshot capture remains a separate follow-up.

## Objective and outcome

Maintain the private workspace package, `packages/website`, as a static public site at `https://nerve.tlmtech.dev`. The site will combine a concise marketing homepage with comprehensive, task-oriented product and developer documentation. Content discovery and claim correction come first; visual customization remains intentionally minimal until the documentation corpus is coherent and reviewed.

This plan supersedes the earlier “strategy only” boundary because the product owner explicitly approved beginning the website package, while retaining the requirement that content quality take priority over styling.

## Decisions

### Framework

Use **Astro 7.1.5 + Starlight 0.41.5** with static output.

- **Chosen: Starlight with a custom Astro homepage.** It provides accessible documentation navigation, full-text search, table of contents, Markdown/MDX, code rendering, mobile behavior, SEO metadata, and linkable headings without building a documentation shell. A custom `src/pages/index.astro` supplies a focused marketing page.
- **Rejected: fully custom Astro documentation UI.** It offers more visual control but would spend the first iteration on navigation, search, accessibility, and responsive behavior rather than content.
- **Rejected: a second-site generator or root `docs/` GitHub Pages source.** This would either add an unnecessary framework mismatch or mix deployable website source with repository engineering documents. GitHub Pages does not require root `docs/`.

Use exact package versions consistent with repository conventions: `astro@7.1.5`, `@astrojs/starlight@0.41.5`, `@astrojs/check@0.9.10`, and `@astrojs/sitemap@3.7.3`. Astro 7 supports the repository’s Node 24 baseline; Starlight 0.41.5 declares Astro 7 compatibility.

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

### Initial editorial scope

Publish comprehensive first-pass pages, not placeholder stubs. Where behavior remains uncertain, make the initial copy conservative and explicit rather than publishing broad capability claims. Add no blog, analytics, newsletter, CMS, internationalization, version switcher, or elaborate animation in this phase.

## Evidence-backed feature inventory

This package-level inventory is the durable editorial source. Priorities are **P0** (getting started, safety, or defining value), **P1** (important daily workflow), and **P2** (advanced/reference).

### Workbench and conversation experience

| Capability                                    | User value                                                                                             | Confirmed evidence                                                                           | Constraints / accurate wording                                                                                                                        | Priority |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Multi-project navigator and conversation tree | Move among repositories and sessions without losing context                                            | `ProjectConversationNavigator.svelte`; `ProjectDirectoryPicker.svelte`; `project.service.ts` | Projects are directory-backed records; canonical paths are deduplicated. “Current project” is client selection, not global server state.              | P0       |
| Persistent center tabs                        | Keep conversations, files, PRs, tasks, logs, auth, and settings open together                          | `EditorSurface.svelte`; shell tab state                                                      | Conversation tabs remain mounted; tabs reorder and have close-left/right/others actions. Notes are a dock panel, not a center tab.                    | P1       |
| Movable/resizable docks                       | Shape the workbench around the task                                                                    | `panel-views.ts`; `WorkbenchShell.svelte`; `shell-layout.ts`                                 | Six dock views: Conversations, Tasks, Git, Pull Requests, Context, Notes. Layout persists locally.                                                    | P1       |
| Responsive/mobile workbench                   | Use the same UI in browser, tablet, or phone                                                           | `responsive.svelte.ts`; compact branch in `WorkbenchShell.svelte`                            | Compact below 1024px; phone density below 640px; side panes become sheets. Mobile access still needs a reachable, secured daemon.                     | P1       |
| Rich streaming transcript                     | See text, thinking, calls, outputs, approvals, questions, plans, task events, compaction, and failures | `TranscriptList.svelte`; `TranscriptRow.svelte`; stream projections                          | Virtualized and replay-aware; do not imply hidden reasoning is available when a provider does not return it.                                          | P0       |
| Conversation history graph and branches       | Inspect decisions and continue from an earlier point                                                   | `ConversationHistoryGraph.svelte`; `navigation-service.ts`; active-entry lineage             | Navigation changes the active branch. “Fork” is branch navigation, not a separate generic clone button. Optional summaries are local/extractive.      | P1       |
| Edit and resend prior prompts                 | Correct or branch from an earlier instruction                                                          | `ConversationShell.svelte:editConversationEntry`                                             | Editing navigates to the parent and loads text into the composer; it does not send automatically.                                                     | P1       |
| Retry, recovery, and continuation             | Recover useful work after provider or daemon failure                                                   | `run-retries.ts`; `run-recovery.ts`; `continue-from-failure` route                           | Default host retry: three retries, 2s exponential base. Restart continuation requires a valid durable checkpoint.                                     | P0       |
| Conversation import/export                    | Preserve or share work                                                                                 | `import-service.ts`; `export-service.ts`                                                     | Export formats JSON (`nerve.conversation.v1`), Markdown, HTML. Import remaps IDs and skips malformed optional records.                                | P2       |
| File preview                                  | Inspect files cited by the agent                                                                       | `FilePane.svelte`; filesystem routes                                                         | Preview, not an editor. Text/image/Markdown supported; bounded/truncated previews and binary limitations must be stated.                              | P1       |
| Context panel and usage meter                 | Understand what is loaded and how full the model context is                                            | context components; context usage routes; composer toolbar                                   | Current usage can remain unknown until provider usage arrives.                                                                                        | P1       |
| Project scratch notes                         | Keep lightweight project-specific notes                                                                | `NotesPanelView.svelte`; scratch-note server domain                                          | Notes live in a docked panel and in Nerve state; avoid calling them tabs or repository files.                                                         | P2       |
| Git workbench                                 | Review state and perform common Git operations                                                         | `GitPanelView.svelte`; `git-routes.ts`                                                       | Repo/branch/change/commit view; stage, unstage, discard, fetch, pull, push, sync. Destructive actions use UI confirmation.                            | P1       |
| GitHub PR workbench                           | Review, check out, and merge PRs                                                                       | `GithubPrPane.svelte`; GitHub routes/service                                                 | Requires a GitHub remote, `gh`, and `gh auth login`. This is Workbench UI/server behavior, not an agent tool.                                         | P1       |
| Task panes and logs                           | Supervise long-running servers/watchers                                                                | task presentation and server task domain                                                     | Durable definitions and immutable runs; recovered process pipes cannot be reattached after restart.                                                   | P1       |
| App logs, diagnostics, storage cleanup        | Inspect and maintain local state                                                                       | `NerveLogsPane.svelte`; log/storage routes; crash reports                                    | Logs are queryable/prunable; crash reports are files, not browsable through a dedicated crash-report UI. Cleanup cancellation occurs between targets. | P1       |
| Themes, zoom, shortcuts, notifications        | Adapt the workbench and stay aware of completion                                                       | appearance/shortcut/notification state                                                       | System/light/dark; zoom levels -8…8; bindings are currently fixed; browser notifications require permission; sound is separate.                       | P2       |

### Composer and human-in-the-loop controls

| Capability                             | User value                                                                  | Confirmed evidence                                           | Constraints / accurate wording                                                                                                                                                                     | Priority |
| -------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Text sending and stopping              | Direct and interrupt work                                                   | `ComposerEditor.svelte`; `prompt-send.ts`; run-control tests | Enter and Ctrl/Cmd+Enter submit unless completion is open; stop targets the active run with race protection.                                                                                       | P0       |
| Queued/steering prompts                | Redirect an active run without waiting for it to finish                     | `prompt-send.ts`; `QueuedPromptRow.svelte`                   | Active-turn prompts use `run.steer`; queued items can be cancel-and-edited or discarded. Inline commands cannot queue.                                                                             | P0       |
| `/` command completion                 | Discover inline commands                                                    | `ComposerEditor.svelte:completionSource`                     | Completion list is host-supplied and capped with the shared completion result limit.                                                                                                               | P1       |
| `@` project path completion            | Reference project files/directories quickly                                 | same completion source and project completion provider       | This is project path completion, not people or agent mentions. Maximum 80 displayed options.                                                                                                       | P1       |
| Desktop file/folder path drops         | Mention existing filesystem items without typing their paths                | `handleFileDrop`; `resolveDroppedPaths`; Electron preload    | Electron only. Inserts editable path mentions at the selection; project items become relative, outside items remain absolute, and whitespace is quoted. It does not copy, upload, or attach items. | P1       |
| Clipboard image paste                  | Give image-capable models local image input                                 | `handlePaste`; `saveClipboardImage`                          | Clipboard images become OS-temp file paths. This is separate from path drops. No generic file picker, durable attachment UI, or thumbnail. MIME whitelist exists, but no size/signature guarantee. | P1       |
| Voice input                            | Dictate prompts and question responses                                      | voice session/controller; transcription service/contracts    | Requires OpenAI Codex/ChatGPT OAuth, not an API key; 8 minutes, 25 MB, three client retries; audio leaves the machine for transcription. Right-click cancels recording.                            | P1       |
| Prompt suggestions                     | Reuse contextual actions                                                    | suggestion app/server domain; `docs/prompt-suggestions.md`   | Built-in/user/project precedence; JS predicates execute only after hash-bound trust approval.                                                                                                      | P1       |
| Model/thinking/mode/permission toolbar | Change how the next model request works without recreating the conversation | `ComposerToolbar.svelte`; agent update routes/harness        | During a run, model/thinking changes apply to the next provider request. Choices depend on model metadata.                                                                                         | P0       |
| Approval, question, and plan cards     | Keep risky or ambiguous work under user control                             | approval/question/plan tool views                            | Main composer is blocked while a review gate is pending. Plan acceptance supports same chat, compact-first, or optional new chat.                                                                  | P0       |
| Context/todo indicators                | See token pressure and active work state                                    | composer toolbar/context/todo components                     | Usage may be unavailable; todos are agent-maintained task state, not background processes.                                                                                                         | P1       |

### Agent runtime, models, and providers

| Capability                                    | User value                                                 | Confirmed evidence                                | Constraints / accurate wording                                                                                                                                                                                                                                                                               | Priority |
| --------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Coding and planning modes                     | Separate implementation from researched planning           | `policy.ts`; planning tools; plan storage         | Planning is enforced as well as prompted: file writes only in plan storage, limited shell guardrails, no mutating integrations/tasks. Bash restrictions are guardrails, not a security sandbox.                                                                                                              | P0       |
| Read-only, supervised, autonomous permissions | Match agent authority to risk tolerance                    | policy evaluator and tests                        | A permission engine combines manifest/argument risk, hard constraints, permission level, request targets, and typed exceptions. Read only is local-only; Supervised always allows safe reads and asks otherwise unless an exact-risk allow applies; Autonomous still honors explicit blocks and hard guards. | P0       |
| Transparent evented harness                   | Follow provider streaming and tool lifecycle               | `AgentHarness`; workbench harness execution       | Nerve owns persistence/orchestration; pi-ai supplies provider/model streaming primitives. Do not market all pi-ai capabilities as exposed.                                                                                                                                                                   | P0       |
| Automatic context compaction                  | Continue long sessions                                     | harness compaction policy; auto-compaction runner | Balanced default 80% trigger/15% retained; up to three auto-continuations. Other profiles: 70/10 and 90/25. Summaries can omit details.                                                                                                                                                                      | P1       |
| Resource and skill loading                    | Add project/user guidance without modifying the harness    | `resource-loader.ts`; skill tests                 | Project definitions win by name; `.nerve`/`.agents` precedence must be documented exactly. Legacy `.pi` is not loaded. Changes apply on subsequent runs.                                                                                                                                                     | P1       |
| Provider authentication                       | Use API keys or supported subscriptions                    | auth schemas/manager/OAuth flow                   | API key and OAuth are mutually exclusive per provider. OAuth flows vary and only one callback-server flow can be active for selected providers. Credentials use encrypted secret storage.                                                                                                                    | P0       |
| Dynamic built-in provider/model catalog       | Choose among models pi-ai currently supplies through Nerve | auth/model routes and pi-ai metadata              | Do not promise every underlying provider/transport. UI-visible authenticated catalog is the current support boundary; some providers’ lists are capped at eight models.                                                                                                                                      | P0       |
| Custom providers/models                       | Connect compatible endpoints and describe model behavior   | provider catalog schemas and settings dialogs     | Provider IDs are lowercase slugs; transports come from supported pi-ai API types. Definitions can declare context/output/cost/reasoning/images, but not all metadata is exposed in the picker.                                                                                                               | P1       |
| Defaults, scopes, and Explore model           | Keep model lists manageable and assign research separately | scoped model settings                             | Empty scope means all authenticated models; stale entries remain stored but are ignored. Explore has a distinct default.                                                                                                                                                                                     | P1       |
| Thinking levels                               | Trade latency/cost for depth                               | thinking contracts/model picker                   | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`; runtime clamps to model support.                                                                                                                                                                                                                  | P1       |
| Usage and subscription windows                | Observe tokens, cost, context, and selected plan limits    | composer usage UI; subscription service           | Per-conversation values require provider usage events. Subscription windows exist only for OAuth Anthropic and OpenAI Codex; not general API-key billing.                                                                                                                                                    | P1       |
| Image-capable model calls                     | Analyze images when a model supports them                  | model definition modalities; harness image blocks | Composer does not gate image paste by selected model, and public model info omits modality. Copy must tell users to select a model known to support images.                                                                                                                                                  | P1       |

### Tools and integrations

| Capability                  | User value                                          | Confirmed evidence                                 | Constraints / accurate wording                                                                                                                                                             | Priority |
| --------------------------- | --------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| File/search tools           | Inspect and safely modify a workspace               | contracts tool names; filesystem catalog/executors | `read`, `grep`, `find`, `ls`, `edit`, `write`; bounded output, precise/atomic edits, mutation serialization. `read` can return image blocks.                                               | P0       |
| Finite Bash                 | Run builds, tests, Git, and scripts transparently   | shell catalog/executor                             | Noninteractive, bounded/streamed, process-tree termination; long-lived work belongs in tasks.                                                                                              | P0       |
| Finite Python               | Perform data/script work with artifacts             | Python catalog/executor                            | Optional runtime and globally disableable; exactly one code/file input; ≤600s; no stdin; env secret-name rejection. Planning guards are not a hard sandbox.                                | P1       |
| Web search/fetch            | Research current external information               | web executors                                      | Individually disableable. Search requires Tavily. Fetch: redirects, 60s, 10 MiB, raw/artifact fallback. Arbitrary outbound URLs mean internal-network safety must not be claimed.          | P1       |
| Jira                        | Read and update delivery work                       | Jira tool catalog                                  | Module/credential gated; single-target issues, boards, sprints, backlog, attachments, comments, worklogs, and links; mutations are supervised by tool policy.                              | P1       |
| Confluence                  | Read and publish project knowledge                  | Confluence tool catalog                            | Module/credential gated; single-page search/download/update plus comments, lifecycle, labels, restrictions, and attachments; no bulk publishing.                                           | P1       |
| Questions and todos         | Resolve ambiguity and track work                    | host tools/contracts                               | `ask_user` suspends for a reply; todos are structured current-run state.                                                                                                                   | P0       |
| Plan-mode tools             | Research, write a plan, and request review          | plan tool catalog/policy                           | Plans live in Nerve plan storage; implementation waits for explicit acceptance.                                                                                                            | P0       |
| Background task tools       | Supervise long-lived processes                      | task tool catalog/server                           | Start/status/log/cancel/restart; readiness and up to 24h runtime; env values encrypted at rest; agents should not poll after start.                                                        | P1       |
| Explore sub-agents          | Parallelize substantial read-only codebase research | Explore contracts/admission/subagent runner        | 1–8 tasks/call, 8 active children/run, 24 total launches/run; children are isolated/read-only with six tools.                                                                              | P1       |
| Agent Browser skill         | Add optional CLI-provided browser guidance          | `agent-browser-skills.ts`                          | It is opt-in `SKILL.md` prompt guidance discovered from the CLI, not a native browser automation tool/executor.                                                                            | P2       |
| Tool settings and lifecycle | Limit capabilities and inspect execution            | tool settings/records/adapter                      | Only web search, web fetch, and Python are globally user-toggleable individual tools. Jira/Confluence use module enablement. Every call has persisted lifecycle states and bounded output. | P0       |

### Desktop, connectivity, storage, and protocol

| Capability                     | User value                                                 | Confirmed evidence                        | Constraints / accurate wording                                                                                                                                                               | Priority |
| ------------------------------ | ---------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| npm/pnpm desktop launcher      | Start without native installers                            | desktop `bin.ts`; package/release scripts | Node 24+; Linux, Windows 11, macOS; Electron binary may download; no signed/notarized installers.                                                                                            | P0       |
| Electron-owned local daemon    | Keep a local-first one-app workflow                        | desktop main/profile/supervisor           | Defaults `127.0.0.1:3747`; health/restart supervision; only owned children are stopped. Chromium profile remains outside `NERVE_HOME`.                                                       | P0       |
| Browser/PWA                    | Use the workbench outside Electron                         | Vite PWA and app startup                  | Service worker is browser-only, deliberately disabled in Electron. Browser still depends on a running daemon.                                                                                | P1       |
| LAN/mobile HTTPS               | Reach Nerve on a trusted LAN                               | server bind gate and TLS material         | Explicit remote opt-in; HTTPS default 3748; self-signed local CA; token URLs are password-like. Not safe for public Internet exposure by itself.                                             | P0       |
| Remote daemon desktop mode     | Connect Electron to an existing daemon                     | connection service                        | Requires `--connect` and token; monitor-only, never owns/restarts/stops remote daemon.                                                                                                       | P1       |
| Token authentication           | Protect HTTP/WebSocket access                              | auth middleware/app server                | Bearer/cookie/query bootstrap. UI query token is exchanged for Strict HttpOnly cookie; token leakage remains material.                                                                       | P0       |
| Configuration and ports        | Isolate/customize operation                                | daemon CLI/env/settings                   | Document CLI/env/default precedence and all supported overrides. Source launcher defaults ports via env, which can outrank saved settings.                                                   | P1       |
| Local storage and cleanup      | Understand backup and disk use                             | storage domains/state marker              | `NERVE_HOME` default `~/.nerve`; canonical SQLite records plus owner-scoped payload files and rebuildable projections/cache; cleanup skips symlinks and protects active work.                | P0       |
| Legacy migration               | Upgrade without silent data loss                           | migration implementation/tests            | Whole-home timestamped backup; imports validated settings, custom catalog, and recoverable credentials—not projects/conversations/logs. README currently contradicts this and must be fixed. | P0       |
| Proxy/platform troubleshooting | Operate behind corporate networks and Linux display stacks | desktop proxy/bin/main; README            | Electron downloader and runtime proxy are separate; redacted diagnostics available. XWayland override remains a workaround for freezes.                                                      | P1       |
| Nerve Protocol v1              | Reliable local UI/server reconnect and recovery            | contracts/protocol/session tests          | Typed RPC, event streams, replay/snapshot/resync, no wire ACK. Existing ACK wording in README/diagrams must be corrected.                                                                    | P2       |

## Audience and journey taxonomy

Organize navigation by what readers are trying to accomplish, not by package or implementation feature.

1. **Evaluators** — “What is Nerve, why is it different, does it fit my security/workflow needs?” Journey: homepage → capabilities → local-first/security → install.
2. **First-time users** — “Install it, connect a model, open a project, complete a safe first task.” Journey: install → provider auth → first project → first conversation → approvals/review.
3. **Daily practitioners** — “Use the composer, conversations, Git, tasks, skills, suggestions, and recovery efficiently.” Journey: workflow guides linked contextually rather than one giant feature tour.
4. **Integrators/power users** — “Enable network/data integrations, custom providers, browser/mobile access, or remote topology.” Journey: integration prerequisites → configuration → permissions/security → troubleshooting.
5. **Operators/security-conscious users** — “Know where data lives, what is exposed, how auth/migration/cleanup/diagnostics work.” Journey: advanced operation → security model → storage → troubleshooting.
6. **Contributors/extension authors** — “Understand architecture, protocol, contracts, tools, package boundaries, and contribution/release expectations.” Journey: architecture → extension model/protocol → development → repository governance.

Each public page starts with who it is for and the outcome, then prerequisites, steps/concepts, constraints/warnings, and next links. Package names appear only in developer pages.

## Information architecture

### Marketing homepage (`/`)

1. Hero: “A transparent, local-first coding harness” with install command and docs/GitHub calls to action.
2. Product proof: current workbench screenshot and the three differentiators—transparent execution, live control, local ownership.
3. Core workflow: open project → direct agent → review tools/approvals → inspect changes/PR/tasks.
4. Capability groups: workbench, agent control, integrations, Git/tasks, model choice.
5. Local-first topology diagram and concise security caveat.
6. Open-source/beta/platform statement.
7. Final quick-start call to action.

Avoid unsupported comparative claims, exhaustive provider logos, fabricated testimonials, download buttons for nonexistent installers, or “fully sandboxed/private” language.

### Documentation navigation

- **Start here** — guided `/start/` hub, overview, install, first project, providers, first task.
- **Workflows** — workbench, composer, conversations/history, controls, review gates, files/context/notes, Git/PRs, tasks, suggestions, skills, personalization, import/export.
- **Models & integrations** — model/provider concepts, custom definitions, usage/images/voice, web/Python, Jira, Confluence, Agent Browser, editors.
- **Operate safely** — browser/PWA, LAN/mobile, remote daemon, configuration, storage/migration, security, diagnostics.
- **Troubleshooting** — decision-oriented symptom pages.
- **Developers** — architecture, harness, tools/policy, persistence/security boundary, Nerve Protocol v1, extension model, development and contribution.
- **Reference** — CLI/env, shortcuts, tool catalog, resource precedence, suggestion format, storage/export formats.

## Page-level content backlog

The tables define the first publishable corpus. “Visual / warning” specifies either a useful asset or the warning that must be prominent. Every page must include “Next steps” links.

### Homepage and start here

| Route                   | Purpose and key sections                                                                             | Prerequisites / cross-links                        | Visual / warning                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/`                     | Positioning, proof, workflow, capabilities, topology, beta/open-source CTA                           | Links to install, security, workbench, GitHub      | Hero workbench image; 3-node Electron/UI/daemon diagram; beta and trusted-network warning       |
| `/start/overview/`      | Explain desktop workbench, daemon, project relationship, core terms                                  | None → install, architecture                       | Annotated overview screenshot; avoid calling Nerve an IDE/editor                                |
| `/start/install/`       | Node 24 requirement; `npx`/`pnpm dlx`; first Electron download; platform support; source alternative | Overview → provider setup, install troubleshooting | Terminal snippet; no native-installer implication                                               |
| `/start/providers/`     | Add provider; API key vs OAuth; choose default/scoped/Explore model; thinking level                  | Installed app → first project, model guide         | Auth/settings screenshot; credential and provider-specific warning                              |
| `/start/first-project/` | Directory picker, project record, first conversation, supervised default, send/review/stop           | Install + provider → first task                    | Project picker and composer screenshots; selected directory gives tools direct workspace access |
| `/start/first-task/`    | Safe walkthrough: ask for inspection, review plan/diff, approve mutation, run validation             | First project → permissions, Git                   | Transcript approval screenshot; use disposable/committed workspace                              |

### Use Nerve

| Route                            | Purpose and key sections                                                                                                               | Prerequisites / cross-links                           | Visual / warning                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `/guides/workbench/`             | Three-pane shell, tabs, panels, moving/hiding/resizing, responsive sheets, project search                                              | First project → panels, shortcuts                     | Annotated desktop + mobile screenshot                                                               |
| `/guides/composer/`              | Send/stop, keyboard behavior, `/` commands, `@` paths, desktop file/folder path drops, queue/cancel-edit, context/todos                | First project → images/voice, controls                | Toolbar + completion + queued prompt sequence; distinguish path mentions from uploads/attachments   |
| `/guides/images-and-voice/`      | Paste image paths, distinguish dropped existing paths, supported clipboard MIME behavior, model compatibility, recording/transcription | Composer + compatible model/OAuth → model guide       | Paste/voice states; temp-file, external transcription, 8m/25MB warning                              |
| `/guides/agent-controls/`        | Coding/planning, read-only/supervised/autonomous, read autoapproval, durable supervised grants, live model/thinking changes            | Provider setup → approvals, security                  | Composer controls screenshot; “next model request” wording                                          |
| `/guides/reviews/`               | Tool approvals, user questions, plan review options, blocked composer, dismiss/reply                                                   | Agent controls → planning, permissions                | One transcript showing all card types                                                               |
| `/guides/conversations/`         | Create/name/search/delete, active status, tabs, transcript behavior                                                                    | First project → history, export                       | Conversation navigator screenshot                                                                   |
| `/guides/history-and-recovery/`  | History graph, navigate/branch, edit-resend, compaction entries, retries, failure continuation                                         | Conversations → context, troubleshooting              | History graph screenshot; branch and checkpoint limitations                                         |
| `/guides/files-context-notes/`   | File previews, line targeting/wrap/Markdown, context panel/usage, project notes                                                        | Workbench → resource files                            | Combined panel screenshot; previews/not editor, truncation warning                                  |
| `/guides/git-and-pull-requests/` | Repo overview, staging, branches, sync, PR list/detail/checks/files/checkout/merge, follow-up prompts                                  | Git repo; GitHub requires `gh` auth → troubleshooting | Git + PR screenshots; destructive/remote action warning; UI integration ≠ tool                      |
| `/guides/background-tasks/`      | Definitions/runs, single vs concurrent, start/readiness/logs/stop/restart/history, agent notifications, recovery states                | Project → task reference, recovery troubleshooting    | Task list + terminal; recovered pipes freeze                                                        |
| `/guides/prompt-suggestions/`    | Built-ins, user/project definitions, precedence, toggles, contextual chips, JS trust                                                   | Project → suggestion-format reference                 | Settings/chips/trust dialog; arbitrary JS trust warning                                             |
| `/guides/skills-and-resources/`  | AGENTS/SYSTEM/context/skills locations, precedence, toggles, effective next-run behavior                                               | Project → resource reference, Agent Browser           | Skills settings + precedence diagram; project files are trusted instructions                        |
| `/guides/personalize/`           | Themes, zoom, fixed shortcuts, notifications/sounds, panel layout                                                                      | Workbench → shortcut ref, browser operation           | Appearance/settings screenshot; browser permission caveat                                           |
| `/guides/import-export-editors/` | JSON/MD/HTML conversation export/import; launch VS Code/Zed; project deletion/pruning distinctions                                     | Existing conversation/project → storage               | Export menu screenshot; malformed import records may be skipped; editor support is only VS Code/Zed |

### Models and integrations

| Route                             | Purpose and key sections                                                                               | Prerequisites / cross-links                              | Visual / warning                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `/models/providers-and-auth/`     | Dynamic provider catalog; API key vs OAuth; credential replacement/removal; OAuth flow troubleshooting | Installed app → model selection, security                | Provider settings screenshot; do not freeze a “supports every pi-ai provider” list |
| `/models/selecting-models/`       | Defaults, last selection, scopes, Explore model, thinking support, context/output metadata             | Authenticated provider → usage/custom models             | Picker/scopes screenshot; catalog truncation and stale-scope behavior              |
| `/models/custom-providers/`       | Endpoint URL, supported transport, headers/compatibility, auth, custom model fields                    | Compatible endpoint knowledge → security/troubleshooting | Provider/model dialogs; removal cascades model/secret data                         |
| `/models/usage-images-voice/`     | Conversation tokens/cache/cost/context, limited subscription windows, image declarations, voice auth   | Provider setup → composer media guide                    | Usage meter screenshot; not billing authority; modality is not picker-gated        |
| `/integrations/web/`              | Enable search/fetch, Tavily setup, output/artifacts, limits                                            | Network permission + key → tool/permission ref           | Tool settings/call screenshot; outbound URL and retrieved-content trust warning    |
| `/integrations/python/`           | Runtime discovery/path, enabling, finite scripts, artifacts/env/timeouts                               | Local Python → tasks, tool ref                           | Settings + artifact result; not server use or hard sandbox                         |
| `/integrations/jira/`             | Enable/connect, read vs mutation tools, common workflows, approvals                                    | Atlassian credentials → permissions                      | Integration settings + issue tool card; data leaves local machine                  |
| `/integrations/confluence/`       | Enable/connect, search/download/publish/attachments, artifacts/approvals                               | Atlassian credentials → permissions                      | Page tool card; mutation and attachment warning                                    |
| `/integrations/agent-browser/`    | CLI prerequisite, skill discovery/toggle, prompt guidance behavior                                     | Installed Agent Browser CLI → skills                     | Skills screenshot; explicitly not native browser-control executor                  |
| `/integrations/external-editors/` | VS Code/Zed discovery and launching                                                                    | Editor installed → project guide                         | Project action screenshot; only these editors confirmed                            |

### Advanced operation and troubleshooting

| Route                                     | Purpose and key sections                                                                                                 | Prerequisites / cross-links                      | Visual / warning                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `/operations/browser-pwa/`                | Start daemon/UI, browser use, install PWA, service-worker behavior, responsive layout                                    | Running daemon → LAN/mobile                      | Desktop/browser topology diagram; PWA does not host the daemon                      |
| `/operations/lan-mobile/`                 | Explicit bind, `--allow-remote`, `--mobile-https`, CA installation, token bootstrap, tray URLs                           | Trusted LAN → security/connectivity troubleshoot | LAN sequence diagram; token URL/CA/public Internet warning                          |
| `/operations/remote-daemon/`              | `--connect`/token, ownership and monitor-only semantics, reconnect behavior                                              | Existing reachable daemon → config/security      | Local vs remote topology diagram; shell will not manage remote daemon               |
| `/operations/configuration/`              | CLI flags, env vars, saved setting precedence, ports 3747/3748, isolation overrides                                      | Advanced user → CLI ref, connectivity            | Precedence diagram; source launcher env can override saved ports                    |
| `/operations/storage-migration/`          | `NERVE_HOME`, profile separation, state categories, backup, cleanup/prune, v2 migration                                  | Backup awareness → diagnostics/security          | Storage boundary diagram; selective migration table and never-delete-backup warning |
| `/operations/security/`                   | Local-first boundary, token auth, permissions vs sandboxing, network tools, credentials, LAN threats, Electron hardening | All users → integrations/LAN/SECURITY.md         | Trust-boundary diagram; beta/no-untrusted-network warning                           |
| `/operations/diagnostics/`                | Logs UI/files, desktop/daemon JSONL, crash reports, storage inspection/cleanup, redacted proxy diagnostics               | Failure symptom → troubleshooting                | Logs pane screenshot; crash files may contain sensitive operational context         |
| `/troubleshooting/`                       | Symptom decision tree linking focused pages                                                                              | None → all troubleshooting pages                 | No screenshot; collect version/platform/redacted logs first                         |
| `/troubleshooting/install-and-proxy/`     | Electron download, corporate proxy/CA/mirror/cache, missing binary                                                       | Install → diagnostics                            | Command blocks for shell/PowerShell; never commit proxy credentials                 |
| `/troubleshooting/connectivity/`          | Port conflicts, daemon health, token/cookie, LAN certificate, remote reconnect                                           | Operations guides → diagnostics                  | Connection flow; never post token-bearing URLs                                      |
| `/troubleshooting/providers/`             | API-key/OAuth failures, callback concurrency, TLS/proxy/PKCE restart, missing/truncated models, voice auth               | Provider guide → diagnostics                     | OAuth states; Anthropic paid-extra-usage disclosure                                 |
| `/troubleshooting/platform/`              | Linux Wayland/XWayland, Windows/macOS process caveats, Electron profile reset boundaries                                 | Install → storage                                | No screenshot; platform support does not mean signed installers                     |
| `/troubleshooting/tasks-and-recovery/`    | interrupted/recovered/recovery_unknown, frozen historical output, safe stop/restart                                      | Tasks → diagnostics                              | State diagram; do not signal unverifiable/reused PID                                |
| `/troubleshooting/storage-and-migration/` | incompatible/malformed/future state, selective legacy import, backup recovery, cleanup cancellation                      | Storage guide → release engineering docs         | Migration flow; stop all Nerve processes before manual state work                   |

### Developers and reference

| Route                               | Purpose and key sections                                                                                                                                                                  | Prerequisites / cross-links                | Visual / warning                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `/developers/architecture/`         | Runtime topology, package responsibilities, data/control boundaries                                                                                                                       | Source checkout → package map/protocol     | Rendered system/desktop diagrams corrected to remove ACK claims                             |
| `/developers/packages/`             | Contracts, protocol, harness, tools, server, app, shell, ui-kit responsibilities and allowed dependencies                                                                                 | Architecture → contribution guide          | Dependency diagram sourced from corrected PlantUML                                          |
| `/developers/harness/`              | pi-ai boundary, per-turn snapshots, streaming loop, queues, compaction, recovery, resources                                                                                               | Architecture → tools/models                | Agent/run sequence diagram; distinguish underlying library capabilities                     |
| `/developers/tools-policy/`         | Manifest, local/host executors, risk traits, lifecycle, approvals, planning/read-only enforcement                                                                                         | Harness → tool catalog/extension model     | Policy decision diagram; policy is not OS sandboxing                                        |
| `/developers/persistence-security/` | canonical records, payload files, event streams/indexes, secrets, auth, Electron boundary, migration                                                                                      | Architecture → protocol/security           | Storage/trust diagram; schema allowance is not a redaction guarantee                        |
| `/developers/protocol/`             | Protocol goals, roles, handshake, RPC, event streams, replay/snapshot/resync, versioning                                                                                                  | Architecture → v1 reference pages          | Sequence diagram; explicitly no wire ACK                                                    |
| `/developers/protocol/v1/*`         | Migrate and correct the existing v1 overview, envelope, HTTP, lifecycle, stream, recovery, backpressure, errors/security, extension, examples, implementation guide/status/coverage pages | Protocol overview → contracts              | Keep versioned; completeness/status claims must match integration evidence                  |
| `/developers/extensions/`           | Add operation/event schemas, handlers/reducers, tools, skills/suggestions; capability negotiation and tests                                                                               | Protocol/tools → contributing              | Extension flow diagram; no v1 aliases/raw private frames                                    |
| `/developers/development/`          | Node/pnpm setup, root scripts, source launch, UI-only dev target, tests/build                                                                                                             | Source checkout → contributing/release     | Command blocks; use isolated overrides for risky migration testing                          |
| `/developers/contributing/`         | Focused changes, test philosophy, boundaries, docs editing, security reporting                                                                                                            | Development → GitHub CONTRIBUTING/SECURITY | No screenshot; vulnerabilities remain private                                               |
| `/reference/cli-environment/`       | Desktop/server flags and environment variables with defaults/precedence                                                                                                                   | Operations config                          | Warning markers for secret/token/debug values                                               |
| `/reference/shortcuts/`             | Current fixed shortcut table grouped by navigation/run/composer/appearance                                                                                                                | Workbench/personalize                      | OS modifier notation; generated/verified from shortcut registry during writing              |
| `/reference/tools/`                 | Agent tool names grouped by file, execution, web, Atlassian, interaction, task, Explore, planning; risk/prereq/availability                                                               | Tools policy/integrations                  | State that Git/PR UI and Agent Browser are not tool entries                                 |
| `/reference/resources/`             | Exact AGENTS/SYSTEM/skills path and precedence tables; toggle semantics                                                                                                                   | Skills guide                               | Root-to-project precedence diagram; no legacy `.pi` loading                                 |
| `/reference/prompt-suggestions/`    | Full frontmatter/conditions/JS contract, paths, precedence/trust                                                                                                                          | Suggestions guide                          | Code examples; JS trust warning                                                             |
| `/reference/data-formats/`          | Conversation export formats, state/log/crash locations, task artifacts and temp image behavior                                                                                            | Storage/import-export                      | Paths are defaults and move with `NERVE_HOME`; temp image paths are not durable attachments |

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
| Which pi-ai providers are officially “supported”          | Describe the catalog as dynamically exposed through Nerve; name OAuth examples only as current observed options, not a permanent compatibility promise. Do not market all ten internal transports.                                                                            |
| Images accepted with a text-only selected model           | Document paste behavior and require a model known to support image input; explicitly say the picker currently does not enforce modality.                                                                                                                                      |
| Anthropic OAuth may incur paid extra usage                | Repeat the in-product warning on auth/provider troubleshooting pages.                                                                                                                                                                                                         |
| Some provider lists are capped at eight                   | Document this as a current catalog limitation and troubleshoot custom model definitions where appropriate.                                                                                                                                                                    |
| Subscription usage appears only for Anthropic/Codex OAuth | Label it subscription-window information, not generic billing or API-key usage.                                                                                                                                                                                               |
| “Live configuration changes”                              | Limit the claim to agent model/thinking/mode/permission changes applying to subsequent work; do not say every server setting hot-reloads. Mention Python runtime path as the confirmed immediate refresh.                                                                     |
| “Fork” and “scratch notes in tabs” README language        | Use “navigate/branch from history” and “Notes panel.”                                                                                                                                                                                                                         |
| Composer attachments                                      | Distinguish desktop path drops from clipboard image paste. Dropped items become editable existing-path mentions, not copied/uploaded attachments; pasted images become temporary local files. Do not claim a generic file picker, thumbnail attachment UI, or durable upload. |
| Agent Browser                                             | Call it imported prompt-skill guidance, not browser automation.                                                                                                                                                                                                               |
| Git/GitHub                                                | Separate Workbench UI routes from agent-callable tools; agent Git use is indirect through Bash.                                                                                                                                                                               |
| Web fetch security                                        | Warn that it performs outbound fetches and do not claim SSRF/internal-network isolation.                                                                                                                                                                                      |
| Python planning guards                                    | Call them guardrails, not a sandbox.                                                                                                                                                                                                                                          |
| Crash diagnostics                                         | Explain filesystem reports; do not promise an in-app crash-report browser.                                                                                                                                                                                                    |
| Legacy migration                                          | Follow implementation/tests: settings, custom provider/model catalog, and recoverable credentials import; operational history stays in backup.                                                                                                                                |
| Protocol ACK references                                   | Replace with processed cursors, subscriptions, replay, and resync. Explain any retained `ACK_INVALID` enum as reserved/legacy if it remains in public reference.                                                                                                              |
| Native release CI assertions                              | State only what workflows currently execute; do not claim workbench-server native release tests where release workflow does not run them.                                                                                                                                     |
| Token-bearing LAN URLs                                    | Prominently warn against sharing, logs, screenshots, clipboard history, and untrusted browser history; HTTPS does not neutralize token disclosure.                                                                                                                            |

Before polishing final marketing copy, product ownership can later decide whether to formalize a provider support matrix, add model-modality gating, define a stronger web-fetch network boundary, expose crash reports in UI, or broaden editor support. The first site does not depend on those future decisions.

## Implementation steps

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

## Validation

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

## Risks and mitigations

- **Scope/content volume:** Do not trade accuracy for page count. Write in the ordered review slices above; no empty pages are deployed. The IA can contain only pages that have complete first-pass copy at launch.
- **Rapid product drift:** Keep the evidence matrix and symbol owners; require docs updates in code reviews that change user-visible contracts, tool catalogs, shortcuts, CLI flags, or storage behavior.
- **Duplicate sources:** Complete moves atomically with link updates and deletion of old public prose. Root documents summarize/link rather than mirror.
- **Custom-domain outage:** GitHub Pages configuration and Cloudflare DNS are external prerequisites. The built artifact remains valid at the Pages deployment URL while DNS validates, but canonical metadata targets `nerve.tlmtech.dev`.
- **Protocol status overstatement:** Retain explicit implementation-status/coverage pages and qualify package-test evidence versus end-to-end compatibility.
- **Security marketing risk:** Never equate local-first with offline-only, permissions with sandboxing, self-signed HTTPS with Internet-safe exposure, or encrypted credential storage with zero trust.
- **Screenshot churn:** Use existing images for first drafts, maintain a shot list, and capture final assets only after workflows and page sections settle.
- **Framework over-customization:** Use Starlight defaults and small Astro components; postpone bespoke visual systems until content and navigation have user feedback.

## Phased content-writing and review plan

1. **Phase A — inventory and terminology (first artifact):** maintain `packages/website/content-strategy.md`, correct high-risk factual drift, establish canonical ownership and glossary.
2. **Phase B — successful first hour:** homepage + Start Here + agent controls/reviews. Review with a clean-home user journey.
3. **Phase C — daily coding workflow:** workbench, composer, conversation history, context/files/notes, Git/PRs, tasks, skills/suggestions, import/export. Review against UI and focused tests.
4. **Phase D — models and integrations:** auth, model scopes/thinking/usage, custom providers, media/voice, Web/Python/Atlassian/Agent Browser/editors. Review credentials, data flow, and provider limitations.
5. **Phase E — operation and safety:** browser/PWA, LAN/mobile, remote daemon, configuration, storage/migration, diagnostics, security. Perform dedicated security and migration review.
6. **Phase F — troubleshooting and reference:** symptom pages, exact tables, protocol v1 migration/corrections, contributor architecture. Validate source symbols and links.
7. **Phase G — publish and learn:** deploy to GitHub Pages/custom domain, verify production, collect issue feedback, then decide whether richer homepage styling, videos, changelog/versioning, or translations are justified.

Website implementation begins in Phase B only after Phase A’s inventory artifact is written; within each later phase, prose and evidence review precede screenshot polish and layout customization.
