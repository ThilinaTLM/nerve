import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";
import { extensionIdSchema } from "./settings-schema.js";
import {
  previewEditModeSchema,
  previewFileExtensionSchema,
} from "./installed-manifest.js";
import { uiContributionIdSchema } from "./ui-contribution-id.js";
import {
  bridgeContributionKindSchema,
  bridgeFrameErrorSchema,
  bridgeMethods,
  type BridgeMethodName,
} from "./ui-bridge.js";
import { themeFileSchema } from "./theme-file.js";

/*
 * What the workbench app asks of the daemon for installed-extension UI. Only the signed-in
 * user's app sends these; no agent tool, `quick_script` namespace or extension port exposes
 * them. Methods that are pure host UI (dialogs, menus, notifications, workspace, pages, chat.insert,
 * tabState, clipboard; `chat.startConversation` reaches the server after the app's gesture check) never reach the server.
 */

/** Bridge methods the daemon answers: everything that needs files, settings, the project or the backend. */
export const serverBridgeMethods = [
  "file.info",
  "file.read",
  "file.write",
  "settings.get",
  "project.info",
  "backend.call",
  "chat.startConversation",
  "store.get",
  "store.set",
  "store.delete",
  "store.keys",
] as const satisfies readonly BridgeMethodName[];
export type ServerBridgeMethod = (typeof serverBridgeMethods)[number];

/** The contribution a frame belongs to. */
export const extensionUiContributionRefSchema = z.strictObject({
  kind: bridgeContributionKindSchema,
  id: uiContributionIdSchema,
});

const requestBase = {
  projectId: z.string().min(1),
  extensionId: extensionIdSchema,
  contribution: extensionUiContributionRefSchema,
  /** Previews only: the project file the tab is opened on (project-relative). */
  filePath: z.string().min(1).max(4096).optional(),
};

const uiRequest = <P extends z.ZodType>(params: P) =>
  z.strictObject({
    ...requestBase,
    params,
    /**
     * Store writes: an id of the requesting frame, echoed in `extensions.store.changed` so that
     * frame can skip the event its own write caused.
     */
    origin: z.string().min(1).max(64).optional(),
  });

const uiOperation = <const M extends ServerBridgeMethod>(
  method: M,
  kind: "read" | "mutation",
) =>
  defineOperation(
    `extensions.ui.${method}`,
    uiRequest(bridgeMethods[method].params),
    bridgeMethods[method].result,
    kind,
    "none",
    ["workbench_server"],
    `operation.extensions.ui.${method}`,
  );

// ── Contributions ─────────────────────────────────────────────────────────

const frameUrl = z.string().min(1).max(2048);
const contributionBase = {
  extensionId: extensionIdSchema,
  extensionName: z.string(),
  source: z.enum(["user", "project"]),
  id: uiContributionIdSchema,
  label: z.string(),
  /** Path (with the daemon's origin as base) of the frame's `index.html`; carries a per-project token. */
  frameUrl,
};

export const extensionUiPreviewSchema = z.strictObject({
  ...contributionBase,
  match: z.strictObject({ extensions: z.array(previewFileExtensionSchema) }),
  edit: previewEditModeSchema,
});
export const extensionUiFrameItemSchema = z.strictObject({
  ...contributionBase,
  /** A lucide icon name. */
  icon: z.string(),
});
export const extensionUiPageSchema = extensionUiFrameItemSchema.extend({
  /** Listed in the new-tab menu. */
  newMenu: z.boolean(),
});

export const extensionUiContributionsSchema = z.strictObject({
  /** URL of the base stylesheet every frame loads (the same for all frames). */
  baseCssUrl: frameUrl,
  previews: z.array(extensionUiPreviewSchema),
  pages: z.array(extensionUiPageSchema),
  panels: z.array(extensionUiFrameItemSchema),
});
export type ExtensionUiContributions = z.infer<
  typeof extensionUiContributionsSchema
>;

// ── Themes ────────────────────────────────────────────────────────────────

export const extensionUiThemeSchema = z.strictObject({
  /** `ext:<extension-id>/<theme-id>`. */
  id: z.string(),
  extensionId: extensionIdSchema,
  extensionName: z.string(),
  label: z.string(),
  kind: themeFileSchema.shape.kind,
  tokens: themeFileSchema.shape.tokens,
  /** Ready to inject: `--background:…;…`. */
  tokensCss: z.string(),
});
/** Themes of enabled user extensions that passed validation; the others are catalog diagnostics. */
export const extensionUiThemesSchema = z.strictObject({
  themes: z.array(extensionUiThemeSchema),
});
export type ExtensionUiTheme = z.infer<typeof extensionUiThemeSchema>;
export type ExtensionUiThemes = z.infer<typeof extensionUiThemesSchema>;

export const extensionUiOperationDefinitions = [
  defineOperation(
    "extensions.ui.contributions",
    z.strictObject({ projectId: z.string().min(1) }),
    extensionUiContributionsSchema,
    "read",
    "none",
    ["workbench_server"],
    "operation.extensions.ui.contributions",
  ),
  defineOperation(
    "extensions.ui.themes",
    z.strictObject({}),
    extensionUiThemesSchema,
    "read",
    "none",
    ["workbench_server"],
    "operation.extensions.ui.themes",
  ),
  uiOperation("file.info", "read"),
  uiOperation("file.read", "read"),
  uiOperation("file.write", "mutation"),
  uiOperation("settings.get", "read"),
  uiOperation("project.info", "read"),
  uiOperation("backend.call", "mutation"),
  uiOperation("chat.startConversation", "mutation"),
  uiOperation("store.get", "read"),
  uiOperation("store.set", "mutation"),
  uiOperation("store.delete", "mutation"),
  uiOperation("store.keys", "read"),
  /** A frame's uncaught error or CSP violation, recorded for `extensions.status().recentErrors`. */
  defineOperation(
    "extensions.ui.reportFrameError",
    z.strictObject({ ...requestBase, error: bridgeFrameErrorSchema }),
    z.strictObject({}),
    "mutation",
    "none",
    ["workbench_server"],
    "operation.extensions.ui.reportFrameError",
  ),
] as const;
