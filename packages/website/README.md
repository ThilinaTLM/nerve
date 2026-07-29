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
- `tokens.css` — brand tokens for both themes, the `@theme inline` mapping, and the `--sl-*` bridge. Palette values mirror `packages/ui-kit/src/styles/theme.css`, which stays the source of truth; re-sync manually when the app rebrands.
- `base.css` — element defaults, focus rings, and native view transitions.
- `motion.css` — every `@keyframes` in this package, the scroll-reveal system, and the `prefers-reduced-motion` guard.
- `marketing.css` — repeated marketing surfaces (typography roles, buttons, cards, frames).
- `starlight.css` — documentation shell overrides.

Rules to keep:

- Use tokens (`var(--primary)`, `var(--hairline)`, `var(--radius-xl)`) and Tailwind token utilities. Do not hard-code colors, font sizes, or spacing constants.
- Add keyframes only to `motion.css`, and animate only `transform`, `opacity`, and `filter`.
- Every animation must degrade under `prefers-reduced-motion: reduce`, and every page must remain fully readable with JavaScript disabled.
- Client behavior lives in `src/scripts/`: `motion.ts` (reveals, spotlight, parallax, header state, transcript demo, copy buttons) and `theme.ts`, which shares Starlight's `starlight-theme` storage key so the marketing toggle and the docs theme stay in sync.

The site is static and must not call a local Nerve daemon. GitHub Pages deployment is configured at the repository level. `public/CNAME` sets the custom domain; DNS is managed separately in Cloudflare.

## Content ownership

- Public user and developer documentation: this package.
- Editable architecture diagram sources and release engineering procedures: root `docs/`.
- Repository governance: root `CONTRIBUTING.md` and `SECURITY.md`.
- Behavioral authority: owning contracts, catalogs, implementation, and tests.

## Product screenshots

Landing-page captures come from the live loopback workbench at desktop (1600×1000) and phone (390×844) viewports. Before committing a frame, select only the public `nerve` project, hide unrelated project shortcuts, avoid authentication/settings panes, and inspect the image for tokens, private paths, account details, or other project names.

Save approved PNG captures under `/tmp/nerve-shots/`, then run:

```sh
node scripts/prepare-website-shots.mjs
```

The script creates optimized WebP sources in `src/assets/shots/`. Astro generates responsive variants at build time. Keep descriptive alt text on every use and update the script's allowlist when adding or retiring a frame.
