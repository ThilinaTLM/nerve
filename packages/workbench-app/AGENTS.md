# Workbench app (`packages/workbench-app`)

Read the matching reference before working in these areas:

- Styling, themes, tokens, `<style>`/`:global()`, global CSS: [`docs/ui/styling.md`](../../docs/ui/styling.md)
- Settings pages: [`docs/ui/settings.md`](../../docs/ui/settings.md)
- Transcript notices and tool-call cards: [`docs/ui/transcript-notices.md`](../../docs/ui/transcript-notices.md)
- Dock panel views: [`docs/ui/panels.md`](../../docs/ui/panels.md)

## Architecture

- `$lib/presentation` owns only cross-feature, stateless product UI and may depend only on presentation-local modules, `@nervekit/contracts`, and `@nervekit/ui-kit`; it must not import `$lib/app`, `$lib/application`, `$lib/features`, `$lib/domain`, or `$lib/platform`. App state, protocol calls, polling, navigation, notifications, and clipboard effects stay outside it. Feature-specific Git and task presentation is owned by those feature slices.
- `*Host` components are state/effect adapters around canonical feature `*View` or rendered `*Panel` components. `*Shell` is reserved for genuinely generic layout structure; `*Pane` names a bounded subregion. Do not recreate presentation markup in app or feature hosts.
- Concrete feature registration and all cross-feature UI wiring belong in `$lib/app/composition`. `application/workspace` uses its registered readonly feature ports and named commands, never concrete feature workspace/state/adapters modules. Generic shell modules consume public feature APIs or registered descriptors, not private feature modules.
- A feature must never import another feature, including its public barrel.

## Styling rules

Most of these are enforced by `pnpm check` (`scripts/checks/check-package-boundaries.ts` running `ui-style-checks.ts`) and ui-kit tests; details are in `docs/ui/styling.md`.

- **Tier 1 (default):** Tailwind theme-token utilities in markup. No hard-coded colors, font sizes, spacing, `dark:` utilities, opacity modifiers (`bg-x/10`), or `color-mix()`; use the derived recipes (`bg-<tone>-subtle`, `border-<tone>-strong`, `border-border-subtle`, `ring-focus`, `bg-scrim`).
- **Tier 2:** a scoped `<style>` block only for what utilities cannot express (the nine escape hatches in the reference). No `@keyframes` in components; `:global()` only in the documented cases, scoped under a local class.
- **Surfaces:** pick by role, never by shade: `panel` < `background` < `card` < `popover`; `well` for recessed output. Controls flat; `shadow-sm` for raised cards, `shadow-overlay` for floating layers.
- **Type:** `text-caption`, `text-ui`, `text-body`, `text-title` only. Monospace only for code, logs, paths, and tool-call card headers.
- **Interaction:** hover is `hover:bg-hover`; selection is `bg-selected` (+ `text-primary` icon), never a stronger fill or bar; buttons never underline; action labels never end in `…`.
- **Status:** one tone vocabulary (`StatusTone`: `neutral`, `brand`, `info`, `success`, `warning`, `destructive`); never invent parallel names. Group captions use `GroupLabel`.
- **Controls:** use existing sizes only (Button `default`/`sm`/`icon`/`icon-sm`, ToggleGroup `default`/`sm`, one-size fields/Switch/Checkbox/Radio/IconAction). Never add a size level or patch height/padding via `class`; fix the core component in `ui-kit`. Icons: `@lucide/svelte`; spinners: `Spinner`.
- **Global CSS:** the only stylesheet import is `src/styles/app.css` in `main.ts`; tokens and keyframes live in `packages/ui-kit/src/styles/`. A global class must be a deliberate contract used by two or more components; new partials must be added to `ALLOWED_STYLE_PARTIALS` in `scripts/checks/style-policy.ts`.

## Startup loading policy

- Composer-critical startup resources are settings, models, auth metadata, workspace hydration, and restoration of the active conversation.
- New mount or project-restoration effects must not initiate network or filesystem work before `workbenchStartupState.progressiveActive` unless the work is explicitly added to the critical phase in `application/startup/workbench-startup-sequence.ts`.
- Restored inactive tabs are metadata-only during startup. A restored active conversation is critical; non-conversation active-tab loaders are progressive.
- Background features should also honor panel visibility or explicit demand wherever possible.
- Startup ordering tests use deferred dependencies and phase events, never timing thresholds.

## Misc

- Planning wireframes: local, mock-only Svelte components in the gitignored `src/lib/app/design-lab/wireframes/` (kebab-case, served at `/dev/wireframes/<name>` in dev) using shared UI components, not standalone HTML. The directory is excluded from type checking, tests and style checks; never statically import wireframes into product code.
- Verify visual changes in light and dark themes with the `nerve-qa` skill.
