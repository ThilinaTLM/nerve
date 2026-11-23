import {
  constants,
  createHash,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
} from "node:crypto";
import type {
  CredentialAccount,
  CredentialApplyContext,
  CredentialCrypto,
  CredentialHttpRequest,
  CredentialHttpResponse,
  CredentialRefreshContext,
  CredentialRequest,
  CredentialRevokeContext,
  CredentialSignInContext,
  CredentialUi,
} from "./credentials.js";
import type {
  ArtifactInfo,
  ArtifactRef,
  ExtensionContext,
  HttpRequest,
  HttpResponse,
  ImageModelSelection,
  ImageRequest,
  ModelSelection,
  VisionRequest,
  VisionResult,
  TextRequest,
  TextResult,
} from "./types.js";
import { ExtensionError } from "./errors.js";
import type { OperationCheck } from "./authorization.js";
import type { AccountInfo } from "./settings.js";

/** What a fake `ctx` recorded, for assertions. */
export type FakeContextRecord = {
  /** Every `ctx.http.request` the code made, as given. */
  requests: HttpRequest[];
  /** Checks made through `ctx.authorize`, as passed (the fake applies no defaults). */
  authorized: OperationCheck[];
  /** Entries of `ctx.report.created`. */
  created: string[];
  /** Entries of `ctx.report.updated`. */
  updated: string[];
  /** Entries of `ctx.report.deleted`. */
  deleted: string[];
  /** Texts of `ctx.report.note`. */
  notes: string[];
  /** `ctx.log.debug` and `ctx.log.warn` calls, in order. */
  logs: {
    /** `debug` for `ctx.log.debug`, `warn` for `ctx.log.warn`. */
    level: "debug" | "warn";
    /** The message as passed. */
    message: string;
    /** The `data` argument, when given. */
    data?: unknown;
  }[];
  /** `ctx.progress` chunks, in order. */
  progress: {
    /** Section id as passed. */
    section: string;
    /** Text chunk as passed. */
    chunk: string;
  }[];
  /** `ctx.store` content by key, with revisions as the real store keeps them. */
  store: Map<
    string,
    {
      /** The JSON value (a deep copy). */
      value: unknown;
      /** 1 on the first write, +1 on every write. */
      revision: number;
    }
  >;
  /** Artifacts written or seeded, by handle (`artifact:<name>`); seed one by adding an entry before the run. */
  artifacts: Map<
    string,
    {
      /** Content. */
      bytes: Uint8Array;
      /** MIME type; `application/octet-stream` when `write` gave none. */
      mediaType: string;
      /** Artifact name (the handle without `artifact:`). */
      name: string;
    }
  >;
};

/** What a fake `ctx` is configured with. Everything is optional; unset services fail or stay empty as each member says. */
export type FakeContextOptions = {
  /** Values `ctx.settings.get` returns, by field key. No manifest defaults are applied: list every value the code reads. */
  settings?: Record<string, unknown>;
  /** Selected accounts by `account` setting name. */
  accounts?: Record<string, AccountInfo>;
  /** Decides `ctx.authorize` checks; throw to refuse. Absent: every check passes. */
  authorize?: (
    check: FakeContextRecord["authorized"][number],
  ) => void | Promise<void>;
  /**
   * Answers `ctx.http.request`; throws when a test makes a request it did not expect.
   * For `response: "artifact"` the fake does not stream: return the artifact reference as `body`.
   */
  http?: (request: HttpRequest) => HttpResponse | Promise<HttpResponse>;
  /**
   * Present: `ctx.models.image` exists. `generate` returns the image bytes; the fake writes them
   * to `record.artifacts` (named like the host: `artifact.name`, else `<baseName or image>-<n><ext>`)
   * and returns their references. Input handles are passed as given.
   */
  image?: {
    /** Answers `ctx.models.image.generate`. */
    generate: (
      request: ImageRequest,
    ) => FakeImageOutput | Promise<FakeImageOutput>;
    /** Answer of `ctx.models.image.ready()`; default `true`. */
    ready?: boolean;
  };
  /**
   * Present: `ctx.models.vision` exists. `request.image` is the handle as passed; read seeded
   * bytes from `record.artifacts` when the answer depends on them.
   */
  vision?: {
    /** Answers `ctx.models.vision.explain`; call `progress(section, chunk)` to stream into live sections (recorded in `record.progress`). */
    explain: (
      request: VisionRequest,
      progress: (section: string, chunk: string) => void,
    ) => VisionResult | Promise<VisionResult>;
    /** Answer of `ctx.models.vision.ready()`; default `true`. */
    ready?: boolean;
  };
  /** Present: `ctx.models.text` exists. */
  text?: {
    /** Answers `ctx.models.text.complete`; call `progress(section, chunk)` to stream into live sections. */
    complete: (
      request: TextRequest,
      progress: (section: string, chunk: string) => void,
    ) => TextResult | Promise<TextResult>;
    /** Answer of `ctx.models.text.ready()`; default `true`. */
    ready?: boolean;
  };
  /** What `ctx.models.defaultModel()` returns (present with `vision` or `text`); default `{ provider: "test", modelId: "default" }`. */
  defaultModel?: ModelSelection;
  /** Answers `ctx.text.htmlToMarkdown`; throws when a test uses it without one. */
  htmlToMarkdown?: (html: string) => string | Promise<string>;
  /** Seeds `ctx.store`: values by key, each at revision 1. Read the result in `record.store`. */
  store?: Record<string, unknown>;
};

