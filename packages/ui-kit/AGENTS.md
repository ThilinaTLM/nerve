# UI kit (`packages/ui-kit`)

Source of official shadcn-svelte primitives, shared theme styles, generic Markdown/code/terminal renderers, and generic browser/display utilities. Full styling model: [`docs/ui/styling.md`](../../docs/ui/styling.md).

- Never depend on Nerve contracts, protocol, host state, or app packages.
- Use official shadcn-svelte components (`src/lib/components/ui`) and `@lucide/svelte` icons. Improve core components rather than adding wrappers, one-off variants, or size levels.
- Use theme-token Tailwind utilities, including `success`/`warning`/`info`. `destructive` for readable red text/tints; opaque fills use `destructive-solid` with `destructive-solid-foreground`.
- Controls use two height tokens, `--spacing-control` (28px) and `--spacing-control-sm` (24px), enlarged on coarse pointers. Never add a size level or patch control heights via class (`control-scale.test.ts`).
- Mono typography only for code, logs, and paths.
- Shared global CSS lives in `src/styles/` (`app.css` entry). Design tokens go only in `theme.css` and keyframes only in `animation.css`; this also applies to `workbench-app`.
- `src/lib/utils.ts` is the shadcn-required naming exception; other broad production filenames are reviewed in `scripts/checks/source-naming-policy.ts`.
- Colocate tests with the module. Pure logic uses `*.test.ts` (`tsx --test`); component behavior uses `*.svelte.test.ts` (`pnpm test:components`, Vitest + jsdom). Component tests check interaction, not classes or layout (token guards like `control-scale.test.ts` are the exception); bits-ui content is `visibility: hidden` in jsdom, so query it by text and stub `ResizeObserver`/pointer-capture where needed.
