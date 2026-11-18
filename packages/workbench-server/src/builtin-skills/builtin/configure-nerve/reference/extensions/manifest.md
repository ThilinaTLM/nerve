# Definition and manifest

`src/extension.ts` default-exports `defineExtension({...})`; every field is documented on `ExtensionDefinition` (`reference/extensions/api/extension-api/definition.d.ts`). `nerve-ext build` writes the plain-data part to `dist/manifest.json` (adding `version` from `package.json` and the SDK's `sdkVersion`) and the code to `dist/backend.js`. Never edit `dist/`.

## Decisions to make

- **Id.** It is also the folder name, and settings, accounts and operations are keyed by it. Changing it later loses the user's settings and consent.
- **`enabledByDefault`.** Use `false` for anything that reaches the network or an account, so the user turns it on deliberately.
- **Settings vs accounts.** Settings hold plain values the user chooses (a server URL, a default project). Credentials always belong in an account kind; the user adds accounts in Settings and the extension never sees the secret. Bump the settings `version` when a field changes meaning.
- **Permissions.** Declare only what the feature needs. Each network origin and capability is a line the user must accept.
- **Not allowed in installed extensions:** `prelude` and settings `migrations`. The build reports them.

## Agent-facing text limits

Text a model reads is checked when the folder loads; an extension over a limit is `invalid` with the limit in its diagnostics. Keep descriptions short and put detail in doc topics (`docs/*.md`, listed in a namespace's `docs`).

| Text                                      | Limit (characters) |
| ----------------------------------------- | ------------------ |
| Namespace `summary`                       | 200                |
| Each namespace `rule` (at most three)     | 300                |
| A method's leading doc comment            | 300                |
| A doc topic's `whenToRead`                | 160                |
| A doc topic file                          | 24,000             |
| A direct tool `description`               | 800                |
| An error message and its fix, at run time | 600 (cut)          |

Namespace ids must not equal a runtime namespace (`files`, `image`, `web`, `extensions`, `configuration`, `libraries`), `sdk`, `host` or a global (`console`, `JSON`, ...). Account kinds, namespace ids and tool names are unique across all extensions. Each UI kind holds at most 16 contributions.

## Precedence and states

Roots, first id wins: project (`<project>/.nerve/extensions/`), user (`<home>/agent/extensions/`), built-in. A user or project extension that reuses a built-in id is `invalid`. States: `enabled` (loaded), `pending_consent`, `incompatible` (SDK outside the supported range), `invalid` (diagnostics say why), `shadowed` (a higher root has the id).