/** What a fake image backend returns: the images' bytes. */
export type FakeImageOutput = {
  /** Model that produced them; default `provider/modelId` of the request. */
  model?: string;
  /** The images in order. */
  images: {
    /** Image bytes. */
    bytes: Uint8Array;
    /** MIME type (`image/png`); decides the artifact's extension. */
    mediaType: string;
    /** The rewritten prompt, when the test wants one. */
    revisedPrompt?: string;
  }[];
};

const imageExtensions: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const encoder = new TextEncoder();
const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const storeKeyPattern = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;

/**
 * A `ctx` that keeps everything in memory; extension unit tests use it instead of the host.
 * Returns `ctx` and a `record` of what the code did. It does not enforce `permissions.network`,
 * redirects, size limits, credential injection or that a model is one of the extension's
 * settings: only the answers you configure. Call a
 * method as `method.run(session, method.parse(args), ctx)` and check `method.authorize(input)` directly.
 */
export function createFakeContext(options: FakeContextOptions = {}): {
  /** The fake `ctx` to pass to `parse`/`run`/hooks. */
  ctx: ExtensionContext;
  /** What the code did with it. */
  record: FakeContextRecord;
} {
  const record: FakeContextRecord = {
    requests: [],
    authorized: [],
    created: [],
    updated: [],
    deleted: [],
    notes: [],
    logs: [],
    progress: [],
    store: new Map(
      Object.entries(options.store ?? {}).map(([key, value]) => [
        key,
        { value: clone(value), revision: 1 },
      ]),
    ),
    artifacts: new Map(),
  };
  const progress = (section: string, chunk: string) =>
    void record.progress.push({ section, chunk });
  const ref = (name: string): ArtifactRef => {
    const stored = record.artifacts.get(`artifact:${name}`)!;
    return {
      handle: `artifact:${name}`,
      name,
      bytes: stored.bytes.byteLength,
      mediaType: stored.mediaType,
    };
  };
  const lookup = (handle: string) => {
    const stored = record.artifacts.get(handle);
    if (!stored) throw new Error(`No artifact ${handle}.`);
    return stored;
  };
  const checkedKey = (key: string) => {
    if (!storeKeyPattern.test(key))
      throw new ExtensionError(
        "BAD_REQUEST",
        `Invalid store key '${key}': use 1-128 letters, digits, '.', '_' or '-', not starting with '.'.`,
      );
    return key;
  };
  const checkRevision = (
    key: string,
    current: { revision: number } | undefined,
    expected: number | undefined,
  ) => {
    if (expected !== undefined && expected !== (current?.revision ?? 0))
      throw new ExtensionError(
        "CONFLICT",
        `Store key '${key}' is at revision ${current?.revision ?? 0}, not ${expected}.`,
      );
  };
  const freshName = (base: string, extension: string) => {
    for (let index = 1; ; index++) {
      const name = `${base}-${index}${extension}`;
      if (!record.artifacts.has(`artifact:${name}`)) return name;
    }
  };
  const write = (name: string, bytes: Uint8Array, mediaType: string) => {
    record.artifacts.set(`artifact:${name}`, { bytes, mediaType, name });
    return ref(name);
  };
  const defaultModel = async (): Promise<ModelSelection> =>
    options.defaultModel ?? { provider: "test", modelId: "default" };
  const label = (model: ModelSelection | ImageModelSelection) =>
    `${model.provider}/${model.modelId}`;
  const ctx: ExtensionContext = {
    settings: {
      get: <T>(key: string) => options.settings?.[key] as T | undefined,
    },
    accounts: {
      selected: async (field) => options.accounts?.[field],
    },
    http: {
      request: (async (request: HttpRequest) => {
        record.requests.push(request);
        if (!options.http)
          throw new Error(`Unexpected http request: ${request.url}`);
        return await options.http(request);
      }) as ExtensionContext["http"]["request"],
    },
    artifacts: {
      write: async (name, data, mediaType = "application/octet-stream") =>
        write(
          name,
          typeof data === "string" ? encoder.encode(data) : data,
          mediaType,
        ),
      read: async (handle) => lookup(handle),
      info: async (handle): Promise<ArtifactInfo> => {
        lookup(handle);
        return ref(handle.replace(/^artifact:/, ""));
      },
      freshName: async (base, extension) => freshName(base, extension),
    },
    store: {
      get: async (key) => {
        const entry = record.store.get(checkedKey(key));
        return entry && { value: clone(entry.value), revision: entry.revision };
      },
      set: async (key, value, setOptions) => {
        const current = record.store.get(checkedKey(key));
        checkRevision(key, current, setOptions?.ifRevision);
        if (value === undefined)
          throw new ExtensionError("BAD_REQUEST", "value must be JSON.");
        const revision = (current?.revision ?? 0) + 1;
        record.store.set(key, { value: clone(value), revision });
        return { revision };
      },
      delete: async (key, deleteOptions) => {
        const current = record.store.get(checkedKey(key));
        checkRevision(key, current, deleteOptions?.ifRevision);
        record.store.delete(key);
      },
      keys: async (keysOptions) =>
        [...record.store]
          .filter(([key]) => key.startsWith(keysOptions?.prefix ?? ""))
          .map(([key, { value, revision }]) => ({
            key,
            revision,
            size: encoder.encode(JSON.stringify(value)).byteLength,
          }))
          .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    },
    text: {
      htmlToMarkdown: async (html) => {
        if (!options.htmlToMarkdown)
          throw new Error("Unexpected ctx.text.htmlToMarkdown call.");
        return await options.htmlToMarkdown(html);
      },
    },
    authorize: async (check) => {
      record.authorized.push(check);
      await options.authorize?.(check);
    },
    report: {
      created: (entry) => void record.created.push(entry),
      updated: (entry) => void record.updated.push(entry),
      deleted: (entry) => void record.deleted.push(entry),
      note: (text) => void record.notes.push(text),
    },
    models: {
      ...(options.image
        ? {
            image: {
              generate: async (request) => {
                const output = await options.image!.generate(request);
                return {
                  model: output.model ?? label(request.model),
                  images: output.images.map((image, index) => {
                    const extension =
                      imageExtensions[image.mediaType] ?? ".bin";
                    const given =
                      index === 0 ? request.artifact?.name : undefined;
                    const name = given
                      ? `${given.replace(/\.(png|jpe?g|webp|gif)$/i, "")}${extension}`
                      : freshName(
                          request.artifact?.baseName ?? "image",
                          extension,
                        );
                    return {
                      artifact: write(name, image.bytes, image.mediaType),
                      ...(image.revisedPrompt !== undefined
                        ? { revisedPrompt: image.revisedPrompt }
                        : {}),
                    };
                  }),
                };
              },
              ready: async () => options.image!.ready ?? true,
            },
          }
        : {}),
      ...(options.vision
        ? {
            vision: {
              explain: async (request) =>
                await options.vision!.explain(request, progress),
              ready: async () => options.vision!.ready ?? true,
            },
          }
        : {}),
      ...(options.text
        ? {
            text: {
              complete: async (request) =>
                await options.text!.complete(request, progress),
              ready: async () => options.text!.ready ?? true,
            },
          }
        : {}),
      ...(options.vision || options.text ? { defaultModel } : {}),
    },
    progress,
    log: {
      debug: (message, data) =>
        void record.logs.push({ level: "debug", message, data }),
      warn: (message, data) =>
        void record.logs.push({ level: "warn", message, data }),
    },
  };
  return { ctx, record };
}

