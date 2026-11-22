import { isDeepStrictEqual } from "node:util";
import {
  manifestDefinitionData,
  type InstalledExtensionManifest,
} from "@nervekit/contracts/extensions";
import type { ExtensionDefinition } from "@nervekit/extension-api";
import { createHash } from "node:crypto";
import {
  describeCredentialBundle,
  readSandboxedDefinitionData,
} from "@nervekit/tools/extension-host";
import type { ExtensionCredentialCode } from "../../../domains/accounts/extension-credential-provider.js";
import { distReader, maxBundleBytes } from "./read-installed.js";

/** An installed extension whose backend matches its manifest. */
export type LoadedInstalledExtension = {
  /**
   * The definition the registry uses: the manifest's data, hooks marked `true`. Its code is
   * never run in the host process; the sandbox adapter serves every hook from `bundle`.
   */
  definition: ExtensionDefinition;
  /** The classic script that registers the definition in the sandbox. */
  bundle: string;
  /** The credential provider code (`dist/credentials.js`), verified against the manifest. */
  credentials?: ExtensionCredentialCode;
};

/**
 * Reads `dist/credentials.js` and checks it against the manifest: its hash is what the user
 * consented to, and the operations it implements must be the ones the manifest lists. Account
 * kinds that name `provider: "extension"` need it, and it needs one.
 */
async function loadCredentialCode(
  folder: string,
  manifest: InstalledExtensionManifest,
): Promise<ExtensionCredentialCode | undefined | { error: string }> {
  const wanted = Object.values(manifest.accounts ?? {}).some(
    (kind) => kind.provider === "extension",
  );
  const declared = manifest.credentials;
  if (wanted && !declared)
    return {
      error:
        'An account kind names provider "extension" but the extension ships no dist/credentials.js. Add src/credentials.ts and rebuild.',
    };
  if (!declared) return undefined;
  if (!wanted)
    return {
      error:
        'dist/credentials.js is shipped but no account kind names provider "extension". Remove src/credentials.ts or set the provider.',
    };
  let bundle: string;
  try {
    bundle = distReader(`${folder}/dist`)("credentials.js", maxBundleBytes);
  } catch (cause) {
    return {
      error: `Cannot read dist/credentials.js: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  const sha256 = createHash("sha256").update(bundle).digest("hex");
  if (sha256 !== declared.sha256)
    return {
      error:
        "dist/credentials.js does not match the hash in dist/manifest.json. Rebuild the extension.",
    };
  let operations: string[];
  try {
    operations = await describeCredentialBundle(bundle);
  } catch (cause) {
    return {
      error: `dist/credentials.js did not load: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  if ([...operations].sort().join() !== [...declared.operations].sort().join())
    return {
      error: `dist/credentials.js implements ${operations.join(", ")}, but dist/manifest.json lists ${declared.operations.join(", ")}. Rebuild the extension.`,
    };
  return {
    extensionId: manifest.id,
    bundle,
    sha256,
    operations: declared.operations,
  };
}

/** The first place two plain-data values differ, as `a.b[0].c: <one> vs <other>`. */
export function firstDifference(
  manifest: unknown,
  code: unknown,
  path = "",
): string | undefined {
  if (isDeepStrictEqual(manifest, code)) return undefined;
  const show = (value: unknown) => {
    const text = JSON.stringify(value);
    return text === undefined
      ? "nothing"
      : text.length > 80
        ? `${text.slice(0, 77)}...`
        : text;
  };
  const at = path || "(definition)";
  const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  if (Array.isArray(manifest) && Array.isArray(code)) {
    if (manifest.length !== code.length)
      return `${at}: manifest.json lists ${manifest.length} entries, the code ${code.length}`;
    for (let index = 0; index < manifest.length; index++) {
      const difference = firstDifference(
        manifest[index],
        code[index],
        `${path}[${index}]`,
      );
      if (difference) return difference;
    }
  }
  if (isObject(manifest) && isObject(code)) {
    for (const key of new Set([
      ...Object.keys(manifest),
      ...Object.keys(code),
    ])) {
      const child = path ? `${path}.${key}` : key;
      const difference = firstDifference(manifest[key], code[key], child);
      if (difference) return difference;
    }
  }
  return `${at}: manifest.json says ${show(manifest)}, the code says ${show(code)}`;
}

/**
 * Opens `dist/backend.js` in a sandbox runtime and compares the definition it registers with
 * `manifest.json`. A difference refuses the extension, so the manifest cannot understate what
 * the code does. Callers consult the trust gate first: this runs the bundle's top level.
 */
export async function loadInstalledExtension(
  folder: string,
  manifest: InstalledExtensionManifest,
): Promise<LoadedInstalledExtension | { error: string }> {
  let bundle: string;
  try {
    bundle = distReader(`${folder}/dist`)("backend.js", maxBundleBytes);
  } catch (cause) {
    return {
      error: `Cannot read dist/backend.js: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  let data: unknown;
  try {
    data = await readSandboxedDefinitionData({ id: manifest.id, bundle });
  } catch (cause) {
    return {
      error: `dist/backend.js did not load: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  // Plain data on both sides: JSON drops what has no value.
  const fromManifest = JSON.parse(
    JSON.stringify(manifestDefinitionData(manifest)),
  );
  const difference = firstDifference(
    fromManifest,
    JSON.parse(JSON.stringify(data ?? null)),
  );
  if (difference)
    return {
      error: `dist/backend.js registers a different definition than dist/manifest.json (${difference}). Rebuild the extension so both match.`,
    };
  const credentials = await loadCredentialCode(folder, manifest);
  if (credentials && "error" in credentials) return credentials;
  return {
    definition: fromManifest as ExtensionDefinition,
    bundle,
    ...(credentials ? { credentials } : {}),
  };
}
