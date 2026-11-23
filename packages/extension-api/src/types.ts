/*
 * The `ExtensionContext` (`ctx`) the host hands to extension code, and the data its services
 * exchange (HTTP, artifacts, models).
 *
 * `ctx` calls exchange plain data (JSON values, `Uint8Array`, handles), so extension code can run
 * in a sandbox. Calls that reach the host return promises; `settings.get`, `report`, `progress`
 * and `log` are synchronous. An extension never sees a secret: the host injects credentials into
 * `ctx.http` requests.
 */

import type { OperationCheck } from "./authorization.js";
import type { AccountInfo } from "./settings.js";

// ── Context ──────────────────────────────────────────────────────────────────

/** A file of the conversation, kept by the host. Pass the `handle` on instead of the bytes. */
export type ArtifactRef = {
  /** `artifact:<name>`; accepted wherever a file is (`ctx.artifacts.read`, `FormPart.data`). */
  handle: string;
  /** Artifact name; see `isArtifactName`. */
  name: string;
  /** Size in bytes. */
  bytes: number;
  /** MIME type (`image/png`). */
  mediaType: string;
};

/** `ArtifactRef` plus image dimensions. */
export type ArtifactInfo = ArtifactRef & {
  /** Pixels; set for images. */
  width?: number;
  /** Pixels; set for images. */
  height?: number;
};

/** A multipart form field: a text value or a file (bytes or an artifact/workspace handle). */
export type FormPart =
  | {
      /** Form field name. */
      name: string;
      /** Text value. */
      value: string;
    }
  | {
      /** Form field name. */
      name: string;
      /** File name sent to the server. */
      filename: string;
      /** MIME type of the file. Absent: the host's default. */
      mediaType?: string;
      /** The bytes, or a handle (`artifact:<name>` or a workspace path the call was authorized to read) the host streams without loading it into the sandbox. */
      data:
        | Uint8Array
        | {
            /** `artifact:<name>` or a workspace path the call was authorized to read. */
            handle: string;
          };
    };

/**
 * One `ctx.http.request`. The host allows only origins listed in `permissions.network`
 * (else `DENIED`), blocks private and local addresses unless the origin was filled from a
 * `{settings.<key>}` or `{account.<field>}` template (the user's own server), follows at most 5 redirects (each hop is checked again; `303` and
 * a `POST` answered with `301`/`302` become a body-less `GET`) and sends `User-Agent: nerve/1.0`.
 * A non-2xx status is returned, not thrown (check `HttpResponse.ok`), except `401`/`403`
 * from an origin that got the account's credential: `UNAUTHORIZED` / `FORBIDDEN`.
 * Other errors: `BAD_REQUEST` (invalid URL; `auth` names no account setting or no account is
 * selected or it has no saved credential; more than 5 redirects; body over the size limit),
 * `DENIED` (origin not allowed; credential not allowed for the origin), `SERVER_ERROR`
 * (`response: "json"` and the body is not JSON).
 */
