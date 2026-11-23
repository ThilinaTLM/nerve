# Upgrading extensions

One section per SDK version that breaks extensions, newest first. The SDK shares Nerve's version; a section exists only for versions that change the extension API, the UI bridge, the manifest format, `ui-kit` components or theme token names (the versions that raise a floor of Nerve's `oldestCompatibleSdkVersion`, which has one floor per surface: `manifest`, `backend`, `ui`, `credentials`, `themes`). Name the surface in the section so the agent can skip sections that do not touch the extension. `test/public-surface.test.ts` fails on any change to the public surface until you decide: additive (update its snapshot), or breaking (raise the floor, add a section here, update the snapshot).

To upgrade an extension from SDK `A` to SDK `B`: apply every section with `A < version <= B`, oldest first, then bump `@nervekit/extension-sdk` in `package.json` to `B` (exact version) and run `npm install` and `npx nerve-ext check`. `npm view @nervekit/extension-sdk dist-tags` shows the stable (`latest`) and staging (`next`) versions; target staging only when the extension needs a Nerve staging host.

## Section format

Copy this block above the previous section when a release breaks extensions.

````md
## X.Y.Z

What changed, in one or two sentences, and who is affected.

**Before**

```ts
// code that worked with the previous version
```

**After**

```ts
// the same code for X.Y.Z
```

Mechanical steps, if the change cannot be read from the code above (renamed files, new manifest fields, changed commands).
````

<!-- Sections start here. Every released SDK version is compatible with the previous one. -->

## Next release: Nerve's panel and page patterns (surface `ui`)

The host no longer wraps a panel frame in a header and padding: the frame draws the whole panel, like Nerve's own panels. Existing panels keep loading (no compatibility floor changes) but lose the title line and the 0.5rem side inset; rebuild them on `PanelView` and `PanelHeader`. `@nervekit/extension-sdk/ui` now exports the panel components (`PanelView`, `PanelHeader`, `PanelToolbarButton`, `PanelFilterBar`, `PanelList`, `PanelRow`, `PanelTree`, `PanelSection`, `PanelSplit`, …), page components (`PageView`, `PageHeader`, `PageSection`, `FieldRow`, `ToggleRow`, `PageList`, `PageItem`, …), `SelectField`, `SwitchField`, `RadioGroupField`, `CommandList` and `VirtualScroller`; row `menuItems` open a host-drawn menu. Rebuild hand-made headers, lists and form rows from them (`reference/extensions/ui-patterns.md` of the configure-nerve skill).

**Before**

```svelte
<div class="flex h-screen flex-col gap-2 bg-panel p-3">
  <ul class="min-h-0 flex-1 overflow-auto">…</ul>
</div>
```

**After**

```svelte
<PanelView>
  {#snippet banner()}<PanelHeader
      title="Checklist"
      count={items.length}
    />{/snippet}
  <ScrollArea class="min-h-0 flex-1"
    ><PanelList ariaLabel="Items">…</PanelList></ScrollArea
  >
</PanelView>
```

## Next release: starting conversations from a frame (surfaces `manifest` and `ui`)

Nothing existing breaks; this section tells an agent what is new. Declare `permissions.capabilities: ["conversations.start"]` to call `host.conversations.start({ prompt, title?, model?, agentProfile?, permissionRuleSet?, send?, open? })` from a UI frame; it resolves with `{ conversationId }`. Call it from a click or key handler (else `not_allowed`). `model`, `agentProfile` and `permissionRuleSet` are keys of your own settings of type `model`, `agentProfile` and `permissionRuleSet` (a missing key or another type rejects with `invalid_request`); an unset setting means Nerve's default. `send: false` leaves the prompt unsent in the new conversation's composer; `open: false` keeps the user where they are. the test fake records calls in `bridge.startedConversations`.

## Next release: model calls (surfaces `manifest` and `backend`)

Nothing released breaks; this section tells an agent what is new. Every `ctx.models` call names its model, and the host accepts only the value of one of your own settings (or, for text and vision, `ctx.models.defaultModel()`); anything else rejects with `DENIED`. The host never picks a model.

