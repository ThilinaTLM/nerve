# `@nervekit/extension-sdk`

The one dependency of a Nerve extension project: the extension API, the test helpers and the `nerve-ext` build tool. Its version is Nerve's version.

```sh
npx @nervekit/extension-sdk init csv-viewer --kind integration   # or: nerve-ext init
cd csv-viewer && npm install --ignore-scripts
npx nerve-ext check
```

Without a tag, npm installs the stable SDK, which matches the Nerve version stable users run. To target a Nerve staging version (`npx @nervekit/desktop@next`), use `npx @nervekit/extension-sdk@next init`.

| Command                                                                    | Does                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nerve-ext init <id> --kind <kind>[,<kind>...] [--dir <path>] [--install]` | Writes the project for one or more of `preview`, `page`, `panel`, `theme`, `integration`: `package.json` pinned to this SDK version, `src/extension.ts` wiring one folder per part (`src/backend/`, `src/previews/<id>/`, `src/pages/<id>/`, `src/panels/<id>/`, `src/themes/`), tests beside the code, `docs/`. |
| `nerve-ext build`                                                          | Bundles `src/extension.ts` into `dist/backend.js`, writes `dist/manifest.json`, copies `docs/` and the icon.                                                                                                                                                                                                     |
| `nerve-ext check`                                                          | `tsc --noEmit`, build and validate, `vitest run`. One command for the agent.                                                                                                                                                                                                                                     |
| `nerve-ext test`                                                           | `vitest run`.                                                                                                                                                                                                                                                                                                    |
| `nerve-ext dev`                                                            | Rebuilds `dist/` when `src/`, `docs/` or `package.json` change.                                                                                                                                                                                                                                                  |

Errors name what is wrong, where, and the fix.

- `@nervekit/extension-sdk`: the one import for extension code; re-exports the public `@nervekit/extension-api` (`defineExtension`, `defineNamespace`, `method`, types). The build rejects a direct `@nervekit/extension-api` import.
- `@nervekit/extension-sdk/testing`: `createFakeContext`, `createFakeBridge`, Vitest's `describe`, `it`, `expect`, `vi`, and Svelte's `mount`, `unmount`, `flushSync`, `tick` for component tests.
- `@nervekit/extension-sdk/build`: `buildExtension({ projectDir })`, the function behind `nerve-ext build`.
- `@nervekit/extension-sdk/ui`: re-exports `@nervekit/ui-kit` (the bridge client follows).

The backend is bundled as one IIFE that registers its definition on `globalThis.__nerveExtension`. `@nervekit/extension-api` is not bundled: Nerve's sandbox provides it at runtime. See [UPGRADING.md](./UPGRADING.md) when moving between SDK versions.