export type HttpRequest = {
  /** Absolute URL; its origin must match `permissions.network`. */
  url: string;
  /** HTTP method, case-insensitive. Default `GET`. `GET` and `HEAD` send no body. */
  method?: string;
  /** Request headers. The host sets `content-type` for `json` and `form` bodies when absent, and replaces the credential header when `auth` is set. */
  headers?: Record<string, string>;
  /** `string` and `Uint8Array` are sent as given; `{ json }` is serialized with `application/json`; `{ form }` is `multipart/form-data`. */
  body?:
    | string
    | Uint8Array
    | {
        /** Any JSON value; sent with `content-type: application/json`. */
        json: unknown;
      }
    | {
        /** Parts of a `multipart/form-data` body. */
        form: readonly FormPart[];
      };
  /**
   * Key of an `account` setting of this extension. The host injects the selected account's
   * credential as its kind's `auth` says, only toward the kind's `origins`; a request to any
   * other origin fails with `DENIED`. The secret never reaches the extension.
   */
  auth?: {
    /** Key of the `account` setting that selects the account. */
    account: string;
  };
  /** Time limit for the whole request, in milliseconds. Default 60000, clamped to 1–300000. */
  timeoutMs?: number;
  /**
   * Largest accepted response body in bytes. Defaults to and is capped at 20 MiB in memory
   * and 100 MiB with `response: "artifact"`; a larger body fails with `BAD_REQUEST`.
   */
  maxBytes?: number;
  /**
   * How the body is returned in `HttpResponse.body`. Default: `json` when the response's
   * content type contains `json`, else `text`. `json` parses (an empty body gives `undefined`),
   * `text` decodes UTF-8, `bytes` returns a `Uint8Array` (bytes cross the sandbox as base64,
   * so prefer `artifact` for large files). `"artifact"` streams a successful response to an
   * artifact and returns its `ArtifactRef` as `body`; an error status leaves `body` `undefined`.
   */
  response?: "json" | "text" | "bytes" | "artifact";
  /** Naming of the artifact for `response: "artifact"`. */
  artifact?: HttpArtifactOptions;
};

/** Plain data: the host names the artifact, nothing is decided by a callback. */
export type HttpArtifactOptions = {
  /** The exact artifact name (see `isArtifactName`). Without it the host picks a fresh `<baseName>-<n><extension>`. */
  name?: string;
  /** Start of a host-picked name; `download` by default. */
  baseName?: string;
  /** Extension of a host-picked name (with the dot); by default the host derives it from the response's content type (`.bin` when unknown). */
  extension?: string;
  /** A textual response (JSON, text, XML, JavaScript, form data) or an error response is returned as `text` instead of an artifact. */
  inlineText?: boolean;
};

/** The type of `HttpResponse.body` for a `HttpRequest.response` mode: an `ArtifactRef` (absent on an error status), bytes, text, or `unknown` for JSON and the default. */
export type HttpBody<Mode> = Mode extends "artifact"
  ? ArtifactRef | undefined
  : Mode extends "bytes"
    ? Uint8Array
    : Mode extends "text"
      ? string
      : unknown;

/** What `ctx.http.request` returns. `Body` follows `HttpRequest.response` (see `ExtensionContext.http`). */
export type HttpResponse<Body = unknown> = {
  /** HTTP status code. */
  status: number;
  /** `true` for 2xx. */
  ok: boolean;
  /** Response headers, names lower-cased. */
  headers: Record<string, string>;
  /** Final URL after redirects. */
  url: string;
  /** Parsed JSON (undefined when empty), text, bytes, or the artifact written; see `HttpRequest.response`. */
  body: Body;
};

// ── Models ───────────────────────────────────────────────────────────────────

/** A reasoning level of a `model` selection; `off` disables reasoning. */
export type ReasoningLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

/**
 * A chat model: the value of a `model` setting (`ctx.settings.get(<key>)`) or
 * `ctx.models.defaultModel()`. The host accepts only these two sources, so an
 * extension cannot use a model the user did not choose.
 */
export type ModelSelection = {
  /** Provider id (`anthropic`). */
  provider: string;
  /** Model id on that provider. */
  modelId: string;
  /** Reasoning level; absent: the model's default. */
  reasoningLevel?: ReasoningLevel;
};

/** An image generation model: the value of an `imageModel` setting. The host accepts no other value. */
export type ImageModelSelection = {
  /** Image backend id (`openai-codex`). */
  provider: string;
  /** Model id on that backend. */
  modelId: string;
};

/** Live sections of the running direct tool the model's thinking and text stream into (`ToolView` section ids with `live`). */
export type ModelProgress = {
  /** Section id that receives the model's reasoning. */
  thinking?: string;
  /** Section id that receives the answer as it is written. */
  text?: string;
};

/**
 * One `ctx.models.image.generate` call. The host validates the options against the
 * selected backend (`BAD_REQUEST` names the valid values) and writes each image as an artifact.
 */
