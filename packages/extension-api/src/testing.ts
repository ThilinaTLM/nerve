import type {
  AccountInfo,
  ArtifactInfo,
  ArtifactRef,
  ExtensionContext,
  HttpRequest,
  HttpResponse,
  ImageRequest,
  ImageResult,
  Risk,
} from "./types.js";

/** What a fake `ctx` recorded, for assertions. */
export type FakeContextRecord = {
  requests: HttpRequest[];
  /** Checks made through `ctx.authorize`. */
  authorized: { operation: string; targets: readonly string[]; risk: Risk }[];
  created: string[];
  updated: string[];
  deleted: string[];
  notes: string[];
  logs: { level: "debug" | "warn"; message: string; data?: unknown }[];
  /** Artifacts written or seeded, by handle. */
  artifacts: Map<
    string,
    { bytes: Uint8Array; mediaType: string; name: string }
  >;
};

export type FakeContextOptions = {
  settings?: Record<string, unknown>;
  /** Selected accounts by `account` setting name. */
  accounts?: Record<string, AccountInfo>;
  /** Decides `ctx.authorize` checks; throw to refuse. Absent: every check passes. */
  authorize?: (
    check: FakeContextRecord["authorized"][number],
  ) => void | Promise<void>;
  /** Answers `ctx.http.request`; throws when a test makes a request it did not expect. */
  http?: (request: HttpRequest) => HttpResponse | Promise<HttpResponse>;
  /** Present: `ctx.models.image` exists. */
  image?: (request: ImageRequest) => ImageResult | Promise<ImageResult>;
  /** Answers `ctx.text.htmlToMarkdown`; throws when a test uses it without one. */
  htmlToMarkdown?: (html: string) => string | Promise<string>;
  signal?: AbortSignal;
};

const encoder = new TextEncoder();

/** A `ctx` that keeps everything in memory; extension unit tests use it instead of the host. */
export function createFakeContext(options: FakeContextOptions = {}): {
  ctx: ExtensionContext;
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
    artifacts: new Map(),
  };
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
  const ctx: ExtensionContext = {
    settings: {
      get: <T>(key: string) => options.settings?.[key] as T | undefined,
    },
    accounts: {
      selected: async (field) => options.accounts?.[field],
    },
    http: {
      request: async (request) => {
        record.requests.push(request);
        if (!options.http)
          throw new Error(`Unexpected http request: ${request.url}`);
        return await options.http(request);
      },
    },
    artifacts: {
      write: async (name, data, mediaType = "application/octet-stream") => {
        record.artifacts.set(`artifact:${name}`, {
          bytes: typeof data === "string" ? encoder.encode(data) : data,
          mediaType,
          name,
        });
        return ref(name);
      },
      read: async (handle) => lookup(handle),
      info: async (handle): Promise<ArtifactInfo> => {
        lookup(handle);
        return ref(handle.replace(/^artifact:/, ""));
      },
      freshName: async (base, extension) => {
        for (let index = 1; ; index++) {
          const name = `${base}-${index}${extension}`;
          if (!record.artifacts.has(`artifact:${name}`)) return name;
        }
      },
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
              generate: async (request) => await options.image!(request),
            },
          }
        : {}),
    },
    signal: options.signal ?? new AbortController().signal,
    log: {
      debug: (message, data) =>
        void record.logs.push({ level: "debug", message, data }),
      warn: (message, data) =>
        void record.logs.push({ level: "warn", message, data }),
    },
  };
  return { ctx, record };
}
