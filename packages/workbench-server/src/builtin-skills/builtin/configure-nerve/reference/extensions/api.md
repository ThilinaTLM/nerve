# Extension API declarations

The exact extension API is in the TypeScript declarations under `reference/extensions/api/`. Every type, member, option, default, limit and error is documented in their doc comments. They are the same files a scaffolded project has in `node_modules/@nervekit/extension-api/dist/` and `node_modules/@nervekit/extension-sdk/dist/`, at this Nerve's version. Look up signatures there instead of inferring them from examples; the prose in this folder explains concepts and decisions and does not repeat them.

## Backend (`reference/extensions/api/extension-api/`)

Import everything from `@nervekit/extension-sdk`, which re-exports this package. A direct `@nervekit/extension-api` import fails the build.

| Start from                                                                        | For                                                                                               |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `ExtensionDefinition` (`reference/extensions/api/extension-api/definition.d.ts`)  | Everything `defineExtension` accepts: id, settings, accounts, permissions, namespaces, tools, UI. |
| `defineExtension` (`reference/extensions/api/extension-api/define.d.ts`)          | Also `defineNamespace`, `method` and `defineTool`.                                                |
| `NamespaceDefinition` (`reference/extensions/api/extension-api/definition.d.ts`)  | A `quick_script` namespace: summary, rules, docs, methods, session.                               |
| `MethodDefinition` (`reference/extensions/api/extension-api/definition.d.ts`)     | One method: risk, signature, `parse`, `authorize`, `run`.                                         |
| `ToolDefinition` (`reference/extensions/api/extension-api/definition.d.ts`)       | Direct tools and their card `view`.                                                               |
| `ExtensionPermissions` (`reference/extensions/api/extension-api/definition.d.ts`) | Network origins and model capabilities.                                                           |
| `PreviewContribution` (`reference/extensions/api/extension-api/definition.d.ts`)  | Also `PageContribution`, `PanelContribution`, `ThemeContribution`.                                |
| `ExtensionContext` (`reference/extensions/api/extension-api/types.d.ts`)          | `ctx`: settings, accounts, HTTP, artifacts, text, authorization, reports, models, progress, log.  |
| `HttpRequest` (`reference/extensions/api/extension-api/types.d.ts`)               | Every option of `ctx.http.request` and its limits.                                                |
| `Risk` (`reference/extensions/api/extension-api/authorization.d.ts`)              | Also `Authorization`, what `authorize` returns.                                                   |
| `SettingField` (`reference/extensions/api/extension-api/settings.d.ts`)           | Also `SettingsSchema` and `AccountKind`.                                                          |
| `ExtensionError` (`reference/extensions/api/extension-api/errors.d.ts`)           | Also `EXTENSION_ERROR_CODES`.                                                                     |
| `createFakeContext` (`reference/extensions/api/extension-api/testing.d.ts`)       | Backend tests; import it from `@nervekit/extension-sdk/testing`.                                  |

## Frames (`reference/extensions/api/extension-sdk/`)

Import from `@nervekit/extension-sdk/ui`; test helpers from `@nervekit/extension-sdk/testing`.

| Start from                                                                    | For                                                                                                                   |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `host` (`reference/extensions/api/extension-sdk/ui/host.d.ts`)                | Every bridge call a frame can make, which frames may make it, and its limits. Also the `mode` and `themeKind` stores. |
| `BridgeError` (`reference/extensions/api/extension-sdk/ui/client.d.ts`)       | Failures of bridge calls; codes in `BridgeErrorCode` (`reference/extensions/api/extension-sdk/ui/bridge-types.d.ts`). |
| `Button` (`reference/extensions/api/extension-sdk/ui/components.d.ts`)        | All UI components, with their main props and variants.                                                                |
| `createFakeBridge` (`reference/extensions/api/extension-sdk/ui/testing.d.ts`) | Frame tests: a fake host with Nerve's checks.                                                                         |

## Reading tips

- Use `grep` for a symbol name in the folder to find its declaration; follow imported types the same way.
- `components.d.ts` imports `svelte` types, which do not resolve inside this skill; read past them.
