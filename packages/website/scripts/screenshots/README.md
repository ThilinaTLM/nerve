# Screenshot pipeline

Published workbench screenshots are produced by this pipeline, not captured by
hand. The point is that refreshing them after a UI change is one command rather
than an afternoon of cropping.

```sh
pnpm --filter @nervekit/website screenshots
```

That runs, in order:

1. **Seed** — `packages/workbench-server/scripts/seed-demo-home.ts` builds a
   throwaway home at `$TMPDIR/nerve-demo-home` (the seed and daemon run with
   `HOME=$TMPDIR/nerve-demo-user`, so real skills and settings never show) and three synthetic projects
   under `$TMPDIR/nerve-demo-workspace`, with realistic repositories, a linked
   worktree, conversations, file edits, branches,
   retained sub-agents, and asynchronous Bash output.
2. **Build** — `pnpm build:workbench-runtime`, so the daemon serves the current
   workbench rather than a stale bundle.
3. **Daemon** — started on `127.0.0.1:3847` against the demo home.
4. **Capture** — `capture.ts` drives Chromium through each scene in
   `scenes.ts`, in light and dark, writing PNGs and text snapshots to
   an isolated `.screenshots/refresh-*` directory (gitignored). Only this
   invocation's output is privacy-checked and optimized. The capture context
   supplies synthetic Anthropic subscription quotas and GitHub read responses
   via `demo-usage.ts` and `demo-github.ts`. The browser advertises a fictional
   GitHub remote for aurora-api; no remote is added on disk. All other requests
   reach the demo daemon unchanged. The browser context carries the demo
   home's local token cookie (`secrets/daemon-token`), which the access gate
   requires; without it the workbench shows the device pairing screen. No account credentials or live GitHub data
   are needed.
5. **Privacy check** — `check-captures.ts` scans the text snapshots for
   credentials, emails, private IPs, real home paths, and unexpected absolute
   paths.
6. **Optimize** — `optimize.ts` converts to WebP into
   `src/assets/screenshots/{desktop,mobile}/`, rejecting incomplete light/dark
   pairs and wrong dimensions.

## Safety rules

- The seed script **refuses** any `NERVE_HOME` or workspace outside the system
  temp directory. It will never touch `~/.nerve`.
- The daemon runs on port `3847`, never the default `3747`.
- All demo content is invented. Aurora, Northstar Journal, and Relayboard are
  not real products, and `demo@aurora.example` is not a real person.

## One-time setup

```sh
pnpm --filter @nervekit/website exec playwright install chromium
```

## Useful flags

```sh
# From packages/website: refresh the three current desktop pairs
tsx scripts/screenshots/run.ts --kind=desktop --scenes=conversation,async-bash,launches

# One scene in both themes, reusing an existing seed and build
tsx scripts/screenshots/run.ts --kind=desktop --scenes=git --skip-seed --skip-build

# Capture the synthetic PR, header Notifications, and pending decision scenes
tsx scripts/screenshots/run.ts --kind=desktop --scenes=pull-request,notifications,ask-user
```

`--kind` selects `desktop`, `mobile`, or `both` (default). `--scenes` accepts
comma-separated IDs from `scenes.ts`: `conversation` shows retained sub-agents,
`async-bash` shows retained background command output, and `launches` shows
project launch configurations and a completed run. `editor` opens the rate-limit
middleware in the built-in text editor and leaves an unsaved draft with the
conversation available in the adjacent tab. Optimization requires both
light and dark captures, so omit `--theme` when running the full pipeline.
The runner prints the isolated raw-output directory for inspection.

Desktop scenes: `ask-user`, `notifications` (popover with a question, a failure, and a
stopped agent plus Mute 1 h), `folder-browser` (Open project dialog on the demo
workspace), `quote` (selection toolbar over a rich reply), `quick-script` (a retained `quick_script` card with its Jira, Confluence, and web SDK calls), `extensions` (Settings → Extensions overview with Atlassian enabled), `discover`, `themes`
(Settings → Appearance), `projects`, `conversation`, `async-bash`,
`git`, `editor`, `files`, `history`, `launches`, `pull-request`.
Homepage scenes: `forge-build` (the Forge conversation that builds the Environments extension, with its panel docked), `extension-panel` (a coding conversation with the same panel), `extension-consent` (the Allow dialog of an unreviewed project extension), `mcp-servers`, `integrations-script` (one `quick_script` using `jira`, `mcp` and `confluence`), `accounts`, `launchpad` (Coding, Planning, Lead and Forge starter cards), `settings-layers` (Skills with team skills Needs review, Trusted and Declined, plus the User and Project switches), `remote-tailscale`. Mobile scenes:
`conversation`, `composer-sheet`, `right-sheet`, `mobile-settings`. Re-run one with
e.g. `tsx scripts/screenshots/run.ts --scenes=discover --kind=desktop`
(single scenes need both themes, so omit `--theme`).

