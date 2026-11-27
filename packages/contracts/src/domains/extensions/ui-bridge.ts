import { z } from "zod";
import { previewEditModeSchema } from "./installed-manifest.js";
import { bridgeLimits } from "./limits.js";
import { bridgeThemeKindSchema } from "./theme-file.js";
import { uiContributionIdSchema } from "./ui-contribution-id.js";

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

export const bridgeErrorCodeSchema = z.enum([
  /** The message does not match the method's schema. */
  "invalid_request",
  /** The method is not available to this contribution (kind, edit mode). */
  "not_allowed",
  "unknown_method",
  "not_found",
  /** A size limit was exceeded. */
  "too_large",
  /** The user dismissed the request, or another host-drawn request was already open (confirm, menu, pick). */
  "cancelled",
  /** The extension's backend method failed; `message` is the (shortened) backend error. */
  "backend_error",
  /** A `store` write's `ifRevision` no longer matches the stored revision. */
  "conflict",
  "failed",
]);
export type BridgeErrorCode = z.infer<typeof bridgeErrorCodeSchema>;

// ── Methods ───────────────────────────────────────────────────────────────

const emptyParams = z.strictObject({});
const emptyResult = z.strictObject({});
const text = (max: number = bridgeLimits.maxLabelLength) =>
  z.string().min(1).max(max);

/** A lucide icon by its kebab-case name (`"file-text"`); the host resolves it and shows nothing for an unknown name. */
const iconNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: "not a lucide icon name" });

/** An id the frame gets back when the user chooses an entry. */
const choiceIdSchema = text(bridgeLimits.maxChoiceIdLength);

/** A CSS-pixel rectangle in the frame's viewport; a point is a rectangle without size. */
const anchorSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative().optional(),
  height: z.number().finite().nonnegative().optional(),
});
export type BridgeAnchor = z.infer<typeof anchorSchema>;

/** One entry of a `ui.menu` menu. */
export type BridgeMenuEntry =
  | {
      type?: "item" | undefined;
      /** Returned when chosen; unique in the menu. */
      id: string;
      label: string;
      /** Lucide icon name. */
      icon?: string | undefined;
      /** Display-only key hint (`Ctrl+K`). */
      shortcut?: string | undefined;
      checked?: boolean | undefined;
      disabled?: boolean | undefined;
      destructive?: boolean | undefined;
    }
  | { type: "separator" }
  /** A caption above the entries that follow. */
  | { type: "label"; label: string }
  | {
      type: "submenu";
      label: string;
      icon?: string | undefined;
      disabled?: boolean | undefined;
      items: BridgeMenuEntry[];
    };

const menuEntrySchema: z.ZodType<BridgeMenuEntry, BridgeMenuEntry> = z.lazy(
  () =>
    z.union(
      [
        z.strictObject({
          type: z.literal("item").optional(),
          id: choiceIdSchema,
          label: text(),
          icon: iconNameSchema.optional(),
          shortcut: text(64).optional(),
          checked: z.boolean().optional(),
          disabled: z.boolean().optional(),
          destructive: z.boolean().optional(),
        }),
        z.strictObject({ type: z.literal("separator") }),
        z.strictObject({ type: z.literal("label"), label: text() }),
        z.strictObject({
          type: z.literal("submenu"),
          label: text(),
          icon: iconNameSchema.optional(),
          disabled: z.boolean().optional(),
          items: z.array(menuEntrySchema).min(1),
        }),
      ],
      {
        error:
          'a menu entry is an item ({ id, label }), { type: "separator" }, { type: "label", label } or { type: "submenu", label, items }',
      },
    ),
);

/**
 * What is wrong with a menu: more entries than `maxMenuEntries` (nested ones included), submenus
 * nested deeper than `maxMenuDepth`, a repeated item id, or nothing to choose.
 */
