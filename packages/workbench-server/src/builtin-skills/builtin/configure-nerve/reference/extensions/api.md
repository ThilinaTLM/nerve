# Extension API declarations

The exact extension API is in the TypeScript declarations under `reference/extensions/api/`. Every type, member, option, default, limit and error is documented in their doc comments. They are the same files a scaffolded project has in `node_modules/@nervekit/extension-api/dist/` and `node_modules/@nervekit/extension-sdk/dist/`, at this Nerve's version. Look up signatures there instead of inferring them from examples; the prose in this folder explains concepts and decisions and does not repeat them.

## Backend (`reference/extensions/api/extension-api/`)

Import everything from `@nervekit/extension-sdk`, which re-exports this package. A direct `@nervekit/extension-api` import fails the build.

| Start from                                                                             | For                                                                                                  |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `ExtensionDefinition` (`reference/extensions/api/extension-api/definition.d.ts`)       | Everything `defineExtension` accepts: id, settings, accounts, permissions, namespaces, tools, UI.    |
| `defineExtension` (`reference/extensions/api/extension-api/define.d.ts`)               | Also `defineNamespace`, `method` and `defineTool`.                                                   |
| `NamespaceDefinition` (`reference/extensions/api/extension-api/definition.d.ts`)       | A `quick_script` namespace: summary, rules, docs, methods, session.                                  |
| `MethodDefinition` (`reference/extensions/api/extension-api/definition.d.ts`)          | One method: risk, signature, `parse`, `authorize`, `run`.                                            |
| `ToolDefinition` (`reference/extensions/api/extension-api/definition.d.ts`)            | Direct tools and their card `view`.                                                                  |
| `ExtensionPermissions` (`reference/extensions/api/extension-api/definition.d.ts`)      | Network origins (`network`), model services (`models`) and frame services (`frame`).                 |
| `PreviewContribution` (`reference/extensions/api/extension-api/definition.d.ts`)       | Also `PageContribution`, `PanelContribution`, `ThemeContribution`.                                   |
| `ExtensionContext` (`reference/extensions/api/extension-api/types.d.ts`)               | `ctx`: settings, accounts, HTTP, artifacts, text, authorization, reports, models, progress, log.     |
| `HttpRequest` (`reference/extensions/api/extension-api/types.d.ts`)                    | Every option of `ctx.http.request` and its limits.                                                   |
| `Risk` (`reference/extensions/api/extension-api/authorization.d.ts`)                   | Also `Authorization`, what `authorize` returns.                                                      |
| `SettingField` (`reference/extensions/api/extension-api/settings.d.ts`)                | Also `SettingsSchema`, `AccountKind` (secrets, `auth`, `provider`, `platform`) and `PlatformUse`.    |
| `ExtensionError` (`reference/extensions/api/extension-api/errors.d.ts`)                | Also `EXTENSION_ERROR_CODES`.                                                                        |
| `defineCredentialProvider` (`reference/extensions/api/extension-api/credentials.d.ts`) | Credential providers (`src/credentials.ts`): the four operations and their fixed `ctx`.              |
| `createFakeContext` (`reference/extensions/api/extension-api/testing.d.ts`)            | Backend tests; import it from `@nervekit/extension-sdk/testing`. Also `createFakeCredentialContext`. |

## Frames (`reference/extensions/api/extension-sdk/`)

Import from `@nervekit/extension-sdk/ui`: `host`, the components and every Lucide icon (`import { Plus } from "@nervekit/extension-sdk/ui"`; `Badge` is the component, its icon is `BadgeIcon`). Test helpers come from `@nervekit/extension-sdk/testing`.

| Start from                                                                       | For                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host` (`reference/extensions/api/extension-sdk/frame/host.d.ts`)                | Every bridge call a frame can make, by group (`backend`, `pages`, `file`, `store`, `chat`, …), which frames may make it, and its limits. Includes the `host.mode` and `host.theme.kind` stores and the host-drawn `host.ui.menu` / `host.ui.pick` (entry types in `frame/bridge-types.d.ts`; see `ui.md`).                        |
| `BridgeError` (`reference/extensions/api/extension-sdk/frame/client.d.ts`)       | Failures of bridge calls; codes in `BridgeErrorCode` (`reference/extensions/api/extension-sdk/frame/bridge-types.d.ts`).                                                                                                                                                                                                          |
| `Button` (`reference/extensions/api/extension-sdk/components/components.d.ts`)   | Index of the UI components: each export re-exports the module that defines it (`components/ui-kit/components/…/<name>.svelte.d.ts`; the SDK's own `SelectField` and `FloatingToolbarMenu` are `components/*.svelte.d.ts`). A component file has its props type with a doc comment on every prop, and the component's usage notes. |
| `createFakeBridge` (`reference/extensions/api/extension-sdk/frame/testing.d.ts`) | Frame tests: a fake host with Nerve's checks; answers `confirm`, `menu` and `pick` (options `confirm`, `menu`, `pick`), records `menus` and `picks`, and refuses them with `userActivation: false`.                                                                                                                               |

## Reading tips

- Use `grep` for a symbol name in the folder to find its declaration; follow imported types the same way.
- Components: find the name in `components/components.d.ts`, follow its `from` path to the folder's `index.d.ts`, then the `*.svelte.d.ts` file (`grep -rl "PanelRow" components/` also finds it). Every component accepts `class`, a `children` snippet where it has a body, and the native attributes of its element; the file lists the rest.
- Declarations import `svelte`, `bits-ui` and `tailwind-variants` types, which do not resolve inside this skill; read past them.