Capture seeds only `nerve-theme` (nerve-light or nerve-dark) and a
`nerve.discover.state` that disables Discover auto-open; the `discover` scene
opens it explicitly. `ask-user` shows the pending decision's recommended choices and
answer field above the composer, and `notifications` lists it. They use a schema-valid retained `ask_user`
interaction seeded through the current event/tool repositories, without a
provider call. Voice input remains disconnected in this synthetic environment.

`quick-script` opens a retained `quick_script` tool call stored in the shape the
card reads (`details.hostCalls`, `details.created`). `extensions` relies on the
seed enabling the Atlassian extension for a fictional account on
`aurora.example` through the same accounts and extension-settings services
Settings uses; the API token is a placeholder and nothing contacts that site.

`git` shows the Git changes tab: the repository tree (aurora-api with two
linked worktrees, one on `feat/rate-limiting` whose synthetic PR has failing
checks so the Attention filter has an entry, plus three more repositories),
the All/Changed/Attention filters, and the Selected branch and Changes
sections. The Changes section starts collapsed and is expanded by the scene.
`files` runs a project content search from the Search tab and opens a match.

The unused historical `tasks` assets have been removed; `launches` captures the
current launch workflow.

## The Aurora team demo

The seed tells one story around Aurora: Jira key `AUR` and Confluence space `REL` on
`aurora.example`, the repositories `aurora-api`, `aurora-web`, `aurora-infra` and `aurora-mobile`,
PR #42 and launches `web: dev`, `api: dev`, `api: tests`, `api: migration check`,
`api: seed venues` and `qa smoke`. Beyond conversations it seeds, through the same services
Settings uses:

- **Project extensions** in `aurora/.nerve/extensions/`. `env-status` (sources in
  `demo-data/env-status-extension.ts`) is scaffolded with `nerve-ext init`, built with
  `nerve-ext build` through a link to the workspace SDK (build `packages/extension-sdk` first),
  and allowed with `extensionCatalog.grantConsent`. Its Environments panel shows fixed data.
  `status-page` is built and left unreviewed for the `extension-consent` scene.
- **MCP servers** `github` and `docs` saved with `mcpService.save` (approved, secrets in the vault).
  Their commands never start: the seed writes their tool lists into the tool index
  (`demo-data/mcp-servers.ts`), so the page shows tool counts and no error.
- **Skills**: one user skill and three Aurora skills decided through the trust service.
- **Conversations**: a Forge transcript (`demo-data/forge-conversations.ts`) that writes, checks
  and reloads `env-status`, and a `quick_script` that combines Jira, GitHub through MCP and Confluence.
- The Atlassian account and the credential refresh job (Settings → Jobs) need no extra
  seeding.

The capture browser presents the daemon's Tailscale tunnel as ready (`demoTunnelHints` in
`demo-usage.ts`, applied to protocol messages and `/api/client-config`) and, for `mobile-settings`,
the browser as a paired phone with notifications on. Both are browser-side only.

## Sizes

| Group   | Viewport | DPR | Source    |
| ------- | -------- | --- | --------- |
| desktop | 1440×900 | 2   | 2880×1800 |
| mobile  | 390×844  | 3   | 1170×2532 |

Mobile framing must stay 390:844 because `PhoneFrame.astro` covers to that
aspect ratio.

## The pull-request scene

The pull-request scene always runs against invented Aurora PRs. A browser-only
WebSocket proxy answers GitHub status/list/detail reads and annotates the demo
repository summary; it never intercepts mutations. Fixtures are checked against
the current contracts in `demo-github.test.ts`. No clone, network access, GitHub
authentication, or real author/comment data is required.

## Adding a scene

1. Add an entry to `DESKTOP_SCENES` or `MOBILE_SCENES` in `scenes.ts` with an
   `id`, descriptive `alt`, and a `drive(page)` that leaves the UI in the exact
   state to capture. Prefer accessible names and `data-view-id` over CSS paths.
2. If the scene needs new demo content, extend the declarative project data in
   `packages/workbench-server/scripts/demo-data/` rather than staging state
   through the UI.
3. Run the pipeline, review both frames, then import the new pair in the
   consuming component or MDX page.

## Manual sign-off

The pipeline cannot judge composition. Before committing, confirm for every
frame: current version label, no pointer, no hover state, no loading skeletons,
identical scroll position and selection between light and dark, and no
unintentional error states.
