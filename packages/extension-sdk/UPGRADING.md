# Upgrading extensions

One section per SDK version that breaks extensions, newest first. The SDK shares Nerve's version; a section exists only for versions that change the extension API, the UI bridge, the manifest format, `ui-kit` components or theme token names (the versions that raise a floor of Nerve's `oldestCompatibleSdkVersion`, which has one floor per surface: `manifest`, `backend`, `ui`, `credentials`, `themes`). Name the surface in the section so the agent can skip sections that do not touch the extension. `test/public-surface.test.ts` fails on any change to the public surface until you decide: additive (update its snapshot), or breaking (raise the floor, add a section here, update the snapshot).

To upgrade an extension from SDK `A` to SDK `B`: apply every section with `A < version <= B`, oldest first, then bump `@nervekit/extension-sdk` in `package.json` to `B` (exact version) and run `npm install` and `npx nerve-ext check`.

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

`nerve-ext build` bundles `src/credentials.ts` into `dist/credentials.js` and records its hash and operations in `dist/manifest.json` (`credentials`). The hash is part of what the user consents to: changing the credential code asks again. `ctx` is fixed: `account`, `secrets`, `state`, `crypto` (hash, HMAC, random bytes, RS/PS/ES/EdDSA signing), `http` (sign-in origins only; `signIn`, `refresh`, `revoke`), `ui` (`signIn` only) and, in `apply`, `request` with `body.digest(algorithm)` and `body.bytes()` and no network. The sandbox has no `URL`: use `request.host`, `request.path` and `request.query`. `refresh` returns a new credential, `{ needsSignIn: true }`, or throws when it cannot tell (network): the host keeps the credential and tries later. `createFakeCredentialContext` in `@nervekit/extension-sdk/testing` runs a provider in tests. Examples: `examples/aws-sigv4` and `examples/github-app` in this package.
