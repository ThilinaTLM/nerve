import type {
  BridgeFrameError,
  BridgeMethodName,
  ExtensionUiContributions,
  ExtensionUiThemes,
  ServerBridgeMethod,
} from "@nervekit/contracts/extensions";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";

export function getExtensionUiContributions(
  projectId: string,
): Promise<ExtensionUiContributions> {
  return requestWorkbench("extensions.ui.contributions", { projectId });
}

export function getExtensionUiThemes(): Promise<ExtensionUiThemes> {
  return requestWorkbench("extensions.ui.themes", {});
}

/** What identifies the frame a bridge request comes from. */
export type ExtensionFrameScope = {
  projectId: string;
  extensionId: string;
  contribution: { kind: "preview" | "page" | "panel"; id: string };
  /** Previews only. */
  filePath?: string;
};

/** Forwards a bridge request the daemon answers; the frame host validated `params`. */
export function requestExtensionUiMethod(
  method: ServerBridgeMethod & BridgeMethodName,
  scope: ExtensionFrameScope,
  params: unknown,
  /** Identifies the requesting frame so that its own store changes are not echoed back. */
  origin?: string,
): Promise<unknown> {
  // The operation name follows the bridge method; the daemon validates the input again.
  return requestWorkbench(
    `extensions.ui.${method}` as "extensions.ui.call",
    { ...scope, params, origin } as never,
  );
}

/** Reports an uncaught error or CSP violation from a frame. */
export function reportExtensionFrameError(
  scope: ExtensionFrameScope,
  error: BridgeFrameError,
): Promise<unknown> {
  return requestWorkbench("extensions.ui.reportFrameError", {
    ...scope,
    error,
  });
}
