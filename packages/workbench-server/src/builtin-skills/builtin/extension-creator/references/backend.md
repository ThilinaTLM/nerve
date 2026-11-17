# Backend: namespaces, methods and `ctx`

The backend runs in a sandbox (QuickJS) with no Node.js built-ins, filesystem, network or timers. Everything outside goes through `ctx`. Only browser-safe npm packages can be bundled.

## Namespace and method

```ts
import {
  defineNamespace,
  ExtensionError,
  method,
} from "@nervekit/extension-sdk";

export const get = method({
  risk: "external_read",
  signature:
    "/** GET a path on the configured server; returns parsed JSON. */ get(path: string): Promise<unknown>",
  parse: ([path]) => {
    /* validate; throw ExtensionError("BAD_REQUEST", ...) */ return {
      path: String(path),
    };
  },
  authorize: ({ path }) => [
    { targets: [`my-ext:path/${path}`], summary: `GET ${path}` },
  ],
  run: async (_session, { path }, ctx) =>
    (await ctx.http.request({ url: `${ctx.settings.get("server")}${path}` }))
      .body,
});
```

- `signature` is a TypeScript declaration; its leading doc comment is what `sdk.search` and `sdk.describe` print. Methods take one argument: a bare string or an options object.
- `parse` is synchronous and pure; `authorize` too, and both run before any I/O. A bad call never reaches an approval.
- `types` of the namespace holds the shared declarations of what methods return.

## Risks

`risk` is the most the method can do; the permission engine and the script scanner start from it. A check from `authorize` carries that risk. Only a method with `riskFromArgs: true` (a raw request: GET reads, anything else writes) returns the call's own risk from `authorize`, never above `risk`; the scanner then needs literal arguments or counts the call as destructive.

| Risk             | Use for                                 |
| ---------------- | --------------------------------------- |
| `none`           | No external effect.                     |
| `read`           | Reads local files of the project.       |
| `external_read`  | Reads from a service.                   |
| `write`          | Changes project files.                  |
| `external_write` | Creates or changes things in a service. |
| `destructive`    | Deletes, or cannot be analyzed.         |

`authorize` returns `{ targets, summary }` (resources as `<system>:<type>/<id>`, `summary` is the label in approvals), or `{ toolName: "read", args: { path }, summary }` to check a workspace file as the host's `read` tool. Targets known only after a lookup go through `await ctx.authorize({ operation, targets, risk })` before the first write; it rejects with `DENIED` when the policy refuses.

## `ctx` services

| Service                                                                                 | Use                                                                                                                          |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `ctx.settings.get(key)`                                                                 | Resolved value of the extension's own setting.                                                                               |
| `ctx.accounts.selected(field)`                                                          | The account an `account` setting points at (fields only; never the secret).                                                  |
| `ctx.http.request({ url, method, headers, body, auth, response, maxBytes, timeoutMs })` | The only network access. The URL must match `permissions.network`; `auth: { account }` makes the host inject the credential. |
| `ctx.artifacts.write/read/info/freshName`                                               | Files of the conversation (`artifact:<name>`), and workspace paths the call was authorized to read.                          |
| `ctx.text.htmlToMarkdown(html)`                                                         | HTML to Markdown run by the host.                                                                                            |
| `ctx.authorize(check)`                                                                  | Policy check for targets found at run time.                                                                                  |
| `ctx.report.created/updated/deleted/note`                                               | Entities listed in the run footer; one label per entity.                                                                     |
| `ctx.models.image`, `ctx.models.vision`                                                 | Only with the matching `permissions.capabilities`.                                                                           |
| `ctx.progress(section, chunk)`                                                          | Streams text into a live section of a direct tool's card.                                                                    |
| `ctx.log.debug/warn`                                                                    | Host log.                                                                                                                    |
| `ctx.signal`                                                                            | Never aborts inside the sandbox; the host cancels the call.                                                                  |

Bytes cross the sandbox boundary as base64, which costs about a third more and memory on both sides. For downloads, pass `response: "artifact"` to `ctx.http.request`: the host streams the body to an artifact (up to 100 MB) and returns its reference; pass the handle on instead of the bytes.

## Sessions

`session: (ctx) => ...` runs once per `quick_script` run on first use and holds clients and caches. Keep plain data in it, never `ctx`: the `ctx` belongs to the call that opened the session and is not valid in later calls. Take `ctx` from `run`'s third argument every time.

## Errors

Throw `new ExtensionError(code, message, { fix })`. Codes: `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `FORBIDDEN`, `DENIED`, `RATE_LIMITED`, `UNAUTHORIZED`, `SERVER_ERROR`. The script sees `e.code` and the message, so say what happened and the next step. Messages from installed extensions are cut at 600 characters.

## Direct tools

`tools: [{ name, description, parameters, method }]` exposes a method to the model without a script; `risk`, `parse`, `authorize`, `run` can be given instead of `method` for a tool with its own implementation. A tool's `view` chooses how its card renders (`text`, `markdown`, `links`, `table`, `artifacts` sections). Tool names are global; prefix them with the extension id.

## Tests

`@nervekit/extension-sdk/testing` gives `createFakeContext` and Vitest's `describe`, `it`, `expect`, `vi`.

```ts
const { ctx, record } = createFakeContext({
  settings: { server: "https://api.test" },
  http: () => ({ status: 200, ok: true, headers: {}, url: "", body: [] }),
});
const input = get.parse(["/items"]);
await get.run(undefined, input, ctx);
expect(record.requests[0]?.url).toBe("https://api.test/items");
```

`record` also holds `authorized`, `created`, `updated`, `deleted`, `notes`, `logs`, `progress` and `artifacts`. Test `parse` errors, `authorize` targets and risk, and one run per method.

## Calls from a frame

A UI frame calls `host.call("<namespace>.<method>", args)`. No permission prompt applies, because the user's consent covers it; `ctx` rules still hold (network allowlist, credentials stay host-side, file reads stay inside the project). `args` arrives as the method's single argument, so `parse` must accept an object there.
