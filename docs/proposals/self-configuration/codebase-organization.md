# Codebase organization

Part of [self-configuration](README.md). Current structure: [codebase architecture](../../architecture/codebase.md); allowed edges: [`ALLOWED_INTERNAL_DEPENDENCIES`](../../../scripts/checks/package-architecture.rules.ts).

## Packages

There are fourteen packages. The count is not the problem: the graph is enforced, and each package has a dependency profile no neighbor shares. The disorder is inside two of them (`tools` and `workbench-server`) and in how one concern is spread across packages.

| Question                                                 | Finding                                                                                                                                                                                                            | Recommendation                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Merge `extension-api` into `extension-sdk`?              | `contracts`, `tools`, `extensions` and `workbench-server` depend on the API at run time. The SDK carries the build toolchain (esbuild, Vite, Svelte, Vitest) and `ui-kit`. Merging would pull those into the host. | Keep both. Authors see one name, the SDK ([contract](extension-contract.md#public-surface)). |
| Publish only the SDK, with the API inlined?              | The SDK bundle already inlines the manifest schema from `contracts`. Inlining the API too needs bundled declarations.                                                                                              | Not now; revisit if a third published name becomes a burden.                                 |
| Move built-in skills out of `workbench-server`?          | The server is their only loader and the only package allowed to see everything they document. A package for two skill folders adds a node to the graph for no boundary gain.                                       | Keep. Remove the cross-package reach instead (below).                                        |
| Is `packages/extensions` (built-ins) in the right place? | It depends only on the API, like an installed extension.                                                                                                                                                           | Keep.                                                                                        |

No package is added or removed.

## One concern, many homes

Extension code today:

| Layer                                                      | Location                                                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Author contract                                            | `extension-api`                                                                                                            |
| Build tool                                                 | `extension-sdk`                                                                                                            |
| Built-ins                                                  | `extensions`                                                                                                               |
| Manifest, catalog, consent schemas                         | `contracts/src/domains/extensions`                                                                                         |
| Sandbox host, direct tools, UI calls, account tests, icons | `tools/src/quick-script/extension-host`                                                                                    |
| Catalog, store, UI serving                                 | `workbench-server/src/core-host/extension-catalog`, `extension-store`, `extension-ui` and six loose `extension-*.ts` files |
| Extension settings                                         | `workbench-server/src/infrastructure/configuration/extensions`                                                             |

The layering is sound; two placements are not. The extension host serves direct tools, frames and account tests, none of which are scripts, yet it sits under `quick-script` and the server imports it through `@nervekit/tools/quick-script`. And the server side is split between three folders and loose files.

Configuration code has the same shape: schemas in `contracts`, the skill loader in `harness`, the agent namespace and policy in `tools`, ports and the permission source loose in `core-host`, services under `infrastructure/configuration`, `domains/launch-definitions` and `domains/prompt-suggestions`, the skill in `builtin-skills`, generators in `scripts/build`. The [resource registry](configuration-model.md#resource-providers) gives these one meeting point without moving their owners.

## Folder moves

Pure moves, no behavior change, done first so later steps touch settled paths.

1. **`tools/src/quick-script/extension-host` → `tools/src/extension-host`**, exported as `@nervekit/tools/extension-host`. `quick-script` imports it like any other consumer.
2. **Group `workbench-server/src/core-host`**, which holds about thirty source files at one level:

   | New folder                 | Receives                                                                                                                                                                             |
   | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `core-host/permissions/`   | `permission.adapter`, `permission-configuration`, `permission-overlays`, `permission-rule-sets`, `project-permission-migrations`, `scoped-permission-source`, `execution-admission/` |
   | `core-host/configuration/` | `configuration-agent-port`, `configuration-reload`, `scoped-agent-configuration`, `scoped-conversation-creation`, `cached-agent-summary`, and the new registry                       |
   | `core-host/extensions/`    | `extension-catalog/`, `extension-store/`, `extension-ui/`, `extension-availability`, `extension-ports`, `extension-views`, `conversation-extensions`                                 |
   | `core-host/resources/`     | `resource-loader`, `agent-browser-skills`, `scoped-turn-resources`, `turn-resources.adapter`, `nerve-system-prompt`                                                                  |

3. **`scoped-configuration-runtime.md` and `scoped-configuration-ui-api.md`** sit among sources in `core-host`. Fold what is still true into [scoped configuration](../../architecture/configuration.md) and delete them.

## Duplication to remove

| Duplicate                                                                                                  | Resolution                                                                                      |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Eight diagnostic shapes                                                                                    | One [`Diagnostic`](configuration-model.md#diagnostic) in `contracts`                            |
| Permission file validation in the port and in the policy source                                            | The source owns it; the port's copy is deleted                                                  |
| `ConfigurationAgentPort` in `quick-script/runtime/configuration`, `ExtensionAgentPort` in `extension-host` | Both ports sit beside their namespace's methods                                                 |
| Hand-written declaration strings beside the port types they describe                                       | Derived, or pinned by a type-level test                                                         |
| Hand-written catalog tables in the skill, with tests that parse Markdown                                   | [Calls and generated files](skill.md#what-calls-replace)                                        |
| `extension-sdk/test/skill.test.ts` reading files inside `workbench-server`                                 | Name checks move to the public-surface snapshot; only link checks stay, in the server           |
| `compareVersions` in `contracts` and in the skill's standalone `lib.mjs`                                   | The script cannot import the workspace, so the copy stays; one test runs both on the same cases |
| Size limits hard-coded in the SDK build; the host has its own checks (not compared for this proposal)      | Compare them; export each limit once from the manifest contract the SDK already inlines         |

## Naming

"Tool", "method" and "operation" overlap: a direct tool (`defineTool`), a namespace method (`method()`), and "operation" for both in contracts and docs. Proposed vocabulary, applied to docs, diagnostics and new code, without renaming persisted values:

- **tool**: what the model calls by name;
- **method**: a function of a `quick_script` namespace;
- **operation**: the permission identity of a method call (`jira.issues.create`).

Rule files and stored approvals already contain operation names, so those strings do not change.

## Large files

Not urgent; split when next touched: `permission-policy.ts` (evaluation, matching, suggestions), `extension-catalog.ts`, `extension-sdk/src/build.ts` (bundling, definition evaluation, manifest assembly, limits).
