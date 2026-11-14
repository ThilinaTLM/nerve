# `@nervekit/quick-script`

The `quick_script` runtime, extension registry and built-in extensions. See `docs/architecture/code-mode.md`.

- `src/runtime/`: executor, sandbox glue, prelude, script scanner/risk, discovery, description, files/image/libraries and runtime doc topics.
- `src/extensions/<id>/`: manifest, declarations, method code and docs for `atlassian` (`jira/`, `confluence/`, `shared/`), `web` and `diagram`.
- `src/registry.ts`: the namespace registry read by the description, prelude, scanner and discovery.

Depends on `@nervekit/tools` for execution primitives and the Jira, Confluence, web and kroki clients. Tools does not import this package: its catalog delegates `quick_script` to a runtime the host installs (`installQuickScriptRuntime`).
