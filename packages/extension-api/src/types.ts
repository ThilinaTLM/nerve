/* eslint-disable @typescript-eslint/no-explicit-any -- method tables hold methods of different session and input types */
/*
 * The extension contract: manifest, namespace, method and tool shapes, and the
 * `ExtensionContext` (`ctx`) the host hands to extension code.
 *
 * Every `ctx` call is async and exchanges plain data (JSON values,
 * `Uint8Array`, handles), so extension code can later run in a sandbox. An
 * extension never sees a secret: the host injects credentials into
 * `ctx.http` requests.
 */

// ── Risk, authorization ──────────────────────────────────────────────────────

/**
 * What a method can do at most: `none` has no external effect, `read` reads
 * local data, `network` reads through an integration, `write` changes
 * workspace files, `external_write` changes things in an integration,
 * `destructive` deletes or cannot be analysed.
 */
export type Risk =
  | "none"
  | "read"
  | "network"
  | "write"
  | "external_write"
  | "destructive";

/** A resource a call acts on, normalized `<system>:<type>/<id>`: `jira:issue/APP-12`. */
export type OperationTarget = { kind: "resource"; value: string };

/** What the permission policy checks for a call: an operation on targets. */
export type OperationAuthorization = {
  /** Defaults to `<namespace>.<method>`. */
  operation?: string;
  targets: readonly (OperationTarget | string)[];
  /** Defaults to the method's declared risk; never lower than it. */
  risk?: Risk;
  /** Short label for approvals and records (JQL, issue key, ...). */
  summary: string;
};

/**
 * A call checked as a host tool, e.g. `{ toolName: "read", args: { path } }`
 * for a workspace file the method will read through `ctx.artifacts.read`.
 */
export type ToolAuthorization = {
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
};

export type Authorization = OperationAuthorization | ToolAuthorization;

/** What `authorize` returns: one check, several (every one must pass) or none. */
export type AuthorizeResult =
  | Authorization
  | readonly Authorization[]
  | undefined;

// ── Settings and accounts ────────────────────────────────────────────────────

export type SettingScope = "user" | "project" | "conversation";

type FieldBase = {
  label: string;
  description?: string;
  section?: string;
  /** All three unless narrowed. */
  scopes?: SettingScope[];
  visibleWhen?: { field: string; equals: string | boolean };
  advanced?: boolean;
};

export type SettingField =
  | (FieldBase & { type: "boolean"; default: boolean })
  | (FieldBase & {
      type: "string";
      default?: string;
      format?: "url" | "text";
      placeholder?: string;
      maxLength?: number;
    })
  | (FieldBase & {
      type: "number";
      default?: number;
      min?: number;
      max?: number;
      step?: number;
      unit?: string;
    })
  | (FieldBase & {
      type: "enum";
      default: string;
      options: {
        value: string;
        label: string;
        description?: string;
      }[];
    })
  /** Id of a user account of this kind. */
  | (FieldBase & { type: "account"; kind: string })
  | (FieldBase & { type: "model"; capability?: "image" | "vision" });

export type SettingsSchema = {
  sections?: { id: string; title: string; description?: string }[];
  fields: Record<string, SettingField>;
};

export type ExtensionSettings = SettingsSchema & {
  /** Bump when a field changes meaning. */
  version: number;
  /** `migrations[n]` converts version n-1 settings to version n, on read. */
  migrations?: Readonly<
    Record<
      number,
      (settings: Record<string, unknown>) => Record<string, unknown>
    >
  >;
};

/** How `ctx.http` injects an account's credential. */
export type AccountAuth =
  | {
      /** `Authorization: Basic base64(<account field>:<secret>)`. */
      scheme: "basic";
      /** Account field holding the user name (`email`). */
      user: string;
    }
  | { scheme: "bearer" }
  | {
      /** The secret is sent as this header's value. */
      scheme: "header";
      name: string;
    };

export type AccountInfo = {
  id: string;
  name: string;
  kind: string;
  fields: Record<string, unknown>;
};

/**
 * What a kind's `test` hook reports. A failure says why when it can:
 * `rejected` (credentials refused, the default), `restricted` (authenticated
 * without access), `unavailable` (the service is not provided) or
 * `unreachable` (network or server failure; the credentials could not be judged).
 * A `test` hook throws `ExtensionError("BAD_REQUEST")` when the account lacks
 * what the test needs (a site URL).
 */
