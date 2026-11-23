# Backend: namespaces, methods and `ctx`

Exact signatures: `reference/extensions/api.md`. This page explains how the pieces fit and what is easy to get wrong.

The backend runs in a sandbox (QuickJS) with no Node.js built-ins, filesystem, network or timers. Everything outside goes through `ctx`, the `ExtensionContext` (`reference/extensions/api/extension-api/types.d.ts`). Only browser-safe npm packages can be bundled.

## Namespace and method

A namespace is what scripts call in `quick_script` (`myext.get("/items")`). Each method declares what it may do, validates its input, says what it touches, then runs:

```ts
import { ExtensionError, method } from "@nervekit/extension-sdk";

export const get = method({
  risk: "external_read",
  signature:
    "/** GET a path on the configured server; returns parsed JSON. */ get(path: string): Promise<unknown>",
  parse: ([path]) => {
    if (typeof path !== "string" || !path.startsWith("/"))
      throw new ExtensionError("BAD_REQUEST", "path must start with /", {
        fix: 'Pass a path such as "/items".',
      });
    return { path };
  },
  authorize: ({ path }) => [
    { targets: [`my-ext:path/${path}`], summary: `GET ${path}` },
  ],
  run: async (_session, { path }, ctx) =>
    (await ctx.http.request({ url: `${ctx.settings.get("server")}${path}` }))
      .body,
});
```

- `signature` is a TypeScript declaration. Its leading doc comment is what agents see in `sdk.describe` and `sdk.search`, so write it for them. Methods take one argument: a bare string or an options object.
- `parse` and `authorize` are synchronous and pure and run before any I/O, so a bad call fails before anyone is asked to approve it.
- Put shared return types in the namespace's `types`, and longer guidance in doc topics (`docs/*.md` listed in `docs`), not in summaries.

## Risk and authorization

`risk` (`Risk`, `reference/extensions/api/extension-api/authorization.d.ts`) is the most the method can do; the permission engine and the script scanner start from it. Choose the lowest level that is true for every call, because users write permission rules against it.

`authorize` names what the call touches: resource targets as `<system>:<type>/<id>` (`jira:issue/APP-12`), which users can match in permission rules, and a `summary` shown in approvals. To read a workspace file, authorize it as the host's `read` tool so the user's file rules apply. Targets known only after a lookup (the page a comment belongs to) go through `await ctx.authorize(...)` before the first write.

## Network, accounts and data

- `ctx.http.request` is the only network access, and only to origins in `permissions.network`. Declare the narrowest origins; `*` is shown to the user as broad.
- Credentials never reach the extension: set `auth: { account: "<setting key>" }` and the host adds the selected account's credential to the request, only toward that account's `origins`. `ctx.accounts.selected` returns non-secret `fields`, `level` and, for accounts with a provider, `identity`.
- Bytes cross the sandbox boundary as base64, which costs a third more plus memory on both sides. For downloads use `response: "artifact"` and pass the artifact handle on instead of the bytes.
- Settings hold no secrets; read them with `ctx.settings.get`.
- `ctx.extensionStore` keeps this extension's data per project, across conversations and shared with its frames (`host.store`); revisions and `ifRevision` work as in `ui.md` ("Keeping state"), and a stale write throws `CONFLICT`. Without an open project it throws `BAD_REQUEST`. Use artifacts for files the conversation and agent should see, the store for the extension's own state.

### An account kind

The user adds accounts of the kind in Settings → Accounts; a setting of type `account` selects one; `auth` on a request names that setting. An account is user-level (every project) or project-level. A kind a project extension defines has project-level accounts only.

Choose how the credential is obtained with `provider`. Declare only what the service needs:

| Need                                                                          | Declare                                                                                                                                                          |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token, password or API key the user types in                                  | `secret` (or `secrets` for several by name) and `auth`: `bearer`, `basic`, `header` or `query`; a list of `auth` entries sets several, each naming its `secret`. |
| Standard OAuth 2.0 (authorization code, device code)                          | `provider: { type: "oauth2", ... }`, no `auth`; the client id is an account field (`clientIdField`). Nerve ships no OAuth apps.                                  |
| Request signing, token exchange, login for a session token, any other sign-in | `provider: "extension"`, `signInOrigins` and a credential provider in `src/credentials.ts` (`defineCredentialProvider`).                                         |

