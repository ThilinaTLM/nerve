import { ExtensionError } from "@nervekit/extension-api";
import { ToolExecutionError } from "../../execution/index.js";

/**
 * An `ExtensionError` as the host failure the script sees: the code reaches
 * `e.code` unchanged and the fix is appended to the message. Other errors pass through.
 */
export function toHostError(error: unknown): unknown {
  if (!(error instanceof ExtensionError)) return error;
  const message = error.fix ? `${error.message} ${error.fix}` : error.message;
  return new ToolExecutionError(error.code, message, {}, false);
}

/** Display name of an account for messages: `"Acme" (Atlassian account)`. */
export const settingsPage = (extensionName: string) =>
  `Settings → Extensions → ${extensionName}`;
