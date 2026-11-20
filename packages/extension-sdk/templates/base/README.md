# **TITLE**

A Nerve extension. Nerve loads the built `dist/`; never edit it by hand.

## Layout

- `src/extension.ts`: the definition (`defineExtension`). It only wires the parts below.
- `src/backend/`: the `quick_script` namespace and its methods, one method per file.
- `src/previews/`, `src/pages/`, `src/panels/`: one folder per UI contribution (a Svelte entry and its helpers).
- `src/themes/`: theme files (data, never CSS).
- `docs/`: doc topics an agent reads on demand (`sdk.docs`).

Tests sit next to the code they cover (`*.test.ts`).

## Commands

- `npm install --ignore-scripts`: install dependencies (`npm ci --ignore-scripts` with a lockfile). Install scripts never run.
- `npx nerve-ext check`: type check, build, validation and tests. Run it until it passes.
- `npx nerve-ext dev`: rebuild `dist/` on every change.

`dist/` and `node_modules/` are not in version control: share the sources, and whoever receives them builds `dist/` with `npx nerve-ext check`.

After a build, reload the extension in Nerve (Settings → Extensions) and allow it there.
