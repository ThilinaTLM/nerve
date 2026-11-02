# Screenshot pipeline

Published workbench screenshots are produced by this pipeline, not captured by
hand. The point is that refreshing them after a UI change is one command rather
than an afternoon of cropping.

```sh
pnpm --filter @nervekit/website screenshots
```

That runs, in order:

1. **Seed** — `packages/workbench-server/scripts/seed-demo-home.ts` builds a
   throwaway home at `$TMPDIR/nerve-demo-home` and three synthetic projects
   under `$TMPDIR/nerve-demo-workspace`, with realistic repositories,
   conversations, file edits, branches, retained sub-agents, and asynchronous
   Bash output.
2. **Build** — `pnpm build:workbench-runtime`, so the daemon serves the current
   workbench rather than a stale bundle.
3. **Daemon** — started on `127.0.0.1:3847` against the demo home.
4. **Capture** — `capture.mjs` drives Chromium through each scene in
   `scenes.mjs`, in light and dark, writing PNGs and text snapshots to
   an isolated `.screenshots/refresh-*` directory (gitignored). Only this
   invocation's output is privacy-checked and optimized. The capture context
   supplies synthetic Anthropic subscription quotas and GitHub read responses
   via `demo-usage.mjs` and `demo-github.mjs`. The browser advertises a fictional
   GitHub remote for aurora-api; no remote is added on disk. All other requests
   reach the demo daemon unchanged. No account credentials or live GitHub data
   are needed.
5. **Privacy check** — `check-captures.mjs` scans the text snapshots for
   credentials, emails, private IPs, real home paths, and unexpected absolute
   paths.
6. **Optimize** — `optimize.mjs` converts to WebP into
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
node scripts/screenshots/run.mjs --kind=desktop --scenes=conversation,async-bash,launches

# One scene in both themes, reusing an existing seed and build
node scripts/screenshots/run.mjs --kind=desktop --scenes=git --skip-seed --skip-build

# Capture the synthetic PR, header Notifications, and pending decision scenes
node scripts/screenshots/run.mjs --kind=desktop --scenes=pull-request,notifications,ask-user
```

`--kind` selects `desktop`, `mobile`, or `both` (default). `--scenes` accepts
comma-separated IDs from `scenes.mjs`: `conversation` shows retained sub-agents,
`async-bash` shows retained background command output, and `launches` shows
project launch configurations and a completed run. `editor` opens the rate-limit
middleware in the built-in text editor and leaves an unsaved draft with the
conversation available in the adjacent tab. Optimization requires both
light and dark captures, so omit `--theme` when running the full pipeline.
The runner prints the isolated raw-output directory for inspection.

Desktop scenes: `ask-user`, `notifications` (popover with a question, a failure, and a
stopped agent plus Mute 1 h), `folder-browser` (Open project dialog on the demo
workspace), `quote` (selection toolbar over a rich reply), `discover`, `themes`
(Settings → Workbench → Appearance), `projects`, `conversation`, `async-bash`,
`git`, `editor`, `history`, `launches`, `pull-request`. Mobile scenes:
`conversation`, `composer-sheet`, `right-sheet`. Re-run one with
e.g. `node scripts/screenshots/run.mjs --scenes=discover --kind=desktop`
(single scenes need both themes, so omit `--theme`).

Capture seeds only `nerve-theme` (nerve-light or nerve-dark) and a
`nerve.discover.state` that disables Discover auto-open; the `discover` scene
opens it explicitly. `ask-user` shows the pending decision's recommended choices and
answer field above the composer, and `notifications` lists it. They use a schema-valid retained `ask_user`
interaction seeded through the current event/tool repositories, without a
provider call. Voice input remains disconnected in this synthetic environment.

The unused historical `tasks` assets have been removed; `launches` captures the
current launch workflow.

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
the current contracts in `demo-github.test.mjs`. No clone, network access, GitHub
authentication, or real author/comment data is required.

## Adding a scene

1. Add an entry to `DESKTOP_SCENES` or `MOBILE_SCENES` in `scenes.mjs` with an
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
