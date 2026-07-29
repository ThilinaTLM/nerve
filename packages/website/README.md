# Nerve website

Static marketing and documentation site for [nerve.tlmtech.dev](https://nerve.tlmtech.dev), built with Astro and Starlight.

## Authoring

Public prose lives in `src/content/docs/`. Keep guides task-oriented and put exact catalogs or limits in reference pages. The evidence inventory and page backlog live in [`../../docs/website/content-strategy.md`](../../docs/website/content-strategy.md).

```sh
pnpm --filter @nervekit/website dev
pnpm --filter @nervekit/website check
pnpm --filter @nervekit/website build
```

## Design system

The site uses Tailwind v4 (`@tailwindcss/vite`) plus `@astrojs/starlight-tailwind`. Styles are layered under `src/styles/` and loaded once through Starlight's `customCss`:

- `app.css` — the only entry: Tailwind, the Starlight bridge, fonts, then the partials below.
- `tokens.css` — brand tokens for both themes, the Myelin marketing layer, semantic radius/depth/rhythm values, the `@theme inline` mapping, and the `--sl-*` bridge. Palette values mirror `packages/ui-kit/src/styles/theme.css`, which stays the source of truth; re-sync manually when the app rebrands.
- `base.css` — element defaults, focus rings, and native view transitions.
- `motion.css` — every `@keyframes` in this package, progressive reveals, and the `prefers-reduced-motion` guard.
- `neural.css` — reusable neural/depth primitives such as membranes, axons, event layers, labels, and 3D stages.
- `marketing.css` — repeated marketing surfaces (typography roles, buttons, cards, and the shared page container).
- `starlight.css` — documentation shell overrides, including equal fixed desktop navigation/TOC rails.

Rules to keep:

- Use tokens (`var(--primary)`, `var(--hairline)`, `var(--radius-card)`) and Tailwind token utilities. Marketing-only colour roles belong in the documented Myelin layer rather than individual components.
- `.container-page` owns the outer geometry of every landing section through `--container-max` and `--page-gutter`. Do not add compensating per-section left/right margins.
- Add keyframes only to `motion.css`, and animate only `transform`, `opacity`, `filter`, or `stroke-dashoffset`.
- Motion has three categories: static-first short reveals, the single pinned Anatomy stage, and one-shot entry diagrams that always finish after intersection. Do not make ordinary section geometry remain fractional when scrolling pauses.
- Every animation must degrade under `prefers-reduced-motion: reduce`, and every page must remain fully readable with JavaScript disabled. Hidden reveal states are permitted only beneath the runtime-added `data-motion-ready` root marker.
- Client behavior lives in `src/scripts/`: `motion.ts` (reveals, header state, copy buttons, and orchestration), `scroll-stage.ts` (the pinned stage and entry diagrams), `tilt.ts`, `dendrite-field.ts`, and `theme.ts`. Theme state shares Starlight's `starlight-theme` storage key so marketing and docs stay in sync.

The site is static and must not call a local Nerve daemon. GitHub Pages deployment is configured at the repository level. `public/CNAME` sets the custom domain; DNS is managed separately in Cloudflare.

## Content ownership

- Public user and developer documentation: this package.
- Editable architecture diagram sources and release engineering procedures: root `docs/`.
- Repository governance: root `CONTRIBUTING.md` and `SECURITY.md`.
- Behavioral authority: owning contracts, catalogs, implementation, and tests.

## Product screenshots

Landing-page captures come from the live loopback workbench at desktop and phone viewports. The current approved set covers conversation, Git, pull requests, tasks, conversation history, model control, and dock sheets. Before committing a frame, select only the public `nerve` project, hide unrelated project shortcuts, avoid authentication/settings panes, and inspect the image for tokens, private paths, account details, or other project names.

Save approved PNG captures under `/tmp/nerve-shots/`, then run:

```sh
node scripts/prepare-website-shots.mjs
```

The script creates optimized WebP sources in `src/assets/shots/`. Astro generates responsive variants at build time. Keep descriptive alt text on every use and update the script's allowlist when adding or retiring a frame.
