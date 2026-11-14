# `@nervekit/tools`

Canonical agent tool definitions, local execution, permission policy, host runtime contracts, result projection, and Git services.

- `catalog/definitions/`: core and orchestration tool definitions.
- `execution/`: provider executors plus named process/output/network/error infrastructure. `execution-context.ts` defines capability-specific filesystem, shell, Python, web, vision, and integration contexts.
- `policy/`: permission, supervision, risk, path, and shell policy.
- `runtime/`: availability, host dispatch, and runtime permission checks.
- `result-projection/`: bounded agent-facing results.
- `git/`: repository and GitHub workflows consumed outside ordinary tool dispatch.
- `quick-script/` (subpath `@nervekit/tools/quick-script`): the `quick_script` tool, its sandbox runtime (executor, prelude, scanner, discovery, `files`/`image`/libraries/`sdk`), the extension registry and the sandbox-library and runtime-doc assets (`scripts/build/copy-quick-script-assets.ts`). See `docs/architecture/code-mode.md`. There is no default registry: the host builds one (`createQuickScriptRegistry(definitions, { readExtensionDoc })`) from the built-in list of `@nervekit/extensions` and passes it explicitly to the tool, the description, the scanner and the executor context; this package never imports extensions. `quick-script/extension-host/` runs extensions written against `@nervekit/extension-api` (`ctx`, sessions, derived availability, direct tools, settings definitions and metadata). `@nervekit/tools/quick-script/testing` exposes runtime internals to the host's built-in extension tests only.

Do not recreate `execution/common`; shared code belongs to a named technical concern. Executors accept capability interfaces rather than host objects.
