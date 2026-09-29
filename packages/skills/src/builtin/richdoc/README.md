# Richdoc skill

A self-contained, offline-first skill for authoring polished HTML documents. It is discoverable in Nerve's builtin catalog but **disabled by default**. Enable it explicitly in skill settings for subsequent agent runs.

## Run without Nerve

Copy the **built** `packages/skills/dist/builtin/richdoc/` directory anywhere. With Node 24+:

```sh
node /path/to/richdoc/scripts/richdoc.mjs prepare ./report --file index.html --title Report
node /path/to/richdoc/scripts/richdoc.mjs describe
node /path/to/richdoc/scripts/richdoc.mjs validate ./report/index.html
```

No install, Python, uv, server, global command or node_modules is needed. Open the resulting HTML file directly in a browser, or host the entire document directory with a basic static server. Share `richdoc-assets/` with the HTML file. For a nested `--file`, assets are installed beside that file.

Preparation refuses asset conflicts unless `--replace-assets` is supplied, and never overwrites HTML. Validation is read-only, returns bounded JSON diagnostics and never executes authored scripts or fetches remote links. All commands return JSON, including failures. Node is a prerequisite; this skill does not download a runtime.

## Scope

Twelve custom elements complement native semantic HTML. Mermaid diagrams, math, highlighting, charts and curated icons are bundled locally. Browser settings persist best-effort. Source/data remains readable when JavaScript or a renderer is unavailable. Remote images/resources are not supported; outbound ordinary hyperlinks are allowed.

This is a reduced, independently implemented document system informed by richdoc's feature set, **not an upstream compatibility port**. It has no exports, Confluence integration, book framework, editor, arbitrary scripting or embedded Nerve preview. Validation does not make arbitrary HTML trustworthy; do not serve generated documents under an authenticated application origin.

## Maintainer build

From the Nerve checkout, install its pinned development dependencies and run:

```sh
pnpm --filter @nervekit/skills build:richdoc
pnpm --filter @nervekit/skills check:richdoc
pnpm --filter @nervekit/skills test:richdoc:browser
```

TypeScript sources, document styles, schema and build helpers are all inside this skill. Git tracks authored sources only: the bundled CLI, assets, component reference and dependency notices are generated into `packages/skills/dist/builtin/richdoc/`, never committed. Normal skills builds and pretests generate them; desktop development and release builds already build the skills dependency. The packaged directory is self-contained, but a raw source copy needs a maintainer build first.

`check:richdoc` rebuilds into a temporary directory and compares the packaged bytes without changing source. The measured asset-size budget lives in `build/budget.json`; changes above 10% require an explicit justified baseline update using `--update-budget`.

Browser acceptance requires the Playwright Chromium binary (`pnpm exec playwright install chromium`). Browser checks use temporary document folders and isolated loopback ports, not the live Nerve daemon.

Original source is Apache-2.0; see [LICENSE](LICENSE) and [bundled dependency notices](THIRD_PARTY_NOTICES.md).