// ── Credential providers ─────────────────────────────────────────────────────

/** What a fake credential `ctx` recorded. */
export type FakeCredentialRecord = {
  /** Every `ctx.http.request` of `signIn`, `refresh` or `revoke`. */
  requests: CredentialHttpRequest[];
  /** What `ctx.ui` showed, in order (`link`, `deviceCode`, `progress`). */
  shown: {
    /** What was shown. */
    kind: "link" | "deviceCode" | "progress";
    /** What was passed to it. */
    value: unknown;
  }[];
};

/** What `createFakeCredentialContext` is set up with. */
export type FakeCredentialContextOptions = {
  /** The account (`id`, `kind`, `fields`); defaults to an empty one. */
  account?: Partial<CredentialAccount>;
  /** The typed-in secrets by name. */
  secrets?: Record<string, string>;
  /** `ctx.state`. */
  state?: unknown;
  /** Answers `ctx.http.request`; default: a 404. */
  http?: (
    request: CredentialHttpRequest,
  ) =>
    | Partial<CredentialHttpResponse>
    | Promise<Partial<CredentialHttpResponse>>;
  /** Answers for `ctx.ui.choose` and `ctx.ui.askText`, in order. */
  answers?: string[];
  /** The `request` of `apply`. */
  request?: {
    /** Default `GET`. */
    method?: string;
    /** The request URL. */
    url: string;
    /** Headers set so far. */
    headers?: Record<string, string>;
    /** The body's bytes (or text); digests are computed from it. */
    body?: Uint8Array | string;
  };
};