export type ImageRequest = {
  /** The value of one of this extension's `imageModel` settings. */
  model: ImageModelSelection;
  /** What to draw. */
  prompt: string;
  /** Reference images: `artifact:<name>` or workspace paths the call was authorized to read. A backend that takes none rejects them. */
  inputs?: readonly string[];
  /** `auto` or `<width>x<height>`; the backend sets the valid sizes. Absent: `auto`. */
  size?: string;
  /** Quality level the backend accepts. Absent: `auto`. */
  quality?: string;
  /** `auto`, `opaque` or `transparent`, as the backend supports. Absent: `auto`. */
  background?: string;
  /** Naming of the artifacts written. */
  artifact?: {
    /** Exact name of the first image; its extension is corrected to the image's type. */
    name?: string;
    /** Start of a host-picked name `<baseName>-<n><ext>`; `image` by default. */
    baseName?: string;
  };
};

/** What `ctx.models.image.generate` returns. */
export type ImageResult = {
  /** Model that produced the images (`provider/modelId`). */
  model: string;
  /** The images in order, written as artifacts. */
  images: readonly {
    /** The artifact the image was written to. */
    artifact: ArtifactRef;
    /** The prompt as the model rewrote it, when it reports one. */
    revisedPrompt?: string;
  }[];
};

/** One `ctx.models.vision.explain` call. */
export type VisionRequest = {
  /** The value of one of this extension's `model` settings, or `ctx.models.defaultModel()`. */
  model: ModelSelection;
  /** `artifact:<name>` or a workspace path the call was authorized to read: JPEG, PNG, GIF or WebP up to 20 MiB, detected from the bytes. */
  image: string;
  /** What to focus on. */
  prompt?: string;
  /** Live sections the thinking and answer stream into. */
  progress?: ModelProgress;
};

/** What `ctx.models.vision.explain` returns. */
export type VisionResult = {
  /** The explanation. */
  text: string;
  /** Model that wrote it (`provider/modelId`). */
  model: string;
};

/** A direct model call without tools or an agent loop (`ctx.models.text`). */
export type TextRequest = {
  /** The value of one of this extension's `model` settings, or `ctx.models.defaultModel()`. */
  model: ModelSelection;
  /** Instructions for the model. */
  system?: string;
  /** The user message. */
  prompt: string;
  /** Upper bound on the answer's length in tokens. */
  maxTokens?: number;
  /** Live sections the thinking and answer stream into. */
  progress?: ModelProgress;
};

/** What `ctx.models.text.complete` returns. */
export type TextResult = {
  /** The model's answer. */
  text: string;
  /** Model that wrote it (`provider/modelId`). */
  model: string;
};

/**
 * Model services; each exists only when the definition's `permissions.models` lists it.
 * The host never picks a model: every call names one, and it must be the value of one of this
 * extension's settings (or `defaultModel()` for text and vision), else `DENIED`. Use `ready` in
 * `availability`; in `run`, throw `ExtensionError("DENIED", …, { fix })` when the setting is unset.
 */
export type ExtensionModels = {
  /** Image generation (`permissions.models: ["image"]`). */
  image?: {
    /** Generates images and writes them as artifacts; rejects when the backend fails or is not signed in. */
    generate(request: ImageRequest): Promise<ImageResult>;
    /** Whether `model` is set, known and signed in. */
    ready(request?: { model?: ImageModelSelection }): Promise<boolean>;
  };
  /** Image explanation (`permissions.models: ["vision"]`). */
  vision?: {
    /** Explains an image; streams into the sections `request.progress` names. */
    explain(request: VisionRequest): Promise<VisionResult>;
    /** Whether `model` is set, resolves with credentials and accepts images. */
    ready(request?: { model?: ModelSelection }): Promise<boolean>;
  };
  /** Direct text completion (`permissions.models: ["text"]`): no tools, no agent loop. */
  text?: {
    /** Asks the model once; streams into the sections `request.progress` names. */
    complete(request: TextRequest): Promise<TextResult>;
    /** Whether `model` is set and resolves with credentials. */
    ready(request?: { model?: ModelSelection }): Promise<boolean>;
  };
  /** Nerve's default model and reasoning level for the project, for an extension without its own `model` setting. Exists with `"text"` or `"vision"` in `permissions.models`. */
  defaultModel?(): Promise<ModelSelection>;
};

