# `@nervekit/tools`

Canonical agent tool definitions, local execution, permission policy, host runtime contracts, result projection, and Git services.

- `catalog/definitions/`: core and orchestration tool definitions.
- `execution/`: provider executors plus named process/output/network/Atlassian/error infrastructure. `execution-context.ts` defines capability-specific filesystem, shell, Python, web, vision, and integration contexts.
- `policy/`: permission, supervision, risk, path, and shell policy.
- `runtime/`: availability, host dispatch, and runtime permission checks.
- `result-projection/`: bounded agent-facing results.
- `git/`: repository and GitHub workflows consumed outside ordinary tool dispatch.
- `quick-script/` (subpath `@nervekit/tools/quick-script`): the `quick_script` tool, its sandbox runtime (executor, prelude, scanner, discovery, `files`/`image`/libraries/`sdk`), the extension registry and the sandbox-library and runtime-doc assets (`scripts/build/copy-quick-script-assets.ts`). See `docs/architecture/code-mode.md`. The registry holds only the runtime's own namespaces until the host calls `installQuickScriptExtensions` with the built-in list from `@nervekit/extensions`; this package never imports extensions. The `quick-script/*` subpath exposes runtime modules to extensions until the extension API replaces it.

Do not recreate `execution/common`; shared code belongs to a named technical concern. Executors accept capability interfaces rather than host objects.