/**
 * A `ctx` for the operations of a credential provider, for tests: `crypto` is real (Node's), `http`
 * and `ui` are scripted, and `apply` gets a request whose body digests are computed.
 */
export function createFakeCredentialContext(
  options: FakeCredentialContextOptions = {},
): {
  /** Pass to `signIn`. */
  signIn: CredentialSignInContext;
  /** Pass to `refresh`. */
  refresh: CredentialRefreshContext;
  /** Pass to `apply`. */
  apply: CredentialApplyContext;
  /** Pass to `revoke`. */
  revoke: CredentialRevokeContext;
  /** What the operations did with `http` and `ui`. */
  record: FakeCredentialRecord;
} {
  const record: FakeCredentialRecord = { requests: [], shown: [] };
  const account: CredentialAccount = {
    id: "account-1",
    kind: "kind",
    fields: {},
    ...options.account,
  };
  const bytes = (value: Uint8Array | string) =>
    typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  const crypto: CredentialCrypto = {
    hash: async (algorithm, data) =>
      new Uint8Array(createHash(algorithm).update(bytes(data)).digest()),
    hmac: async (algorithm, key, data) =>
      new Uint8Array(
        createHmac(algorithm, bytes(key)).update(bytes(data)).digest(),
      ),
    randomBytes: async (length) => new Uint8Array(randomBytes(length)),
    sign: async ({ algorithm, privateKey, data }) => {
      const key = createPrivateKey(privateKey);
      const digest = algorithm === "EdDSA" ? null : `sha${algorithm.slice(2)}`;
      const signature = algorithm.startsWith("ES")
        ? sign(digest, bytes(data), { key, dsaEncoding: "ieee-p1363" })
        : algorithm === "PS256"
          ? sign(digest, bytes(data), {
              key,
              padding: constants.RSA_PKCS1_PSS_PADDING,
              saltLength: 32,
            })
          : sign(digest, bytes(data), key);
      return new Uint8Array(signature);
    },
  };
  const http = {
    request: async (request: CredentialHttpRequest) => {
      record.requests.push(request);
      const answer = (await options.http?.(request)) ?? {};
      return {
        status: 404,
        ok: false,
        headers: {},
        body: undefined,
        ...answer,
      } as CredentialHttpResponse;
    },
  };
  const answers = [...(options.answers ?? [])];
  const ui: CredentialUi = {
    showLink: (url, instructions) =>
      void record.shown.push({ kind: "link", value: { url, instructions } }),
    showDeviceCode: (input) =>
      void record.shown.push({ kind: "deviceCode", value: input }),
    choose: async () => answers.shift() ?? "",
    askText: async () => answers.shift() ?? "",
    progress: (message) =>
      void record.shown.push({ kind: "progress", value: message }),
    loopback: async () => {
      throw new Error("createFakeCredentialContext has no loopback listener.");
    },
  };
  const base = {
    account,
    secrets: options.secrets ?? {},
    state: options.state,
    crypto,
  };
  const given = options.request;
  const body = given?.body;
  const url = new URL(given?.url ?? "https://example.test/");
  const request: CredentialRequest = {
    method: given?.method ?? "GET",
    url: url.toString(),
    host: url.host,
    path: url.pathname,
    query: [...url.searchParams],
    headers: given?.headers ?? {},
    body:
      body === undefined
        ? undefined
        : {
            size: bytes(body).byteLength,
            digest: async (algorithm) =>
              new Uint8Array(
                createHash(algorithm).update(bytes(body)).digest(),
              ),
            bytes: async () => new Uint8Array(bytes(body)),
          },
  };
  const signal = new AbortController().signal;
  return {
    signIn: { ...base, http, ui, signal },
    refresh: { ...base, http, signal },
    apply: { ...base, request },
    revoke: { ...base, http, signal },
    record,
  };
}
