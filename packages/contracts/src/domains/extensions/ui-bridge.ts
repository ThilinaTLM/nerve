import { z } from "zod";
import {
  uiContributionIdSchema,
  previewEditModeSchema,
} from "./installed-manifest.js";

/*
 * The bridge between the host (workbench-app) and an extension frame, over `postMessage`.
 * Everything is plain JSON validated on both sides. The host identifies a frame by its window
 * (the frame's origin is opaque), checks each request against `bridgeMethodAvailability` for the
 * contribution that owns the frame, and answers every request exactly once.
 *
 * Handshake: the frame posts `{ nerveBridge: 1, type: "ready" }`, the host answers with `init`.
 * Requests flow frame → host, responses and events host → frame.
 */

export const bridgeProtocolVersion = 1;

/** Limits both sides enforce; a larger message is dropped (requests get a `too_large` error). */
export const bridgeLimits = {
  /** Serialized size of any message, in bytes. */
  maxMessageBytes: 8 * 1024 * 1024,
  /** Most bytes one `file.read` returns; the frame asks for more with a new offset. */
  maxReadChunkBytes: 1024 * 1024,
  /** Chunk size when `length` is not given. */
  defaultReadChunkBytes: 256 * 1024,
  /** Most bytes of content one `file.write` carries (decoded; base64 must fit the message limit). */
  maxWriteBytes: 5 * 1024 * 1024,
  /** Serialized size of the JSON `viewState`. */
  maxViewStateBytes: 64 * 1024,
  /** Serialized size of `call` args. */
  maxCallArgsBytes: 1024 * 1024,
  maxRequestIdLength: 64,
  maxMenuItems: 32,
  maxTextLength: 20_000,
  maxLabelLength: 200,
  maxPageParamsBytes: 4 * 1024,
  /** Bytes of text one `clipboard.writeText` carries (UTF-8). */
  maxClipboardTextBytes: 1024 * 1024,
  /** Decoded bytes of one `clipboard.writeImage`. */
  maxClipboardImageBytes: 5 * 1024 * 1024,
  /** Characters of an `extensionStore` key. */
  maxStoreKeyLength: 128,
  /** Serialized size of one `extensionStore` value. */
  maxStoreValueBytes: 4 * 1024 * 1024,
  /** Serialized size of all values of one extension in one project. */
  maxStoreBytesPerProject: 64 * 1024 * 1024,
  /** Keys of one extension in one project. */
  maxStoreKeys: 1000,
  /** `frameError` reports the host forwards per frame load. */
  maxFrameErrorsPerLoad: 20,
} as const;

export type BridgeJson =
  | string
  | number
  | boolean
  | null
  | BridgeJson[]
  | { [key: string]: BridgeJson };

export const bridgeJsonSchema: z.ZodType<BridgeJson> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(bridgeJsonSchema),
    z.record(z.string(), bridgeJsonSchema),
  ]),
);

const jsonBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;
const jsonWithin = (limit: number) => (value: unknown) =>
  jsonBytes(value) <= limit;

export const bridgeContributionKindSchema = z.enum([
  "preview",
  "page",
  "panel",
]);
export type BridgeContributionKind = z.infer<
  typeof bridgeContributionKindSchema
>;

export const bridgeModeSchema = z.enum(["preview", "edit"]);
export type BridgeMode = z.infer<typeof bridgeModeSchema>;

export const bridgeThemeKindSchema = z.enum(["light", "dark"]);

export const bridgeErrorCodeSchema = z.enum([
  /** The message does not match the method's schema. */
  "invalid_request",
  /** The method is not available to this contribution (kind, edit mode). */
  "not_allowed",
  "unknown_method",
  "not_found",
  /** A size limit was exceeded. */
  "too_large",
  /** The user dismissed the request (confirm, menu). */
  "cancelled",
  /** The extension's backend method failed; `message` is the (shortened) backend error. */
  "backend_error",
  /** An `extensionStore` write's `ifRevision` no longer matches the stored revision. */
  "conflict",
  "failed",
]);
export type BridgeErrorCode = z.infer<typeof bridgeErrorCodeSchema>;

