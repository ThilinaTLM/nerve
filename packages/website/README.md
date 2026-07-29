# Nerve website

Static marketing and documentation site for [nerve.tlmtech.dev](https://nerve.tlmtech.dev), built with Astro and Starlight.

## Authoring

Public prose lives in `src/content/docs/`. Keep guides task-oriented and put exact catalogs or limits in reference pages. The evidence inventory and page backlog live in [`../../docs/website/content-strategy.md`](../../docs/website/content-strategy.md).

```sh
pnpm --filter @nervekit/website dev
pnpm --filter @nervekit/website check
pnpm --filter @nervekit/website build
```

The site is static and must not call a local Nerve daemon. GitHub Pages deployment is configured at the repository level. `public/CNAME` sets the custom domain; DNS is managed separately in Cloudflare.

## Content ownership

- Public user and developer documentation: this package.
- Editable architecture diagram sources and release engineering procedures: root `docs/`.
- Repository governance: root `CONTRIBUTING.md` and `SECURITY.md`.
- Behavioral authority: owning contracts, catalogs, implementation, and tests.

Capture final screenshots only after copy review. Store public screenshots in `src/assets/`, use descriptive alt text, and update README links if a shared preview image moves.
