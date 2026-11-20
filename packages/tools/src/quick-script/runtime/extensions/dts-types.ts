/** Declarations of the `extensions` runtime namespace. */
export const EXTENSIONS_DTS_TYPES = `interface ExtensionStatus {
  id: string;
  /** "not_found" when no folder or built-in has this id at the project. */
  state: "enabled" | "pending_consent" | "incompatible" | "invalid" | "shadowed" | "not_found";
  source?: "builtin" | "user" | "project";
  folder?: string;
  version?: string;
  sdkVersion?: string;
  /** "pending": the user has not allowed it yet and nothing runs. */
  consent?: "pending" | "granted" | "not_required" | "unknown";
  /** The extension's own switch at the project. */
  switch?: "on" | "off" | "unknown";
  diagnostics: { level: "error" | "warning"; message: string }[];
  /** Failures since the last reload, newest last (at most 20): backend errors, plus uncaught errors, unhandled rejections and CSP violations of the extension's frames (operation is "frame:<kind>/<id>"; frames report only after the user opens them). */
  recentErrors: { at: string; operation: string; code: string; message: string }[];
}`;
