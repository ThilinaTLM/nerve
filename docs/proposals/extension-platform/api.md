# Extension API

Part of [Extension platform](README.md). Names are proposals; the shapes matter.

## Rules

- `@nervekit/extension-api` has no runtime dependencies. Extension code imports only it (and its own files).
- Every `ctx` call is async and exchanges plain data (JSON values, `Uint8Array`, handles). No class instances, callbacks or host objects cross the boundary, so the same code can run in a sandbox later.
- Extension code never sees a secret. Credentials are injected by the host into `ctx.http` requests.
- The host owns decisions: permissions, approvals, network policy, limits. The extension declares; the host enforces.

## Manifest

```ts
export default defineExtension({
  id: "atlassian", // stable; settings, accounts and operations are keyed by it
  apiVersion: 1,
  name: "Atlassian",
  description: "Jira and Confluence through quick_script.",
  icon: "atlassian",
  enabledByDefault: false,

  settings: {
    version: 1,
    fields: {
      account: { type: "account", kind: "atlassian", label: "Account" },
      jira: { type: "boolean", default: true, label: "Jira" },
      confluence: { type: "boolean", default: true, label: "Confluence" },
    },
    migrations: [],
  },

  accounts: {
    atlassian: {
      label: "Atlassian account",
      fields: {
        site: { type: "string", format: "url" },
        email: { type: "string" },
      },
      secret: { label: "API token", help: "…" },
      auth: { scheme: "basic", user: "email" }, // how ctx.http injects it
      origins: ["{site}"], // credential is sent only here
      test: (account, ctx) => checkConnection(ctx), // Settings "Test" button
    },
  },

  permissions: {
    network: [
      "https://*.atlassian.net",
      "https://api.media.atlassian.com",
      "{account.site}",
    ],
    capabilities: [], // e.g. "models.image"
  },

  namespaces: [jira, confluence, atlassian, storage],
  tools: [], // direct tools; see the Web example below
  prelude: "./prelude.js", // pure sandbox-side helpers (storage builders), no host access
});
```

