import type {
  ArtifactInfo,
  ArtifactRef,
  ExtensionContext,
  HttpRequest,
  HttpResponse,
  ImageRequest,
  ImageResult,
  VisionRequest,
  VisionResult,
} from "./types.js";
import type { Risk } from "./authorization.js";
import type { AccountInfo } from "./settings.js";

/** What a fake `ctx` recorded, for assertions. */
export type FakeContextRecord = {
  /** Every `ctx.http.request` the code made, as given. */
  requests: HttpRequest[];
  /** Checks made through `ctx.authorize`. */
  authorized: {
    /** `operation` as passed. */
    operation: string;
    /** `targets` as passed. */
    targets: readonly string[];
    /** `risk` as passed. */
    risk: Risk;
  }[];
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
  /** Present: `ctx.models.image` exists. */
  image?: (request: ImageRequest) => ImageResult | Promise<ImageResult>;
  /** Present: `ctx.models.vision` exists; `ready` defaults to true. */
  vision?: {
    /** Answers `ctx.models.vision.explain`; call `progress(section, chunk)` to stream into live sections (recorded in `record.progress`). */
    explain: (
      request: VisionRequest,
      progress: (section: string, chunk: string) => void,
    ) => VisionResult | Promise<VisionResult>;
    /** Answer of `ctx.models.vision.ready()`; default `true`. */
    ready?: boolean;
  };
  /** Answers `ctx.text.htmlToMarkdown`; throws when a test uses it without one. */
  htmlToMarkdown?: (html: string) => string | Promise<string>;
  /** Becomes `ctx.signal`; default: a signal that never aborts. */
  signal?: AbortSignal;
};

const encoder = new TextEncoder();

/**
 * A `ctx` that keeps everything in memory; extension unit tests use it instead of the host.
 * Returns `ctx` and a `record` of what the code did. It does not enforce `permissions.network`,
 * redirects, size limits or credential injection: only the answers you configure. Call a
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
      ...(options.vision
        ? {
            vision: {
              explain: async (request) =>
                await options.vision!.explain(request, progress),
              ready: async () => options.vision!.ready ?? true,
            },
          }
        : {}),
    },
    progress,
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
