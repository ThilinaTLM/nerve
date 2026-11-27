import type { Source } from "@nervekit/contracts/core";
/**
 * What a script may do to the installed extensions of its conversation's project: re-read one and
 * read how it fared. Deliberately small: no consent surface (granting, revoking, the reviewed
 * content hash) exists here; only the user's Settings page changes consent.
 */
import type { Diagnostic } from "@nervekit/contracts/configuration";

/** One backend failure the host saw while running the extension's code, newest last. */
export type ExtensionAgentError = {
  /** ISO time. */
  at: string;
  /** Hook that failed: `run`, `parse`, `authorize`, ... */
  operation: string;
  /** `ExtensionError` code or the error name. */
  code: string;
  message: string;
};

export type ExtensionAgentStatus = {
  id: string;
  /** `not_found`: no folder or built-in has this id at the project. */
  state:
    | "enabled"
    | "pending_consent"
    | "incompatible"
    | "invalid"
    | "shadowed"
    | "not_found";
  source?: Source;
  /** Folder of an installed extension. */
  folder?: string;
  version?: string;
  sdkVersion?: string;
  /**
   * `needs_review`: the user has not decided yet, so nothing runs. `declined`: the user declined it, so nothing runs.
   * `granted`: allowed and loaded.
   * `not_required`: built in. `unknown`: the extension is invalid, incompatible or shadowed, so no consent was asked.
   */
  consent?:
    | "needs_review"
    | "declined"
    | "granted"
    | "not_required"
    | "unknown";
  /** The extension's own on/off switch at the project (a loaded extension that is off contributes nothing). */
  switch?: "on" | "off" | "unknown";
  diagnostics: Diagnostic[];
  recentErrors: ExtensionAgentError[];
};

export interface ExtensionAgentPort {
  /** Re-reads the extension's folder and consults the trust gate again; never grants consent. */
  reload(id: string): Promise<ExtensionAgentStatus>;
  status(id: string): Promise<ExtensionAgentStatus>;
}
