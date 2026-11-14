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
