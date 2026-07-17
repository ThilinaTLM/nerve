import { join } from "node:path";
import {
  defaultSettings,
  type ProviderCatalog,
  providerCatalogSchema,
  type Settings,
  settingsSchema,
} from "@nervekit/contracts";
import { EncryptedFileSecretProvider } from "../secrets/index.js";
import { pathExists, readJsonFile } from "./json.js";

/** Secret names carrying provider/tool credentials (model, web, Jira, Confluence). */
const providerCredentialName = /^provider:.+:(?:apiKey|oauth)$/;

export type LegacyCredentialReadStatus = "read" | "failed";

/**
 * Portable user state recovered from a legacy Nerve home: validated settings,
 * the custom provider/model catalog, and provider/tool credentials. Secret
 * values never appear in logs or result metadata; only names and counts do.
 */
export interface LegacyPortableState {
  /** Merged and validated settings, present when the legacy home had a config file. */
  settings?: Settings;
  /** Validated custom provider/model catalog, present when providers.json existed. */
  providerCatalog?: ProviderCatalog;
  /** Decrypted provider/tool credential pairs to re-encrypt in the new home. */
  credentials: Array<[name: string, value: string]>;
  /** `failed` when an encrypted store existed but could not be decrypted. */
  credentialStatus: LegacyCredentialReadStatus;
}

/**
 * Raised when required portable state (settings or provider catalog) exists but
 * is malformed. The migration coordinator treats this as fatal and rolls back
 * instead of silently dropping requested user state.
 */
export class LegacyPortableStateError extends Error {
  constructor(
    message: string,
    readonly source: "settings" | "providerCatalog",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LegacyPortableStateError";
  }
}

/**
 * Reads portable user state from a (backed up) legacy home. Missing files mean
 * the corresponding state is absent; malformed settings or catalog data throws
 * `LegacyPortableStateError`. An unreadable encrypted credential store is
 * reported as a nonfatal `failed` status because the retained backup preserves
 * it and the secrets cannot safely be reconstructed.
 */
export async function readLegacyPortableState(
  home: string,
): Promise<LegacyPortableState> {
  return {
    settings: await readLegacySettings(home),
    providerCatalog: await readLegacyProviderCatalog(home),
    ...(await readLegacyProviderCredentials(home)),
  };
}

async function readLegacySettings(home: string): Promise<Settings | undefined> {
  const configPath = join(home, "config.json");
  if (!(await pathExists(configPath))) return undefined;
  let raw: unknown;
  try {
    raw = await readJsonFile<unknown>(configPath);
  } catch (cause) {
    throw new LegacyPortableStateError(
      "The legacy config.json could not be parsed.",
      "settings",
      { cause },
    );
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new LegacyPortableStateError(
      "The legacy config.json does not contain a settings object.",
      "settings",
    );
  }
  const parsed = settingsSchema.safeParse({ ...defaultSettings, ...raw });
  if (!parsed.success) {
    throw new LegacyPortableStateError(
      "The legacy config.json does not match the settings schema.",
      "settings",
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

async function readLegacyProviderCatalog(
  home: string,
): Promise<ProviderCatalog | undefined> {
  const providersPath = join(home, "providers.json");
  if (!(await pathExists(providersPath))) return undefined;
  let raw: unknown;
  try {
    raw = await readJsonFile<unknown>(providersPath);
  } catch (cause) {
    throw new LegacyPortableStateError(
      "The legacy providers.json could not be parsed.",
      "providerCatalog",
      { cause },
    );
  }
  const parsed = providerCatalogSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LegacyPortableStateError(
      "The legacy providers.json does not match the provider catalog schema.",
      "providerCatalog",
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

async function readLegacyProviderCredentials(home: string): Promise<{
  credentials: Array<[name: string, value: string]>;
  credentialStatus: LegacyCredentialReadStatus;
}> {
  const keyPath = join(home, "keys", "master.key");
  const storePath = join(home, "keys", "secrets.json.enc");
  if (!(await pathExists(storePath))) {
    return { credentials: [], credentialStatus: "read" };
  }
  if (!(await pathExists(keyPath))) {
    return { credentials: [], credentialStatus: "failed" };
  }

  try {
    const secrets = new EncryptedFileSecretProvider(home);
    const names = (await secrets.list()).filter((name) =>
      providerCredentialName.test(name),
    );
    const credentials: Array<[name: string, value: string]> = [];
    for (const name of names) {
      const value = await secrets.get(name);
      if (value !== undefined) credentials.push([name, value]);
    }
    return { credentials, credentialStatus: "read" };
  } catch {
    return { credentials: [], credentialStatus: "failed" };
  }
}
