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
   conversations, file edits, branches, and background-task history.
2. **Build** — `pnpm build:workbench-runtime`, so the daemon serves the current
   workbench rather than a stale bundle.
3. **Daemon** — started on `127.0.0.1:3847` against the demo home.
4. **Capture** — `capture.mjs` drives Chromium through each scene in
   `scenes.mjs`, in light and dark, writing PNGs and text snapshots to
   `.screenshots/` (gitignored).
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
# One scene, one theme, reusing an existing seed and build
node scripts/screenshots/run.mjs --scenes=git --theme=dark --skip-seed --skip-build

# Include the pull-request scene (needs network and GitHub auth, see below)
node scripts/screenshots/run.mjs --github
```

## Sizes

| Group   | Viewport | DPR | Source    |
| ------- | -------- | --- | --------- |
| desktop | 1440×900 | 2   | 2880×1800 |
| mobile  | 390×844  | 3   | 1170×2532 |

Mobile framing must stay 390:844 because `PhoneFrame.astro` covers to that
aspect ratio.

## The pull-request scene

Pull-request data cannot be synthesized — it needs a real remote. That scene is
captured against the project's own **public** repository and is skipped unless
`--github` is passed and the capture environment is authenticated. Everything
shown there is public GitHub data; still check the frame for personal details
before publishing.

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