export type AccountTestResult =
  | { ok: true; message?: string }
  | {
      ok: false;
      message: string;
      fix?: string;
      reason?: "rejected" | "restricted" | "unavailable" | "unreachable";
    };

/** The serializable part of an account kind; contracts validate it. */
export type AccountKindData = {
  label: string;
  /** Non-secret fields stored with the account. */
  fields: Record<string, SettingField>;
  secret: { label: string; help?: string };
  auth?: AccountAuth;
  /**
   * Origins the credential is sent to: URL origins, with `{<field>}`
   * templates filled from the account's fields (`{site}`).
   */
  origins?: string[];
};

export type AccountKind = AccountKindData & {
  /** Settings "Test" button. */
  test?: (
    account: AccountInfo,
    ctx: ExtensionContext,
  ) => Promise<AccountTestResult>;
};

// ── Context ──────────────────────────────────────────────────────────────────

export type ArtifactRef = {
  /** `artifact:<name>` */
  handle: string;
  name: string;
  bytes: number;
  mediaType: string;
};

export type ArtifactInfo = ArtifactRef & { width?: number; height?: number };

/** A multipart form field: a text value or a file (bytes or an artifact/workspace handle). */
export type FormPart =
  | { name: string; value: string }
  | {
      name: string;
      filename: string;
      mediaType?: string;
      data: Uint8Array | { handle: string };
    };

export type HttpRequest = {
  /** Must match `permissions.network`. */
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?:
    | string
    | Uint8Array
    | { json: unknown }
    | { form: readonly FormPart[] };
  /** Account whose credential the host injects (per the kind's `auth`, only for the kind's `origins`). */
  auth?: { account: string };
  timeoutMs?: number;
  /** Largest accepted response body; the host's limit applies when absent or larger. */
  maxBytes?: number;
  /**
   * How the body is returned; `json` by default for JSON content, else `text`.
   * `{ artifact }` streams a successful response to that artifact (up to 100 MB).
   * `{ artifactFor }` decides from the response's content type: a name streams
   * it to that artifact, `undefined` returns the body as `text`.
   */
  response?:
    | "json"
    | "text"
    | "bytes"
    | { artifact: string }
    | {
        artifactFor(
          contentType: string,
        ): string | undefined | Promise<string | undefined>;
      };
};

export type HttpResponse = {
  status: number;
  /** 2xx. */
  ok: boolean;
  /** Lower-cased names. */
  headers: Record<string, string>;
  /** Final URL after redirects. */
  url: string;
  /** Parsed JSON (undefined when empty), text, bytes, or the artifact written. */
  body: unknown;
};

export type ReportEntry = string;

/** Image generation backends the host can run; a member of the Image generation extension's `backend` setting. */
export type ImagegenBackend = "openai-codex";

/** Image generation the host provides when the manifest declares `models.image`: every option is final (call overrides applied). */
export type ImageOptions = {
  backend: ImagegenBackend;
  model: string;
  quality: string;
  size: string;
  background: string;
};
/** What the host's backend adapter executes. */
export type ImageBackendRequest = ImageOptions;

export type ImageRequest = {
  prompt: string;
  /** Reference images; only backends that accept them get any. */
  inputs: readonly { data: Uint8Array; mimeType: string }[];
  options: ImageOptions;
};

export type ImageResult = {
  provider: string;
  model: string;
  images: readonly { data: Uint8Array; revisedPrompt?: string }[];
};

/** `ImageRequest` as the host's backend adapters receive it (the run's abort signal added). */
export type ImageGenerateRequest = ImageRequest & { signal?: AbortSignal };
export type ImageGenerateResponse = ImageResult;

export interface ExtensionContext {
  /** Resolved values of this extension's own settings (user → project → conversation). */
  settings: { get<T = unknown>(key: string): T | undefined };

  accounts: {
    /** The account an `account` setting points at; undefined when unset or deleted. */
    selected(field: string): Promise<AccountInfo | undefined>;
  };

  http: { request(request: HttpRequest): Promise<HttpResponse> };

