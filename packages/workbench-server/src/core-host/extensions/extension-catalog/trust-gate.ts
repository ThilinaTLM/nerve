import type {
  ExtensionConsent,
  InstalledExtensionManifest,
} from "@nervekit/contracts/extensions";

/** What the gate decided about one installed extension. */
export type ExtensionTrustDecision =
  /** The user consented: the extension may be registered and its code opened. */
  | "trusted"
  /** Nothing has been consented to: the extension is listed, but never registered or run. */
  | "pending";

/** An installed extension as the gate sees it: read and validated, no code run. */
export type InstalledExtensionCandidate = {
  id: string;
  source: "user" | "project";
  /** Absolute path of the extension folder; its `dist/` is what loads. */
  folder: string;
  /** The project directory of a project extension. */
  projectDir?: string;
  manifest: InstalledExtensionManifest;
};

/** A decision with what the user must review, for `pending`. */
export type ExtensionTrustVerdict = {
  decision: ExtensionTrustDecision;
  consent?: ExtensionConsent;
};

/** Which installed extension a consent operation is about. */
export type InstalledExtensionKey = Pick<
  InstalledExtensionCandidate,
  "id" | "source" | "folder" | "projectDir"
>;

/**
 * Consulted before an installed extension is included in any registry, and before its code is
 * opened. The host's gate is `ExtensionConsentRepository`; consent and the enabled switch change only through
 * the operations here, which the catalog exposes to the user's Settings page and to nothing else.
 */
export interface ExtensionTrustGate {
  decide(
    candidate: InstalledExtensionCandidate,
  ):
    | ExtensionTrustDecision
    | ExtensionTrustVerdict
    | Promise<ExtensionTrustDecision | ExtensionTrustVerdict>;
  /** Records consent for the content the user reviewed; false when the files changed since (`contentHash`). */
  grant?(
    candidate: InstalledExtensionCandidate,
    contentHash: string,
  ): Promise<boolean>;
  /** Withdraws consent: the extension is pending again. */
  revoke?(key: InstalledExtensionKey): Promise<void>;
}

/** Nothing installed runs. A gate for tests that need the safe default. */
export const pendingConsentGate: ExtensionTrustGate = {
  decide: () => "pending",
};

/** Test override: `decide` answers per extension (everything trusted by default). */
export function overrideTrustGate(
  decide: (
    candidate: InstalledExtensionCandidate,
  ) => ExtensionTrustDecision = () => "trusted",
): ExtensionTrustGate {
  return { decide };
}