// ── Methods ───────────────────────────────────────────────────────────────

const emptyParams = z.strictObject({});
const emptyResult = z.strictObject({});
const text = (max: number = bridgeLimits.maxLabelLength) =>
  z.string().min(1).max(max);

const menuItemSchema = z.strictObject({
  id: text(64),
  label: text(),
  disabled: z.boolean().optional(),
  destructive: z.boolean().optional(),
});

/** A path inside the open project, relative to its directory or absolute inside it. */
const projectPathSchema = z.string().min(1).max(4096);

/**
 * An `extensionStore` key: letters, digits, `.`, `_` and `-`, 1–128 characters, not starting with
 * a dot. Safe as a file name, so the daemon stores one file per key.
 */
export const extensionStoreKeySchema = z
  .string()
  .min(1)
  .max(bridgeLimits.maxStoreKeyLength)
  .regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/, {
    message:
      "key may hold only letters, digits, '.', '_' and '-', and must not start with '.'",
  });

/** Revision of a stored key: 1 on first write, +1 on every write. `ifRevision: 0` means "must not exist". */
const storeRevisionSchema = z.number().int().nonnegative();

const base64Bytes = (value: string) => {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
};

/** Media types `clipboard.writeImage` accepts; the host converts non-PNG to PNG. */
export const bridgeClipboardImageTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const bridgeMethods = {
  "file.info": {
    params: emptyParams,
    result: z.strictObject({
      /** Project-relative path. */
      path: z.string(),
      name: z.string(),
      /** Lower-case extension with the dot, `""` when none. */
      extension: z.string(),
      size: z.number().int().nonnegative(),
      /** ISO timestamp of the last modification. */
      modifiedAt: z.string().optional(),
    }),
  },
  "file.read": {
    params: z.strictObject({
      offset: z.number().int().nonnegative().optional(),
      length: z
        .number()
        .int()
        .positive()
        .max(bridgeLimits.maxReadChunkBytes)
        .optional(),
    }),
    result: z.strictObject({
      offset: z.number().int().nonnegative(),
      /** The bytes, base64 encoded. */
      dataBase64: z.string(),
      /** Decoded byte length of `dataBase64`. */
      length: z.number().int().nonnegative(),
      /** Total size of the file. */
      size: z.number().int().nonnegative(),
      eof: z.boolean(),
    }),
  },
  "file.write": {
    params: z.strictObject({
      content: z.string(),
      /** `utf8`: `content` is text; `base64`: `content` encodes bytes. */
      encoding: z.enum(["utf8", "base64"]),
    }),
    result: z.strictObject({ size: z.number().int().nonnegative() }),
  },
  "mode.get": {
    params: emptyParams,
    result: z.strictObject({ mode: bridgeModeSchema }),
  },
  call: {
    params: z.strictObject({
      /** One of the extension's own backend methods, as `namespace.method`. */
      method: text(128),
      args: bridgeJsonSchema
        .optional()
        .refine(jsonWithin(bridgeLimits.maxCallArgsBytes), {
          message: "args are too large",
        }),
    }),
    result: z.strictObject({ value: bridgeJsonSchema.optional() }),
  },
  "settings.get": {
    params: emptyParams,
    /** Resolved, non-secret settings of the extension. */
    result: z.strictObject({ values: z.record(z.string(), bridgeJsonSchema) }),
  },
  "viewState.get": {
    params: emptyParams,
    result: z.strictObject({ state: bridgeJsonSchema.nullable() }),
  },
  "viewState.set": {
    params: z.strictObject({
      state: bridgeJsonSchema.refine(
        jsonWithin(bridgeLimits.maxViewStateBytes),
        {
          message: `view state is larger than ${bridgeLimits.maxViewStateBytes} bytes`,
        },
      ),
    }),
    result: emptyResult,
  },
  "ui.confirm": {
    params: z.strictObject({
      title: text(),
      message: z.string().max(bridgeLimits.maxTextLength).optional(),
      confirmLabel: text(64).optional(),
      cancelLabel: text(64).optional(),
      destructive: z.boolean().optional(),
    }),
    result: z.strictObject({ confirmed: z.boolean() }),
  },
  "ui.showMenu": {
    params: z.strictObject({
      items: z.array(menuItemSchema).min(1).max(bridgeLimits.maxMenuItems),
      /** Frame-relative position in CSS pixels; the host clamps it to the frame. */
      position: z.strictObject({ x: z.number(), y: z.number() }).optional(),
    }),
    /** `id` of the chosen item, `null` when dismissed. */
    result: z.strictObject({ id: z.string().nullable() }),
  },
  "ui.notify": {
    params: z.strictObject({
      message: text(bridgeLimits.maxTextLength),
      level: z.enum(["info", "success", "warning", "error"]).optional(),
    }),
    result: emptyResult,
  },
  openFile: {
    params: z.strictObject({ path: projectPathSchema }),
    result: emptyResult,
  },
  openPage: {
    params: z.strictObject({
      /** Id of one of this extension's pages. */
      id: uiContributionIdSchema,
      params: bridgeJsonSchema
        .optional()
        .refine(jsonWithin(bridgeLimits.maxPageParamsBytes), {
          message: "page params are too large",
        }),
    }),
    result: emptyResult,
  },
  "project.info": {
    params: emptyParams,
    result: z.strictObject({
      id: z.string(),
      name: z.string(),
      directory: z.string(),
    }),
  },
  "composer.insert": {
    params: z.strictObject({ text: text(bridgeLimits.maxTextLength) }),
    result: emptyResult,
  },
  "clipboard.writeText": {
    params: z.strictObject({
      text: z
        .string()
        .refine(
          (value) =>
            new TextEncoder().encode(value).length <=
            bridgeLimits.maxClipboardTextBytes,
          { message: "text is too large" },
        ),
    }),
    result: emptyResult,
  },
  "clipboard.writeImage": {
    params: z.strictObject({
      /** The image bytes, base64 encoded. */
      dataBase64: z
        .string()
        .min(1)
        .regex(/^[A-Za-z0-9+/]*={0,2}$/, { message: "not base64" })
        .refine(
          (value) => base64Bytes(value) <= bridgeLimits.maxClipboardImageBytes,
          { message: "image is too large" },
        ),
      mediaType: z.enum(bridgeClipboardImageTypes),
    }),
    result: emptyResult,
  },
  "extensionStore.get": {
    params: z.strictObject({ key: extensionStoreKeySchema }),
    /** `value` and `revision` are `null` when the key does not exist. */
    result: z.strictObject({
      value: bridgeJsonSchema.nullable(),
      revision: z.number().int().positive().nullable(),
    }),
  },
  "extensionStore.set": {
    params: z.strictObject({
      key: extensionStoreKeySchema,
      value: bridgeJsonSchema.refine(
        jsonWithin(bridgeLimits.maxStoreValueBytes),
        { message: "value is too large" },
      ),
      /** Write only when the stored revision is this one (`0`: only when the key does not exist); else `conflict`. */
      ifRevision: storeRevisionSchema.optional(),
    }),
    result: z.strictObject({ revision: z.number().int().positive() }),
  },
  "extensionStore.delete": {
    params: z.strictObject({
      key: extensionStoreKeySchema,
      ifRevision: storeRevisionSchema.optional(),
    }),
    result: emptyResult,
  },
  "extensionStore.keys": {
    params: z.strictObject({
      prefix: z.string().max(bridgeLimits.maxStoreKeyLength).optional(),
    }),
    result: z.strictObject({
      keys: z.array(
        z.strictObject({
          key: z.string(),
          revision: z.number().int().positive(),
          /** Serialized size of the value in bytes. */
          size: z.number().int().nonnegative(),
        }),
      ),
    }),
  },
} as const;