/**
 * The host services of extension code, passed to `session` and `run` as `ctx`. Calls that reach the
 * host return promises (`settings.get`, `report`, `progress` and `log` are synchronous), and all
 * of them exchange plain data, because the
 * backend of an installed extension runs in a sandbox (QuickJS) with no Node.js built-ins,
 * filesystem, network or timers. Take `ctx` from the hook's own arguments every time: a `ctx`
 * kept in a `session` belongs to the call that opened it and is not valid later. Cancellation is
 * the host's: it stops the call; there is no signal to watch.
 */
export interface ExtensionContext {
  /** Resolved values of this extension's own settings (manifest default → user → project → conversation). */
  settings: {
    /** The resolved value of the field `key`; `undefined` when the field has no default and no scope sets it. Cast with `T`. Synchronous: the values are resolved before the call. */
    get<T = unknown>(key: string): T | undefined;
  };

  /** Accounts the user added in Settings. The secret is never returned. */
  accounts: {
    /** The account an `account` setting points at; undefined when unset or deleted. */
    selected(field: string): Promise<AccountInfo | undefined>;
  };

  /** The only network access. */
  http: {
    /** Sends a request; see `HttpRequest` for limits and errors. Rejects with an `ExtensionError`. `body` is typed by `response` (`HttpBody`). */
    request<Request extends HttpRequest>(
      request: Request,
    ): Promise<HttpResponse<HttpBody<Request["response"]>>>;
  };

  /** Files of the conversation (`artifact:<name>`). Pass handles on instead of bytes: bytes cross the sandbox boundary as base64. */
  artifacts: {
    /** Stores a file under `name` (see `isArtifactName`) and returns its reference. `mediaType` defaults to `application/octet-stream`. A string is stored as UTF-8. */
    write(
      name: string,
      data: Uint8Array | string,
      mediaType?: string,
    ): Promise<ArtifactRef>;
    /** Reads an artifact handle, or a workspace path the call was authorized to read (`authorize` returning a `read` `ToolAuthorization`). */
    read(handle: string): Promise<{
      /** Content. */
      bytes: Uint8Array;
      /** MIME type. */
      mediaType: string;
      /** File name. */
      name: string;
    }>;
    /** Size, type and (for images) dimensions of an artifact, without its bytes. */
    info(handle: string): Promise<ArtifactInfo>;
    /** An artifact name not yet used in this conversation: `<base>-<n><extension>` (`diagram-1.png`). `extension` includes the dot. */
    freshName(base: string, extension: string): Promise<string>;
  };

  /**
   * Durable JSON storage for this extension in the open project, shared with its UI frames
   * (`host.store`) and across conversations. One key holds one JSON value; every key has
   * a `revision` (1 on the first write, +1 on each write) for conflict detection. Limits: keys of
   * 1–128 letters, digits, `.`, `_`, `-` (no leading dot); 4 MiB per value; 1,000 keys and 64 MiB
   * per project. Not artifacts: artifacts are conversation files for tool results. Rejects with
   * `BAD_REQUEST` (bad key, value too large, over a limit, or no project is open) and `CONFLICT`
   * (a stale `ifRevision`). Open frames of the extension are told about each write. The host keeps
   * the data when the extension is uninstalled and never migrates it: keep a `schemaVersion` in
   * your values.
   */
  store: {
    /** The value and revision of `key`; `undefined` when it does not exist. */
    get(key: string): Promise<
      | {
          /** The stored JSON value. */
          value: unknown;
          /** Revision of the stored value; pass it as `ifRevision` to write only if nothing changed. */
          revision: number;
        }
      | undefined
    >;
    /**
     * Writes `value` (JSON-serializable) and returns the new revision. With `ifRevision`, writes
     * only when the stored revision equals it (`0`: only when the key does not exist); otherwise
     * rejects with `CONFLICT`.
     */
    set(
      key: string,
      value: unknown,
      options?: { ifRevision?: number },
    ): Promise<{
      /** The key's revision after this write. */
      revision: number;
    }>;
    /** Deletes `key`; deleting a missing key succeeds. With `ifRevision`, rejects with `CONFLICT` unless the stored revision equals it. */
    delete(key: string, options?: { ifRevision?: number }): Promise<void>;
    /** Keys starting with `prefix` (all when omitted), sorted, with each key's revision and serialized size in bytes. */
    keys(options?: { prefix?: string }): Promise<
      {
        /** The key. */
        key: string;
        /** Current revision. */
        revision: number;
        /** Serialized size of the value, in bytes. */
        size: number;
      }[]
    >;
  };

