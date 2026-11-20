# Extension contract

Part of [self-configuration](README.md). Current behavior: [extension platform](../../architecture/extension-platform.md), [trust and consent](../../architecture/trust.md).

The aim is not to avoid every break. It is to break rarely, break only what is affected, never break silently, and make the upgrade one conversation.

## What other platforms show

| Platform  | Mechanism                                                                                                                                    | What we take                                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| VS Code   | Host-provided API; extensions declare a minimum version; the stable API only grows; unstable API sits behind an explicit opt-in              | A narrow stable surface that grows by addition                  |
| Zed       | Interface defined in versioned files; the compiled-against version is embedded in the build; manifest format versioned separately            | Record exactly what an extension was built against, per surface |
| JetBrains | Plugins link against platform classes; needs build ranges, stability annotations, a verifier tool and a list of breaking changes per release | Do not expose internals; verify the surface automatically       |

VS Code and Zed keep old extensions working by carrying compatibility in the host. We deliberately do not: our users hold the source and an agent that can change it, so an upgrade is cheap and the host stays simple.

## Current state

- `oldestCompatibleSdkVersion` is one literal covering the backend API, the UI bridge, the manifest format, `ui-kit` components and theme token names. `apiVersion: 1` is in every manifest and takes no part in the check.
- [`read-installed.ts`](../../../packages/workbench-server/src/core-host/extension-catalog/read-installed.ts) parses the manifest with a strict schema before it checks the SDK version, so an extension built with a newer SDK reports `invalid` instead of `incompatible` (read from the order of the two checks, not run).
- `extension-api` exports everything with `export *`, including helpers (`parseOptions`, `nonEmptyString`), a type documented as host-internal (`ImageBackendRequest`) and a provider name (`ImageBackend = "openai-codex"`).
- The SDK re-exports the whole API, and the build accepts both package names as import specifiers.
- Namespace ids, tool names and account kinds are unique across all extensions. A tool-name prefix is a convention.
- No test fails when the public declarations or the manifest schema change.
- Theme files must contain exactly the current token set, so adding a token invalidates every existing theme.
- The skill tells the agent to commit `dist/` for project extensions.
- Already in place and kept: the frame bridge carries a protocol version (`bridgeProtocolVersion`), and the load path refuses a bundle whose registered definition differs from its manifest.

## Public surface

1. **Explicit exports.** `extension-api/src/index.ts` lists each public name. Helpers and host-internal types leave the index.
2. **One author import.** Extensions import from `@nervekit/extension-sdk` only; the build rejects a direct `@nervekit/extension-api` import. The API package stays as the host's zero-dependency contract.
3. **No provider names in public types.** Values such as image backends are strings the host validates.
4. **Host-owned prefixes.** For installed extensions the host requires tool names and account kinds to start with the extension id (hyphens as underscores for tools). Collisions between a user's own extensions stop being possible.
5. **Additive by default.** New options are optional fields with a default. A new theme token gets a default derived from existing tokens, so existing themes stay valid.
6. **The frozen names are documented as such.** The bundle globals (`__nerveExtension`, `__nerveExtensionApi`, `__nerveExtensionInvoke`) and the bridge message format are part of every built extension. The architecture page lists them as contract.

## Compatibility

1. **A floor per surface.** `oldestCompatibleSdkVersion` becomes a record: `manifest`, `backend`, `ui` (bridge and `ui-kit`), `themes`. An extension is checked only against the surfaces its manifest uses. A theme-token change no longer marks integration extensions incompatible. No new version numbers; `sdkVersion` stays the one recorded value.
2. **Version before schema.** Read `sdkVersion` leniently first. Too old or too new reports `incompatible` with the surface and the version that changed it; only a compatible version goes on to the strict schema.
3. **A snapshot of the public surface.** A test compares the emitted declarations of the API and SDK entries, the bridge method table and the manifest JSON Schema with a committed snapshot. Any change fails until the snapshot is updated, and the update is the moment to decide: additive, or raise a floor and add an `UPGRADING.md` section. This replaces the "public-surface check" the installable-extensions work breakdown names and which was not found in the repository.
4. **`apiVersion` removed** from the definition and manifest, since the floors decide compatibility. One less concept for authors.

## Breaking cleanly

- The `incompatible` message names the surface and the version, so the agent reads only the matching `UPGRADING.md` sections.
- `configuration.list({ kind: "extension", state: "incompatible" })` ([model](configuration-model.md#agent-namespace)) gives the agent every extension to upgrade after an update, at both scopes. "Upgrade my extensions" becomes one request.
- The user sees the same items in the bell ([user visibility](user-visibility.md)).

## Builds and sharing

- **Nerve never runs a build or an install itself.** Not after an update, not at consent, not on reload. `extensions.reload` reads `dist/` only.
- **A build is an agent command** in a conversation the user started, checked by the permission engine like any other command.
- **Shared as source.** The scaffold's `.gitignore` adds `dist/`. A folder with sources and no `dist/` shows as "not built" with the instruction to ask the agent to build it; the user's consent then covers the output built on their machine.
- **Dependencies are the risk in a received extension.** Before installing in a folder it did not scaffold in this conversation, the build script prints every dependency other than the SDK, and the skill tells the agent to show that list to the user and wait. Installs use the lockfile when present.
- **No install scripts.** The skill's scripts and the scaffold's instructions install with `npm install --ignore-scripts`, so a dependency cannot run code at install time. Tried with packed tarballs of the three packages on Linux x64: an `integration` scaffold and a `preview,page,panel,theme` scaffold both installed, and `nerve-ext check` (type check, build, tests) passed. The only install script skipped was esbuild's, whose binary arrives as an optional dependency. macOS and Windows are unverified.
- **What this does not cover.** A dependency's code still runs during the build and the tests, on the user's machine, outside the sandbox. The dependency list shown before install is the user's control over that.

`reference/extensions/sharing.md` and step 2 of `guide/extensions.md` change accordingly.
