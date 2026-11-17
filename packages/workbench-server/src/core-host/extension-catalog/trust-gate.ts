import type { InstalledExtensionManifest } from "@nervekit/contracts/extensions";

/** What the gate decided about one installed extension. */
export type ExtensionTrustDecision =
  /** The user consented: the extension may be registered and its code opened. */
  | "trusted"
  /** Nothing has been consented to: the extension is listed, but never registered or run. */
  | "pending"
  /** The user turned the extension off. */
  | "disabled";

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

/**
 * Consulted before an installed extension is included in any registry, and before its code is
 * opened. Consent (content hashes, the update diff, the Settings action) arrives with the trust
 * step; the interface is what that step implements.
 */
export interface ExtensionTrustGate {
  decide(
    candidate: InstalledExtensionCandidate,
  ): ExtensionTrustDecision | Promise<ExtensionTrustDecision>;
}

/** The default until consent exists: nothing installed runs. */
export const pendingConsentGate: ExtensionTrustGate = {
  decide: () => "pending",
};

/** Test and development override: `decide` answers per extension (everything trusted by default). */
export function overrideTrustGate(
  decide: (
    candidate: InstalledExtensionCandidate,
  ) => ExtensionTrustDecision = () => "trusted",
): ExtensionTrustGate {
  return { decide };
}

/** Environment variable that makes `defaultTrustGate` trust every installed extension; for development of extensions only. */
export const TRUST_ALL_EXTENSIONS_ENV = "NERVE_DEV_TRUST_ALL_EXTENSIONS";

/** The host's gate: pending for everything, unless the development override is set. */
export function defaultTrustGate(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ExtensionTrustGate {
  return env[TRUST_ALL_EXTENSIONS_ENV] === "1"
    ? overrideTrustGate()
    : pendingConsentGate;
}