  artifacts: {
    write(
      name: string,
      data: Uint8Array | string,
      mediaType?: string,
    ): Promise<ArtifactRef>;
    /** An artifact handle, or a workspace path the call was authorized to read. */
    read(
      handle: string,
    ): Promise<{ bytes: Uint8Array; mediaType: string; name: string }>;
    info(handle: string): Promise<ArtifactInfo>;
    /** An artifact name not yet used in this conversation: `<base>-<n><extension>` (`diagram-1.png`). */
    freshName(base: string, extension: string): Promise<string>;
  };

  /** Text utilities the host runs with its own limits (time, input and output size). */
  text: {
    /** Plain HTML to Markdown (a web page); not for Confluence storage format. */
    htmlToMarkdown(html: string): Promise<string>;
  };

  /**
   * Checks an operation whose targets are known only after a lookup (the page
   * a comment belongs to) against the conversation's permission policy, before
   * the first write. Rejects with `DENIED` when the policy refuses. Everything
   * known from the arguments belongs in the method's `authorize` instead.
   */
  authorize(check: {
    operation: string;
    targets: readonly string[];
    risk: Risk;
  }): Promise<void>;

  /** Listed in the run footer. Use one label per entity across created/updated/deleted. */
  report: {
    created(entry: ReportEntry): void;
    updated(entry: ReportEntry): void;
    deleted(entry: ReportEntry): void;
    note(text: string): void;
  };

  /** Only capabilities the manifest declares. */
  models: {
    image?: { generate(request: ImageRequest): Promise<ImageResult> };
  };

  signal: AbortSignal;

  log: {
    debug(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
  };
}

// ── Artifact names ───────────────────────────────────────────────────────────

/** Artifact names: 1–128 letters, digits, spaces, `.`, `_` or `-`; no folders, no leading dot or space, no trailing space. */
export function isArtifactName(name: string): boolean {
  return (
    /^[\p{L}\p{N}_][\p{L}\p{N} ._-]{0,127}$/u.test(name) && !name.endsWith(" ")
  );
}

// ── Errors ───────────────────────────────────────────────────────────────────

/** What a script sees as `e.code`. */
export const EXTENSION_ERROR_CODES = [
  "BAD_REQUEST",
  "NOT_FOUND",
  "CONFLICT",
  "FORBIDDEN",
  "DENIED",
  "RATE_LIMITED",
  "UNAUTHORIZED",
  "SERVER_ERROR",
] as const;
export type ExtensionErrorCode = (typeof EXTENSION_ERROR_CODES)[number];

/**
 * A failure the agent can act on. `fix` says what the user must do ("Ask the
 * user to …"); the host appends it to the message.
 */
export class ExtensionError extends Error {
  readonly code: ExtensionErrorCode;
  readonly fix?: string;