Credential code runs in its own sandbox, sees the account's secrets and state and has no free I/O: `http` only to `signInOrigins` (`signIn`, `refresh`, `revoke`), `ui` only in `signIn`, `crypto`, and in `apply` the request with `body.digest()`/`body.bytes()` and no network. `apply` returns only headers and query parameters. Read `reference/extensions/api/extension-api/credentials.d.ts` and the SDK's `examples/aws-sigv4` and `examples/github-app`. Changing `credentials.js` asks the user for consent again.

To use accounts that any extension defines for a platform (`github`), declare `uses: [{ platform, scopes?, origins? }]` and give the `account` setting `platform` instead of `kind`; it offers every account of that platform whose definition covers your origins. Set `platform` on your own kind to share it the same way.

```ts
defineExtension({
  id: "acme",
  // ...
  accounts: {
    // Kind names start with the extension id.
    "acme-api": {
      label: "Acme account",
      fields: { site: { type: "string", format: "url", label: "Site" } },
      secret: {
        label: "API token",
        help: "Create one under Profile → Tokens.",
      },
      auth: { scheme: "bearer" },
      // The token is sent only to these origins; `{site}` comes from the account's fields.
      origins: ["{site}"],
      // Behind the Test button in Settings.
      test: async (account, ctx) => {
        const response = await ctx.http.request({
          url: `${account.fields.site}/api/me`,
          auth: { account: "account" },
        });
        return response.ok
          ? { ok: true, message: "Signed in." }
          : { ok: false, message: `Acme answered ${response.status}.` };
      },
    },
  },
  settings: {
    version: 1,
    fields: {
      account: { type: "account", kind: "acme-api", label: "Account" },
    },
  },
  // `{account.site}` is the selected account's field.
  permissions: { network: ["{account.site}"] },
});

// In a method:
const { site } = (await ctx.accounts.selected("account"))!.fields;
await ctx.http.request({
  url: `${site}/api/items`,
  auth: { account: "account" },
});
```

## Sessions

`session: (ctx) => ...` runs once per `quick_script` run, on first use, and holds clients and caches. Keep plain data in it, never `ctx`: a `ctx` belongs to the call that opened the session and is invalid in later calls. Take `ctx` from `run`'s third argument every time.

## Errors

Throw `ExtensionError` (`reference/extensions/api/extension-api/errors.d.ts`) with the code that fits and a `fix`. The calling script sees `e.code` and the message, so say what happened and what to do next.

## Direct tools

A direct tool exposes a method to the model without a script: give `method: "<namespace>.<method>"`, or its own `risk`, `parse`, `authorize` and `run`. Prefer a namespace method when scripts would combine calls; add a direct tool for the one or two actions the model needs often. Tool names are global; prefix them with the extension id. A tool bound to a method calls the method's `parse` with one element, the tool's arguments object (`parse: ([args]) => ...`), not the positional arguments of a script call. Write a `parse` that accepts both when the method has both callers.

## Tests

`createFakeContext` (`reference/extensions/api/extension-api/testing.d.ts`) records requests, authorizations, reports and artifacts:

```ts
import { createFakeContext, expect, it } from "@nervekit/extension-sdk/testing";

it("requests the configured server", async () => {
  const { ctx, record } = createFakeContext({
    settings: { server: "https://api.test" },
    http: () => ({ status: 200, ok: true, headers: {}, url: "", body: [] }),
  });
  await get.run(undefined, get.parse(["/items"]), ctx);
  expect(record.requests[0]?.url).toBe("https://api.test/items");
});
```

Test `parse` errors, `authorize` targets and risk, and one run per method.

## Calls from a frame

A UI frame calls a method with `host.backend.call("<namespace>.<method>", args)`. No permission prompt applies, because the user's consent to the extension covers it; the `ctx` rules still hold (network allowlist, credentials stay with the host, file reads stay inside the project). `args` arrives as the method's single argument, so `parse` must accept an object there.