function menuProblem(entries: readonly BridgeMenuEntry[]): string | undefined {
  let count = 0;
  let choices = 0;
  const ids = new Set<string>();
  let problem: string | undefined;
  const visit = (list: readonly BridgeMenuEntry[], depth: number) => {
    for (const entry of list) {
      count += 1;
      if (entry.type === "submenu") {
        if (depth >= bridgeLimits.maxMenuDepth)
          problem ??= `submenus nest at most ${bridgeLimits.maxMenuDepth} deep`;
        visit(entry.items, depth + 1);
      } else if (entry.type === undefined || entry.type === "item") {
        choices += 1;
        if (ids.has(entry.id))
          problem ??= `the item id '${entry.id}' is used twice`;
        ids.add(entry.id);
      }
    }
  };
  visit(entries, 0);
  if (count > bridgeLimits.maxMenuEntries)
    return `the menu has ${count} entries; the limit is ${bridgeLimits.maxMenuEntries} (submenu entries included)`;
  return (
    problem ?? (choices === 0 ? "the menu has no item to choose" : undefined)
  );
}

const pickItemSchema = z.strictObject({
  id: choiceIdSchema,
  label: text(),
  /** Heading the item is listed under. */
  group: text().optional(),
  /** Muted second line. */
  detail: z.string().max(bridgeLimits.maxLabelLength).optional(),
  /** Search terms that are not shown. */
  keywords: z
    .array(z.string().max(bridgeLimits.maxLabelLength))
    .max(bridgeLimits.maxPickKeywords)
    .optional(),
  icon: iconNameSchema.optional(),
  disabled: z.boolean().optional(),
});

/** A path inside the open project, relative to its directory or absolute inside it. */
const projectPathSchema = z.string().min(1).max(4096);