- `models.text` (capability `models.text`): `complete({ model, system?, prompt, maxTokens?, progress? })` makes one model call without tools and returns `{ text, model }`. `model` is `ctx.settings.get(<key of a model setting>)` or `await ctx.models.defaultModel()` (Nerve's default model and reasoning level for the project).
- `models.vision` (capability `models.vision`): `explain({ model, image, prompt?, progress? })`, where `image` is a file handle (`artifact:<name>` or a workspace path your `authorize` declared as a read).
- `models.image` (capability `models.image`): `generate({ model, prompt, inputs?, size?, quality?, background?, artifact? })` with the value of an `imageModel` setting (a new field type: the user picks one of the host's image models). Images come back as artifacts (`images[].artifact`).
- `ready({ model })` of each service says whether the model is usable; use it in `availability`. In `run`, throw `ExtensionError("DENIED", …, { fix })` when the setting is unset.
- `availability` and `configuration` receive an `ExtensionHookContext` (settings, accounts, model `ready`/`defaultModel`, log); an account kind's `test` receives an `AccountTestContext` (accounts, http, log). `ctx.signal` does not exist. `ctx.authorize` takes `{ operation?, targets, risk? }`, defaulting to the running method's operation and risk. `progress` streams only inside a running direct tool.

## Next release: model, agent profile and permission rule set settings (surface `manifest`)

Nothing existing breaks; this section tells an agent what is new. A `model` setting gains `reasoning: true`, which lets the user also pick a reasoning level; its value is then `{ provider, modelId, reasoningLevel? }` (unset: the model's default level). Two new setting types: `agentProfile` (value: the profile name; unset: the project's default profile) and `permissionRuleSet` (value: the rule set id; unset: the user's default). Neither takes a `default`, and neither is allowed in an account kind's `fields`.

## Next release: accounts (surfaces `manifest` and `backend`)

Nothing existing breaks; this section tells an agent what is new. Account kinds gain several secrets, more injections, a built-in OAuth 2.0 provider and platforms; accounts have a level.

- **Several secrets.** `secrets: { keyId: { label }, keySecret: { label, multiline: true } }` instead of the single `secret` (which stays as shorthand; set at most one of the two). An `auth` entry names the secret it sends with `secret: "<name>"`, optional with a single secret.
- **Several injections and query parameters.** `auth` may be a list, and `{ scheme: "query", name: "api_key" }` sends the secret as a URL query parameter. The credential is added only on hops to the kind's `origins`.
- **OAuth 2.0 as data.** `provider: { type: "oauth2", ... }` signs the user in (authorization code with PKCE, or device code), refreshes the token before it expires and sends it as a bearer token; declare no `auth` and no `secret`. The client id is an account field (`clientIdField`, default `clientId`; give the field a `default` to ship one); a service that needs a client secret names an account `secrets` entry (`clientSecret`). Endpoints are URLs, `{<field>}` templates or OIDC `discovery`. A service that accepts only certain redirect paths gets `redirectPath` (default `/callback`).
- **Platforms.** `platform: "github"` on a kind names what the account is for; names are shared, not unique. An extension that uses accounts other extensions define declares `uses: [{ platform, scopes?, origins? }]` and gives its `account` setting `platform` instead of `kind`. The setting offers every account of the platform whose definition covers the use's origins (and, with `scopes`, whose provider is `oauth2`). The user consents per extension and platform, and the scopes of all enabled users of a platform are added to its OAuth sign-ins.
- **Levels.** `AccountInfo.level` is `user` or `project`; `AccountInfo.identity` holds what a provider reported at sign-in. A kind a project extension defines has project-level accounts only. An `account` setting at user scope selects user-level accounts only.

**Before**

```ts
accounts: {
  "my-ext-account": {
    label: "My account",
    fields: {},
    secret: { label: "API token" },
    auth: { scheme: "bearer" },
    origins: ["https://api.example.com"],
  },
},
settings: { version: 1, fields: { account: { type: "account", kind: "my-ext-account", label: "Account" } } },
```

**After** (OAuth 2.0, shared platform, and a second extension using it)

```ts
// extension that defines the accounts
accounts: {
  "my-ext-account": {
    label: "My account",
    platform: "github",
    fields: { clientId: { type: "string", label: "Client id", default: "<id>" } },
    provider: {
      type: "oauth2",
      flows: ["device_code"],
      deviceAuthorizationUrl: "https://github.com/login/device/code",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scopes: ["repo"],
    },
    origins: ["https://api.github.com"],
  },
},

// extension that only uses them
uses: [{ platform: "github", scopes: ["gist"], origins: ["https://api.github.com"] }],
settings: { version: 1, fields: { account: { type: "account", platform: "github", label: "Account" } } },
```

## Next release: credential providers (new surface `credentials`)

Nothing existing breaks; this section tells an agent what is new and how to use it. Account kinds can now name `provider: "extension"` and ship their own credential code, for credentials the built-in providers (typed-in secrets, `oauth2`) cannot serve: request signing (AWS SigV4, HMAC-signed APIs), key-based token exchanges (GitHub Apps, Google service accounts), login-for-session-token APIs, sign-in flows of their own. The code runs in a separate sandbox and sees the account's secrets; the backend and the UI never see a credential.

**Before** (typed-in secret sent as a bearer token)

```ts
accounts: {
  "my-ext-account": {
    label: "My account",
    fields: {},
    secret: { label: "API token" },
    auth: { scheme: "bearer" },
    origins: ["https://api.example.com"],
  },
},
```

**After** (the provider signs every request; `secret`/`secrets` become inputs of the provider)

```ts
// src/extension.ts
accounts: {
  "my-ext-account": {
    label: "My account",
    fields: {},
    secrets: { keyId: { label: "Key id" }, keySecret: { label: "Key secret" } },
    provider: "extension",
    signInOrigins: ["https://auth.example.com"], // what ctx.http of the provider may reach
    origins: ["https://api.example.com"], // where the credential is sent
  },
},

// src/credentials.ts
import { defineCredentialProvider } from "@nervekit/extension-sdk";
export default defineCredentialProvider({
  signIn: async (ctx) => ({ state: {} }),
  apply: async (ctx) => ({ headers: { authorization: "..." } }),
});
```

`nerve-ext build` bundles `src/credentials.ts` into `dist/credentials.js` and records its hash and operations in `dist/manifest.json` (`credentials`). The hash is part of what the user consents to: changing the credential code asks again. `ctx` is fixed: `account`, `secrets`, `state`, `crypto` (hash, HMAC, random bytes, RS/PS/ES/EdDSA signing), `http` (sign-in origins only; `signIn`, `refresh`, `revoke`), `ui` (`signIn` only; `ui.loopback({ path? })` listens for an authorization code redirect and returns the `redirectUri` and a host-made `state` to send, and `path` serves services that accept only certain redirect paths, such as `/oauth/callback` for AWS IAM Identity Center) and, in `apply`, `request` with `body.digest(algorithm)` and `body.bytes()` and no network. The sandbox has no `URL`: use `request.host`, `request.path` and `request.query`. `refresh` returns a new credential, `{ needsSignIn: true }`, or throws when it cannot tell (network): the host keeps the credential and tries later. `createFakeCredentialContext` in `@nervekit/extension-sdk/testing` runs a provider in tests. Examples: `examples/aws-sigv4` and `examples/github-app` in this package.