export type BridgeMethodName = keyof typeof bridgeMethods;
export const bridgeMethodNames = Object.keys(
  bridgeMethods,
) as BridgeMethodName[];
export type BridgeParams<M extends BridgeMethodName> = z.input<
  (typeof bridgeMethods)[M]["params"]
>;
export type BridgeResult<M extends BridgeMethodName> = z.output<
  (typeof bridgeMethods)[M]["result"]
>;

const allKinds = ["preview", "page", "panel"] as const;

/**
 * Which contribution kinds may call each method. `file.*` is for previews only; `file.write` and
 * `mode.get` additionally need a preview with `edit: "custom"` (see `isBridgeMethodAllowed`).
 */
export const bridgeMethodKinds: Record<
  BridgeMethodName,
  readonly BridgeContributionKind[]
> = {
  "file.info": ["preview"],
  "file.read": ["preview"],
  "file.write": ["preview"],
  "mode.get": ["preview"],
  call: allKinds,
  "settings.get": allKinds,
  "viewState.get": allKinds,
  "viewState.set": allKinds,
  "ui.confirm": allKinds,
  "ui.showMenu": allKinds,
  "ui.notify": allKinds,
  openFile: allKinds,
  openPage: allKinds,
  "project.info": allKinds,
  "composer.insert": allKinds,
  "clipboard.writeText": allKinds,
  "clipboard.writeImage": allKinds,
  "extensionStore.get": allKinds,
  "extensionStore.set": allKinds,
  "extensionStore.delete": allKinds,
  "extensionStore.keys": allKinds,
};

