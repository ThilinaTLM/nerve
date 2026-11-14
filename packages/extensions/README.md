# `@nervekit/extensions`

The built-in `quick_script` extensions: Atlassian (`jira`, `confluence`, `storage`), web, diagram and image generation. See `docs/architecture/code-mode.md`.

- `src/<id>/`: definition (`manifest.ts`, built with `@nervekit/extension-api`), declarations, method code, unit tests and `docs/` (the `sdk.docs` topics, declared as `docs/<file>` paths) of one extension. `atlassian` has `jira/`, `confluence/` and `shared/`.
- `src/index.ts`: `builtinExtensions`, the definitions in display order. Nothing else is exported from the package root.
- `src/docs-source.ts` (subpath `@nervekit/extensions/docs`): the host-side reader of the declared doc paths, from `src/<id>/` in source and from `dist/extension-docs/<id>/` in builds and the desktop bundle (`scripts/build/copy-extension-assets.ts` copies it). Extension code itself does not read files.

Depends on `@nervekit/extension-api` only (plus npm libraries); it imports neither `tools` nor `contracts`. The host (`workbench-server`) builds the registry from `builtinExtensions`. Tests that run the built-ins through the runtime live in `packages/workbench-server/test/extensions/`.
