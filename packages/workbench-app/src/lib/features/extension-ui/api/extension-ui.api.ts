import type {
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
): Promise<unknown> {
  // The operation name follows the bridge method; the daemon validates the input again.
  return requestWorkbench(
    `extensions.ui.${method}` as "extensions.ui.call",
    { ...scope, params } as never,
  );
}