  /** Text utilities the host runs with its own limits (time, input and output size). */
  text: {
    /** Plain HTML to Markdown (a web page); not for Confluence storage format. */
    htmlToMarkdown(html: string): Promise<string>;
  };

  /**
   * Checks an operation whose targets are known only after a lookup (the page
   * a comment belongs to) against the conversation's permission policy, before
   * the first write. `operation` defaults to the running method's, `risk` to its
   * declared risk and may not exceed it (`BAD_REQUEST`). Rejects with `DENIED`
   * when the policy refuses. Everything known from the arguments belongs in the
   * method's `authorize` instead.
   */
  authorize(check: OperationCheck): Promise<void>;

  /**
   * Entities the run changed, listed in the run footer: a name or key such as `PROJ-12`. Use one
   * label per entity across created/updated/deleted so the footer can merge them.
   */
  report: {
    /** The run created `entry`. */
    created(entry: string): void;
    /** The run changed `entry`. */
    updated(entry: string): void;
    /** The run deleted `entry`. */
    deleted(entry: string): void;
    /** A free-text line for the footer. */
    note(text: string): void;
  };

  /** Model services; see `ExtensionModels`. */
  models: ExtensionModels;

  /**
   * Streams text into a `live` section of the running direct tool's card
   * (`ToolView`). Ignored outside a direct tool call and for other sections.
   */
  progress(section: string, chunk: string): void;

  /** Writes to the host log (not shown to the agent). Never log secrets. */
  log: {
    /** Diagnostic detail. `data` is any JSON-serializable value. */
    debug(message: string, data?: unknown): void;
    /** Something unexpected that did not fail the call. */
    warn(message: string, data?: unknown): void;
  };
}

/**
 * `ctx` of `availability` and `configuration`: they decide what is offered and run often, so
 * they read settings and accounts and may ask whether a model is ready, nothing more.
 */
export type ExtensionHookContext = Pick<
  ExtensionContext,
  "settings" | "accounts" | "log"
> & {
  /** `ready` and `defaultModel` of the declared model services. */
  models: {
    /** `ready` of image generation (`permissions.models: ["image"]`). */
    image?: Pick<NonNullable<ExtensionModels["image"]>, "ready">;
    /** `ready` of image explanation (`permissions.models: ["vision"]`). */
    vision?: Pick<NonNullable<ExtensionModels["vision"]>, "ready">;
    /** `ready` of text completion (`models.text`). */
    text?: Pick<NonNullable<ExtensionModels["text"]>, "ready">;
    /** Nerve's default model for the project; see `ExtensionModels.defaultModel`. */
    defaultModel?: ExtensionModels["defaultModel"];
  };
};

/**
 * `ctx` of an account kind's `test` hook: outside any conversation, so no settings, artifacts,
 * store, models or report. `accounts.selected` and `ctx.http` `auth` resolve to the tested account.
 */
export type AccountTestContext = Pick<
  ExtensionContext,
  "accounts" | "http" | "log"
>;