/** Methods that only exist for previews with `edit: "custom"`. */
export const bridgeCustomEditMethods: readonly BridgeMethodName[] = [
  "file.write",
  "mode.get",
];

/** Whether a frame of this kind (and, for previews, edit mode) may call `method`. */
export function isBridgeMethodAllowed(
  method: BridgeMethodName,
  contribution: {
    kind: BridgeContributionKind;
    edit?: z.infer<typeof previewEditModeSchema>;
  },
): boolean {
  if (!bridgeMethodKinds[method].includes(contribution.kind)) return false;
  if (bridgeCustomEditMethods.includes(method))
    return contribution.edit === "custom";
  return true;
}

// ── Events (host → frame) ─────────────────────────────────────────────────

export const bridgeEvents = {
  themeChanged: z.strictObject({
    kind: bridgeThemeKindSchema,
    /** Custom-property declarations (`--background:…;`) of the active theme. */
    tokensCss: z.string().max(8192),
  }),
  fileChanged: z.strictObject({
    size: z.number().int().nonnegative(),
    modifiedAt: z.string().optional(),
  }),
  modeChanged: z.strictObject({ mode: bridgeModeSchema }),
  /** A key of this extension's store changed (by another frame or the backend); `revision` `null`: deleted. */
  extensionStoreChanged: z.strictObject({
    key: z.string(),
    revision: z.number().int().positive().nullable(),
  }),
} as const;
export type BridgeEventName = keyof typeof bridgeEvents;

/** Events each kind receives: `themeChanged` for all; file and mode events for previews. */
export const bridgeEventKinds: Record<
  BridgeEventName,
  readonly BridgeContributionKind[]
> = {
  themeChanged: allKinds,
  fileChanged: ["preview"],
  modeChanged: ["preview"],
  extensionStoreChanged: allKinds,
};

// ── Envelope ──────────────────────────────────────────────────────────────

const envelope = { nerveBridge: z.literal(bridgeProtocolVersion) };
const requestId = z.string().min(1).max(bridgeLimits.maxRequestIdLength);

/** Frame → host: the frame is loaded and wants its `init`. */
export const bridgeReadySchema = z.strictObject({
  ...envelope,
  type: z.literal("ready"),
});

/** What a frame reports about its own failures; the host records it for `extensions.status`. */
export const bridgeFrameErrorSchema = z.strictObject({
  /** `error`: an uncaught exception; `unhandledrejection`; `csp`: the frame's CSP blocked something. */
  kind: z.enum(["error", "unhandledrejection", "csp"]),
  message: z.string().min(1).max(1000),
  /** Where: script URL and line, or the CSP directive and blocked URL. */
  source: z.string().max(500).optional(),
});
export type BridgeFrameError = z.infer<typeof bridgeFrameErrorSchema>;