  constructor(
    code: ExtensionErrorCode,
    message: string,
    options: { fix?: string; cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ExtensionError";
    this.code = code;
    if (options.fix !== undefined) this.fix = options.fix;
  }
}

// ── Methods, namespaces, tools ───────────────────────────────────────────────

export type MethodDefinition<
  Session = unknown,
  Input = unknown,
  Output = unknown,
> = {
  risk: Risk;
  /** TypeScript method declaration, optionally led by a one-line JSDoc comment; generates what `sdk.describe` serves. */
  signature: string;
  /** Validates the script's positional arguments; throws on bad input. Synchronous and pure. */
  parse(args: readonly unknown[]): Input;
  /** What the call is authorized as. Synchronous and pure, so it runs before any I/O. */
  authorize?(input: Input): AuthorizeResult;
  /** What a 403 refers to, e.g. `project APP`; defaults to the authorization summary. */
  resource?(input: Input): string;
  run(
    session: Session,
    input: Input,
    ctx: ExtensionContext,
  ): Promise<Output> | Output;
};

/** The reason an optional `availability` hook gives when a namespace or tool cannot be used. */
export type Availability =
  | { available: true }
  | {
      available: false;
      reason: string;
      /** What the user must do ("Ask the user to …"). */
      fix: string;
    };

export type DocTopic = {
  /** Full topic id (`jira/workflows`). */
  id: string;
  whenToRead: string;
  /** Relative to the extension's docs folder. */
  file: string;
};

export type Requires = {
  /** Name of an `account` setting that must point at an existing account with a saved secret. */
  account?: string;
};

export type NamespaceDefinition<Session = unknown> = {
  /** Global name in the sandbox: `jira`. */
  id: string;
  /** Boolean setting of the extension that switches this namespace, or several (any one enables it). Absent: it follows the extension. */
  enabledBy?: string | readonly string[];
  requires?: Requires;
  /** Marks sandbox-side helper namespaces (no account, no host methods). */
  helper?: boolean;
  /** One line in the `quick_script` description. */
  summary: string;
  /** At most three short lines, added to the description whenever the namespace is configured. */
  rules?: readonly string[];
  /** Shared declarations for `sdk.describe`: the shapes methods return. */
  types: string;
  docs?: readonly DocTopic[];
  /** Once per quick_script run, on first use; holds clients and caches. */
  session?: (ctx: ExtensionContext) => Promise<Session> | Session;
  methods: Readonly<Record<string, MethodDefinition<Session, any, any>>>;
  /** One line `sdk.describe` prints above the declarations: how the namespace is configured now. */
  configuration?: (ctx: ExtensionContext) => string | undefined;
  /** Extra checks the declarations cannot express. */
  availability?: (
    ctx: ExtensionContext,
  ) => Promise<Availability> | Availability;
};

/** How the transcript renders a direct tool's result; the app has one renderer per kind. */
export type DisplayKind = "text" | "markdown" | "links" | "table" | "artifact";
export const DISPLAY_KINDS: readonly DisplayKind[] = [
  "text",
  "markdown",
  "links",
  "table",
  "artifact",
];

/** JSON Schema object for a tool's arguments, as the model sees it. */
export type JsonSchemaObject = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: readonly string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
};

type ToolBase = {
  /** Unique across core and extension tools. */
  name: string;
  /** Shown on the Tools page; defaults to the name. */
  label?: string;
  /** Agent-facing description. */
  description: string;
  parameters: JsonSchemaObject;
  display: DisplayKind;
  /** Boolean setting of the extension that switches this tool, in addition to the extension. */
  enabledBy?: string;
  requires?: Requires;
  availability?: (
    ctx: ExtensionContext,
  ) => Promise<Availability> | Availability;
};

/** A tool bound to a namespace method (`web.search`): same parse → authorize → run. */
export type MethodToolDefinition = ToolBase & { method: string };

/** A tool with its own implementation. */
export type OwnToolDefinition<Input = any, Output = unknown> = ToolBase & {
  risk: Risk;
  parse(args: Record<string, unknown>): Input;
  authorize?(input: Input): AuthorizeResult;
  run(input: Input, ctx: ExtensionContext): Promise<Output> | Output;
  /**
   * Splits the output into what the agent reads (`text`) and what the
   * transcript renders (`value`, per `display`). Without it, both are the output.
   */
  present?(output: Output): { text: string; value?: unknown };
};

export type ToolDefinition = MethodToolDefinition | OwnToolDefinition;

export function isMethodTool(
  tool: ToolDefinition,
): tool is MethodToolDefinition {
  return "method" in tool;
}

export type Capability = "models.image";

export type ExtensionPermissions = {
  /**
   * Origins `ctx.http` may reach: URL origins with `*` for one host label
   * (`https://*.atlassian.net`), `{account.<field>}` templates for the
   * selected account's fields and `{settings.<key>}` for a setting of the
   * extension. The entry `*` alone means any public `http(s)` origin (the host's
   * SSRF guard still applies). Absent: no network.
   */
  network?: string[];
  capabilities?: Capability[];
};

export type ExtensionDefinition = {
  /** Stable, kebab-case; settings, accounts and operations are keyed by it. */
  id: string;
  apiVersion: 1;
  name: string;
  /** One line for the Extensions page. */
  description: string;
  /** Lucide icon name. */
  icon: string;
  /** Default of the implicit `enabled` switch. */
  enabledByDefault: boolean;
  settings: ExtensionSettings;
  /** Account kinds this extension defines, by kind. Kinds are unique across extensions. */
  accounts?: Readonly<Record<string, AccountKind>>;
  permissions?: ExtensionPermissions;
  namespaces: readonly NamespaceDefinition<any>[];
  /** Direct tools. */
  tools?: readonly ToolDefinition[];
  /** Pure sandbox-side helper source (storage builders), evaluated after the SDK prelude; no host access. */
  prelude?: string;
  /** Byte limits, filled into `{{limit:<name>}}` placeholders of docs and rules. */
  limits?: Readonly<Record<string, number>>;
};