/**
 * A store key: letters, digits, `.`, `_` and `-`, 1–128 characters, not starting with
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
  "backend.call": {
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
    /** A field key of the extension's settings. */
    params: z.strictObject({ key: text(128) }),
    /** The resolved, non-secret value; absent when the field is unset or has no value for frames (secrets). */
    result: z.strictObject({ value: bridgeJsonSchema.optional() }),
  },
  "tabState.get": {
    params: emptyParams,
    result: z.strictObject({ state: bridgeJsonSchema.nullable() }),
  },
  "tabState.set": {
    params: z.strictObject({
      state: bridgeJsonSchema.refine(
        jsonWithin(bridgeLimits.maxTabStateBytes),
        {
          message: `tab state is larger than ${bridgeLimits.maxTabStateBytes} bytes`,
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
  "ui.menu": {
    params: z
      .strictObject({
        entries: z.array(menuEntrySchema).min(1),
        /** Where the menu opens, in frame CSS pixels; the host keeps it inside the app window. */
        anchor: anchorSchema,
      })
      .superRefine((value, ctx) => {
        const problem = menuProblem(value.entries);
        if (problem)
          ctx.addIssue({ code: "custom", path: ["entries"], message: problem });
      }),
    /** `id` of the chosen item, `null` when dismissed. */
    result: z.strictObject({ id: z.string().nullable() }),
  },
  "ui.pick": {
    params: z
      .strictObject({
        title: text().optional(),
        placeholder: text().optional(),
        /** The accessible name of the list. */
        ariaLabel: text(),
        mode: z.enum(["single", "multiple"]),
        items: z.array(pickItemSchema).min(1).max(bridgeLimits.maxPickItems),
        /** Ids chosen on open; at most one in `single` mode. */
        selected: z.array(choiceIdSchema).optional(),
        /** Where the list opens; absent: centered in the frame. */
        anchor: anchorSchema.optional(),
      })
      .superRefine((value, ctx) => {
        const seen = new Set<string>();
        for (const item of value.items) {
          if (seen.has(item.id))
            ctx.addIssue({
              code: "custom",
              path: ["items"],
              message: `the item id '${item.id}' is used twice`,
            });
          seen.add(item.id);
        }
        if (value.mode === "single" && (value.selected?.length ?? 0) > 1)
          ctx.addIssue({
            code: "custom",
            path: ["selected"],
            message: "a single pick has at most one selected id",
          });
      }),
    /** The chosen ids (one in `single` mode); `null` when dismissed or cancelled. */
    result: z.strictObject({ ids: z.array(z.string()).nullable() }),
  },
  "ui.notify": {
    params: z.strictObject({
      message: text(bridgeLimits.maxTextLength),
      level: z.enum(["info", "success", "warning", "error"]).optional(),
    }),
    result: emptyResult,
  },
  "workspace.openFile": {
    params: z.strictObject({ path: projectPathSchema }),
    result: emptyResult,
  },
  "pages.open": {
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
  "chat.insert": {
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
  "chat.startConversation": {
    params: z.strictObject({
      prompt: text(bridgeLimits.maxConversationPromptLength),
      title: text().optional(),
      /** Keys of this extension's `model`, `agentProfile` and `permissionRuleSet` settings. */
      model: text(128).optional(),
      agentProfile: text(128).optional(),
      permissionRuleSet: text(128).optional(),
      /** Default `true`: send the prompt. `false`: leave it unsent in the new conversation's composer. */
      send: z.boolean().optional(),
      /** Default `true`: open the new conversation in the app. */
      open: z.boolean().optional(),
    }),
    result: z.strictObject({ conversationId: z.string() }),
  },
  "store.get": {
    params: z.strictObject({ key: extensionStoreKeySchema }),
    /** `entry` is `null` when the key does not exist. */
    result: z.strictObject({
      entry: z
        .strictObject({
          value: bridgeJsonSchema,
          revision: z.number().int().positive(),
        })
        .nullable(),
    }),
  },
  "store.set": {
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
  "store.delete": {
    params: z.strictObject({
      key: extensionStoreKeySchema,
      ifRevision: storeRevisionSchema.optional(),
    }),
    result: emptyResult,
  },
  "store.keys": {
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
 * Which contribution kinds may call each method. `file.*` is for previews only; `file.write`
 * additionally needs a preview with `edit: "custom"` (see `isBridgeMethodAllowed`).
 */
export const bridgeMethodKinds: Record<
  BridgeMethodName,
  readonly BridgeContributionKind[]
> = {
  "file.info": ["preview"],
  "file.read": ["preview"],
  "file.write": ["preview"],
  "backend.call": allKinds,
  "settings.get": allKinds,
  "tabState.get": allKinds,
  "tabState.set": allKinds,
  "ui.confirm": allKinds,
  "ui.menu": allKinds,
  "ui.pick": allKinds,
  "ui.notify": allKinds,
  "workspace.openFile": allKinds,
  "pages.open": allKinds,
  "project.info": allKinds,
  "chat.insert": allKinds,
  "clipboard.writeText": allKinds,
  "clipboard.writeImage": allKinds,
  "chat.startConversation": allKinds,
  "store.get": allKinds,
  "store.set": allKinds,
  "store.delete": allKinds,
  "store.keys": allKinds,
};

/** Methods that only exist for previews with `edit: "custom"`. */
export const bridgeCustomEditMethods: readonly BridgeMethodName[] = [
  "file.write",
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
  "theme.changed": z.strictObject({
    kind: bridgeThemeKindSchema,
    /** Custom-property declarations (`--background:…;`) of the active theme. */
    tokensCss: z.string().max(8192),
  }),
  "file.changed": z.strictObject({
    size: z.number().int().nonnegative(),
    modifiedAt: z.string().optional(),
  }),
  "mode.changed": z.strictObject({ mode: bridgeModeSchema }),
  /** A key of this extension's store changed (by another frame or the backend); `revision` `null`: deleted. */
  "store.changed": z.strictObject({
    key: z.string(),
    revision: z.number().int().positive().nullable(),
  }),
} as const;
export type BridgeEventName = keyof typeof bridgeEvents;

/** Events each kind receives: theme, mode and store events for all; file events for previews. */
export const bridgeEventKinds: Record<
  BridgeEventName,
  readonly BridgeContributionKind[]
> = {
  "theme.changed": allKinds,
  "file.changed": ["preview"],
  "mode.changed": ["preview"],
  "store.changed": allKinds,
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
