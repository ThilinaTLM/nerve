# `@nervekit/extensions`

The built-in `quick_script` extensions: Atlassian (`jira`, `confluence`, `storage`), web, diagram and image generation. See `docs/architecture/code-mode.md`.

- `src/<id>/`: manifest, declarations, method code, tests and `docs/` (the `sdk.docs` topics) of one extension. `atlassian` has `jira/`, `confluence/` and `shared/`.
- `src/index.ts`: `builtinExtensions` (display order), `extensionSettingsDefinitions`, `extensionMetadata`, and the host-facing exports (`checkAtlassianConnection`, image backend types).
- `src/docs-source.ts`: reads a topic from `src/<id>/docs/` from source and from `dist/extension-docs/<id>/` in builds and the desktop bundle (`scripts/build/copy-extension-assets.ts` copies it).
- `test/`: tests of the runtime together with the built-ins (registry, discovery, risk samples, docs).

Depends on `@nervekit/tools` (runtime, manifest types, execution primitives and the Jira, Confluence, web and kroki clients). Tools does not import this package: the host builds its registry from `builtinExtensions` (`createQuickScriptRegistry`).