The manifest without functions (`test`, `availability`, methods' `parse`/`authorize`/`run`) is plain data; contracts validate it with a Zod schema typed against the API (`satisfies z.ZodType<…>`).

## Namespace

```ts
export const jira = defineNamespace({
  id: "jira",
  enabledBy: "jira", // boolean setting of the extension
  requires: { account: "account" }, // availability: account selected, exists, has a secret
  summary: "Jira issues, search, transitions, comments, sprints.",
  rules: ["…"],
  types: jiraTypes,
  docs: [{ id: "jira/workflows", whenToRead: "…", file: "docs/workflows.md" }],

  // Once per quick_script run, on first use; holds clients and caches (fields, space keys).
  session: async (ctx) => new JiraSession(ctx),

  methods: {
    "issues.create": method({
      risk: "external_write",
      signature: "create(input: IssueInput): Promise<IssueRef>",
      parse: (args) => issueInput(args),
      authorize: (input) => ({
        operation: "jira.issues.create",
        targets: [{ kind: "resource", value: `jira:project/${input.project}` }],
        summary: `Create issue in ${input.project}`,
      }),
      run: (session, input, ctx) => session.createIssue(input),
    }),
  },
});
```

`parse` and `authorize` stay synchronous and pure, so the host can authorize before any I/O (today's `prepare` split). An optional `availability(ctx)` returns `{ available: false, reason, fix }` for checks the declarations cannot express.

## Direct tools

An extension can contribute direct tools for work the agent does often enough that discovery through `sdk.*` costs too much. A tool is usually bound to a namespace method, so it shares parsing, authorization and execution:

```ts
// web/manifest.ts
tools: [
  defineTool({
    name: "web_search", // unique across core and extension tools
    method: "web.search", // same parse → authorize → run as quick_script's web.search
    description: "Search the web …",
    parameters: webSearchSchema, // JSON Schema for the model
    display: "links", // platform display kind for the transcript
  }),
],
```

- A tool without `method` declares its own `parse`, `authorize` and `run(args, ctx)`.
- The tool is offered while its extension (and `enabledBy` switch, if any) is on and its `requires` are met. It shows on the Tools page under its extension. Unavailable tools are left out of the request, like disabled core tools today.
- Permissions: rules can name the tool (`web_search`) or its operation (`web.search`); both match, as `web_fetch` and `files.*` do today.
- Results: the method's result goes to the agent through the generic result projection (size limits, artifacts for large output). The transcript renders it with a **display kind** from a small platform set (`text`, `markdown`, `links`, `table`, `artifact`), so the app needs no per-tool view. Today's `web_search` view becomes the `links` kind.

## Context

```ts
interface ExtensionContext {
  /** Resolved values of this extension's own settings (user → project → conversation). */
  settings: { get<T>(key: string): T | undefined };

  accounts: {
    /** The account an `account` setting points at; undefined when unset or deleted. */
    selected(field: string): Promise<AccountInfo | undefined>;
  };

  http: {
    request(req: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string | Uint8Array | { json: unknown } | { form: FormPart[] };
      auth?: { account: string }; // host injects the credential per the kind's `auth`
      timeoutMs?: number;
      maxBytes?: number;
      response?: "json" | "text" | "bytes" | { artifact: string }; // stream to an artifact
    }): Promise<HttpResponse>;
  };

  artifacts: {
    write(
      name: string,
      data: Uint8Array | string,
      mediaType?: string,
    ): Promise<ArtifactRef>;
    read(
      handle: string,
    ): Promise<{ bytes: Uint8Array; mediaType: string; name: string }>;
    info(handle: string): Promise<ArtifactInfo>; // size, media type, image dimensions
  };

  report: {
    created(entry: ReportEntry): void; // shown in the run footer
    updated(entry: ReportEntry): void;
    deleted(entry: ReportEntry): void;
    note(text: string): void;
  };

  /** Only capabilities the manifest declares. */
  models: { image?: { generate(req: ImageRequest): Promise<ImageResult> } };

  signal: AbortSignal;
  log: {
    debug(msg: string, data?: unknown): void;
    warn(msg: string, data?: unknown): void;
  };
}

type AccountInfo = {
  id: string;
  name: string;
  kind: string;
  fields: Record<string, unknown>;
};
```

- **`http`** applies the host's fetch policy once for everyone: allowed origins, SSRF guard, redirects, timeouts, size limits, cancellation. A `401`/`403` on a request with `auth` becomes a host error naming the account and the fix ("update the Atlassian account … in Settings → Extensions → Atlassian"); this replaces `JIRA_UNAUTHORIZED` mapping in the runtime.
- **Reads from a script** (`files` handles passed into a method, e.g. attachment upload) arrive as handles; the method reads them through `ctx.artifacts.read`, which the host authorizes as today.
- **Errors:** `throw new ExtensionError(code, message, { fix })`. The host formats it for the agent; other exceptions become a generic failure with the message.
- **`models.image`** keeps backends (openai-codex today) in the host. The request and result types move from `quick-script/src/extensions/imagegen` to the API.

## Host side

| Concern                                                           | Owner after phase 1                                                                      |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Registry of built-ins                                             | Server composition passes `builtinExtensions` from `@nervekit/extensions` to the runtime |
| Description, discovery, prelude, guarded globals                  | `tools/quick-script` runtime, from manifests (unchanged mechanism)                       |
| `ctx` implementation, sessions, availability                      | `tools/quick-script` extension host, through ports                                       |
| Settings resolution, accounts store, secret store, model backends | `workbench-server`, implementing the ports                                               |
| Extensions page, account list and dialog                          | `workbench-app`, generated from manifest metadata                                        |

## Accounts store

```json
{
  "version": 2,
  "accounts": {
    "atlassian": [
      { "id": "acme", "name": "Acme", "fields": { "site": "…", "email": "…" } }
    ],
    "tavily": []
  }
}
```

Secret ids become `account:<kind>:<id>`. Kinds are unique across extensions; the registry rejects duplicates. Migration: extend draft step 0005 to reshape `accounts.json` and rename `atlassian:<id>` / `tavily:<id>` secrets. The stale `jira`/`confluence`/`tavily` env-var mappings in `auth-manager.ts` go.

## Deviations in step 1 (S1a)

Recorded where the implementation ([`extension-api`](../../../packages/extension-api), [`extension-host/`](../../../packages/tools/src/quick-script/extension-host)) refines the shapes above:

- **Account kinds** in the API are keyed by kind (`accounts: { atlassian: {…} }`); the registry and contracts keep the array form with `kind` (`AccountKind[]`).
- **`ctx.http` `auth`** names the extension's `account` setting (`auth: { account: "account" }`), the same field name `ctx.accounts.selected` takes, not an account id.
- **`permissions.network` templates:** besides `{account.<field>}` (a field of the selected account), `{settings.<key>}` names a setting of the extension (the Diagrams Kroki server). Both are user-supplied destinations and may be on a private network; every other origin goes through the SSRF guard. The account kind's `origins` use `{<field>}`.
- **`enabledBy`** is one switch or a list (any of): the `atlassian` namespace follows `jira` or `confluence`.
- **Authorization** of a method returns one check, several or none (`authorize` may return an array). A host-tool check such as `{ toolName: "read", args: { path } }` opens that workspace file to `ctx.artifacts.read` for the run; reading a file the call did not declare fails with `DENIED`.
- **Bound direct tools** call the method's `parse` with the tool's arguments object as the single argument (`parse([args])`); a script passes positional arguments. Own tools (`parse`/`authorize`/`run`) default their operation to `<extension>.<tool>`.
- **Responses:** `ctx.http.request` returns `{ status, ok, headers, url, body }` for every status except `401`/`403` on an authenticated request, which become host errors (`UNAUTHORIZED` ends the run, `FORBIDDEN` names the account). `body` is the parsed JSON, text, bytes or the `ArtifactRef` for `response: { artifact }`.
- **`ReportEntry`** is a string label; `ctx.report.note` lines print after the run's report.
- **Permission rules** can name an extension tool's operation (`web.search`) through `quick_script` operation rules; rule exceptions naming the tool itself (`tool: "<name>"`) still validate against the core tool names only, because contracts cannot see the runtime registry.

## Deviations in step 2 (Diagrams, Web, Image generation)

- **Any-origin fetch:** `permissions.network` accepts `"*"` alone, meaning any public `http(s)` origin. It is for `web.fetch` only in spirit: the host's SSRF guard still applies to every hop (private addresses stay blocked unless the host policy allows them, as for `web_fetch`), and no credential is injected, because credentials go only to an account kind's own `origins`. The Web extension lists `["https://api.tavily.com", "*"]`.
- **HTML conversion is a host text utility:** `ctx.text.htmlToMarkdown(html)` runs the tools worker (time, input and output limits) for plain HTML. The alternative, keeping `web.fetch` behind the core `web_fetch` path, would keep a second implementation and the extension out of `ctx.http`; one small host call is simpler and sandbox-friendly. Confluence storage conversion stays in the Atlassian extension. `web.fetch` downloads with `ctx.http` (`response: "bytes"`, the extension's 8 MiB `web.fetch` limit) and is still authorized as the core `web_fetch` tool, so URL rules and approvals are unchanged.
- **`web_search`** is the Web extension's direct tool bound to `web.search`, display kind `links`. `web.search` is an operation (`web.search`, network, no targets) like every other method; its `Authorization: Bearer` credential comes from the `searchAccount` Tavily account (`ctx.http` `auth`). The tool's `max_results` argument and a script's `limit` option mean the same. Without a selected account the method fails with `DENIED` and a fix; the tool is offered only while the account has a saved key. The tool has its own `run` (same `parse`, same operation `web.search`, same Tavily call with `include_answer`) and a `present` hook, so the agent reads the old text (Tavily answer, then each result with its full content) while the transcript list gets `{ title, url, snippet }` with 300-character snippets. The script method returns the compact hits (`{ title, url, snippet, published? }`).
- **Kroki server** is the `server` setting; its origin comes from the `{settings.server}` template, so a private server works and every redirect hop stays inside it (the old code refused redirects). Diagram requests ask for PNG only; the extension validates the PNG signature itself.
- **Additions to `ctx` and the package:** `ctx.artifacts.freshName(base, extension)` (an unused `<base>-<n><extension>` artifact name), `ctx.text.htmlToMarkdown`, `isArtifactName`, and the call helpers `parseOptions(method, args, { bare?, options })` and `nonEmptyString` for methods taking one options object (a bound tool passes its arguments object the same way). The fake context takes `htmlToMarkdown`.
- **Image generation types** (`ImagegenBackend`, `ImageOptions`/`ImageBackendRequest`, `ImageGenerateRequest`/`ImageGenerateResponse`) live in `extension-api`; the server's image-generation domain implements them. The extension validates call options that do not depend on settings in `parse`, so a bad call never reaches an approval; settings-dependent refusals (reference images with a backend that takes none) happen in `run`, before the backend is called. Workspace files used as reference images are declared as `read` authorizations.
- **App:** `ExtensionView.toolAvailability` (optional) carries each direct tool's availability beside the namespaces'. The transcript has one view for all direct tools (`ExtensionToolView`) that renders `details.display` by kind; `text` and `markdown` show the value (or the result text), `links` a list of `{ title, url, snippet? }`, `table` rows of records (or `{ columns, rows }`), `artifact` the artifact references. The Tools page groups extension tools under their extension (`ToolDescriptor.extension`) and takes their state from `toolAvailability`; the app learns which names are extension tools from the same tool list.

## Deviations after the port (behaviour regressions)

- **Uploads stream from the host.** A multipart `FormPart` with `data: { handle }` is read by the host from the authorized artifact or workspace file and streamed with a known `content-length`; its bytes never enter extension code. The limit is the old 100 MB transfer limit (`ctx.artifacts.read` keeps 20 MB). `ctx.artifacts.info` reports sizes up to 100 MB and reads PNG/JPEG dimensions only for files up to 20 MB. Atlassian uploads use the handle and `info`; SVG is rejected by name or media type, and GIF/WebP dimensions and conversion are dropped.
- **`response: { artifactFor(contentType) }`** (besides `{ artifact }`) lets the extension name the artifact from the response's content type; returning `undefined` (or a non-2xx status) returns the body as `text`. Raw `jira.request`/`confluence.request` use it to stream binary responses up to 100 MB instead of buffering 20 MB.
- **`ctx.authorize` is bound to the running call.** It goes through the same nested authorization as declared checks and is refused (`BAD_REQUEST`, before any approval) when its risk is above the method's declared risk, the same invariant as `assertDeclaredRisk`; outside a call it is unavailable.
- **Approval target:** for quick_script and extension tools, the target covers the resolved extension settings and, per enabled extension, each selected account's id, kind, name and non-secret fields, so switching an account's site ends approvals.
- **A 401/403 of a redirect target** (a signed media URL, which got no credential) is returned as a normal response; only the credentialed origin's 401/403 becomes `UNAUTHORIZED`/`FORBIDDEN`.
- **`OwnToolDefinition.present(output)`** splits a tool's result into the agent text and the transcript value.

## Deviations in the structural cleanup (goal 1)

- **The registry has no default.** `installQuickScriptExtensions`, `quickScriptRegistry()` and the module-level `quickScriptToolDefinition` are gone. `createQuickScriptRegistry(definitions, { readExtensionDoc })` takes `ExtensionDefinition`s only (no hand-written manifests), and every consumer receives the registry explicitly: `createQuickScriptToolDefinition(registry)`, `quickScriptDescription(capabilities, registry)`, `classifyQuickScript*(…, registry)`, `QuickScriptContext.registry` (required by the executor; it throws without one). The host composes it once in `workbench-server/src/core-host/host-tools.ts`.
- **`@nervekit/extensions` exports the definitions list and nothing else.** `builtinExtensions` is `readonly ExtensionDefinition[]`; the conversion to the registry shape (`fromDefinition`), the settings definitions and `ExtensionMetadata` are host code in `@nervekit/tools/quick-script` (`extensionSettingsDefinition`, `extensionMetadata`). The package depends on `@nervekit/extension-api` only; the temporary edges to `contracts`, `native` and `tools` are removed.
- **Docs are declared, not read.** `ExtensionDefinition.readDoc` is removed. A `DocTopic.file` is a path relative to the extension's folder (`docs/jira-workflows.md`); the host reads it through `QuickScriptRegistryOptions.readExtensionDoc(extensionId, file)`. For the built-ins that reader is `readBuiltinExtensionDoc` from the `@nervekit/extensions/docs` subpath, which resolves `src/<id>/docs/` from source and `dist/extension-docs/<id>/docs/` from builds and the desktop bundle (`scripts/build/copy-extension-assets.ts`, `bundleAssets`). Extension code has no file-system access, so the model stays sandbox-ready.
- **Tests that compose the runtime with the built-ins live in the server.** They need `@nervekit/tools` and `@nervekit/extensions` together, which `extensions` may no longer import, so they moved from `packages/extensions/test` to `packages/workbench-server/test/extensions/` and use the host's composition. `@nervekit/tools` exposes the runtime internals they use through a `@nervekit/tools/quick-script/testing` subpath (the `quick-script/*` wildcard export is gone). `extensions` keeps only unit tests next to the code (`src/<id>/**.test.ts`, `ctx` fakes from `extension-api/testing`).
- **Script scan: argument-dependent risk is generic.** The scanner no longer names `jira.request`/`confluence.request`. For an operation method with literal arguments it takes the risk from the method's own `authorize` (a raw request is a network read for `GET`, destructive otherwise); with non-literal arguments it uses the declared risk and unknown targets. Differences from before: the operations label of a raw request is `jira.request (POST)` (the verb as the first literal argument), and a computed verb (`jira.request(m, "/x")`) stays admissible for operation rules with the declared destructive risk and no targets instead of being marked non-analysable.
- **`AccountTestResult.reason`:** a failed account test may say why (`rejected` (default), `restricted`, `unavailable`, `unreachable`); the Settings "Test" button words them differently, and a `test` hook throws `ExtensionError("BAD_REQUEST")` when the account lacks something the test needs (a site URL).
- **`enabledBy` lists** (one switch or any of several) are in the API, the registry and `ExtensionMetadata.contributes.namespaces[].enabledBy`; a namespace without `enabledBy` follows its extension's switch.
- **Built-in rule sets name namespaces.** The `planning` rule set allows network reads in the `jira`, `confluence`, `web` and vision groups; a quick_script operation's tool group is its namespace, so these are namespace names in product policy (`tools/src/policy/rule-sets/planning.json`). Extensions do not declare "read-only research" namespaces, so the list stays explicit and is a reviewed exception of the `extension-naming` repository rule (`scripts/checks/extension-naming-policy.ts`), which fails any other production-source mention of an extension outside its folder, the registry list and old migration steps. A future `research: true` flag on a namespace would let the rule set derive it.
- **Rename pending:** `ImagegenBackend` in `extension-api` names the old extension; rename it to `ImageBackend` (it is the host's image backend id).