/** Frame → host: a failure inside the frame. Not a request: it gets no response. */
export const bridgeFrameErrorMessageSchema = z.strictObject({
  ...envelope,
  type: z.literal("frameError"),
  error: bridgeFrameErrorSchema,
});

/** Frame → host. `method` and `params` are validated against `bridgeMethods` after the envelope. */
export const bridgeRequestSchema = z.strictObject({
  ...envelope,
  type: z.literal("request"),
  id: requestId,
  method: z.string().min(1).max(64),
  params: z.unknown().optional(),
});

export const bridgeErrorSchema = z.strictObject({
  code: bridgeErrorCodeSchema,
  message: z.string().max(2000),
});

/** Host → frame. */
export const bridgeResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ...envelope,
    type: z.literal("response"),
    id: requestId,
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("response"),
    id: requestId,
    ok: z.literal(false),
    error: bridgeErrorSchema,
  }),
]);

/** Host → frame. `data` is validated against `bridgeEvents[event]` after the envelope. */
export const bridgeEventSchema = z.strictObject({
  ...envelope,
  type: z.literal("event"),
  event: z.string().min(1).max(64),
  data: z.unknown().optional(),
});

/** Host → frame: everything a frame needs to start. */
export const bridgeInitSchema = z.strictObject({
  ...envelope,
  type: z.literal("init"),
  contribution: z.strictObject({
    kind: bridgeContributionKindSchema,
    id: uiContributionIdSchema,
    /** Previews only. */
    edit: previewEditModeSchema.optional(),
  }),
  extensionId: z.string(),
  /** Current mode; always `preview` outside previews with `edit: "custom"`. */
  mode: bridgeModeSchema,
  themeKind: bridgeThemeKindSchema,
  /** Custom-property declarations of the active theme, to put in a `:root` rule. */
  tokensCss: z.string().max(8192),
  /** URL of the base stylesheet (Tailwind preset, fonts) served with the frame. */
  baseCssUrl: z.string().min(1).max(2048),
  /** Pages only: the `params` the page was opened with. */
  pageParams: bridgeJsonSchema.optional(),
});
export type BridgeInit = z.infer<typeof bridgeInitSchema>;

export const bridgeFrameMessageSchema = z.discriminatedUnion("type", [
  bridgeReadySchema,
  bridgeRequestSchema,
  bridgeFrameErrorMessageSchema,
]);
export const bridgeHostMessageSchema = z.union([
  bridgeInitSchema,
  bridgeResponseSchema,
  bridgeEventSchema,
]);
export type BridgeRequest = z.infer<typeof bridgeRequestSchema>;
export type BridgeResponse = z.infer<typeof bridgeResponseSchema>;
export type BridgeEvent = z.infer<typeof bridgeEventSchema>;

/**
 * Checks a request against the contribution that owns the frame: known method, allowed for its
 * kind and edit mode, params valid. Returns the parsed params or the error to answer with.
 */
export function validateBridgeRequest(
  request: BridgeRequest,
  contribution: {
    kind: BridgeContributionKind;
    edit?: z.infer<typeof previewEditModeSchema>;
  },
):
  | { ok: true; method: BridgeMethodName; params: unknown }
  | { ok: false; error: { code: BridgeErrorCode; message: string } } {
  if (!Object.hasOwn(bridgeMethods, request.method))
    return {
      ok: false,
      error: {
        code: "unknown_method",
        message: `Unknown method ${request.method}`,
      },
    };
  const method = request.method as BridgeMethodName;
  if (!isBridgeMethodAllowed(method, contribution))
    return {
      ok: false,
      error: {
        code: "not_allowed",
        message: `${method} is not available here`,
      },
    };
  const parsed = bridgeMethods[method].params.safeParse(request.params ?? {});
  if (!parsed.success)
    return {
      ok: false,
      error: {
        code: "invalid_request",
        message: parsed.error.issues
          .map((i) => `${i.path.join(".") || "params"}: ${i.message}`)
          .join("; ")
          .slice(0, 500),
      },
    };
  return { ok: true, method, params: parsed.data };
}
