import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ProviderCatalog,
  providerCatalogSchema,
} from "@nervekit/contracts";
import { EncryptedFileSecretProvider } from "../../secrets/index.js";

/** Secret names carrying provider/tool credentials (model, web, Jira, Confluence). */
const providerCredentialName = /^provider:.+:(?:apiKey|oauth)$/;

export type LegacyCredentialReadStatus = "read" | "failed";
export type LegacySettingsObject = Record<string, unknown>;

/** Portable user state staged for the migration ledger. */
export interface LegacyPortableState {
  /** Deliberately raw so appended migrations can preserve legacy-only fields. */
  settings?: LegacySettingsObject;
  providerCatalog?: ProviderCatalog;
  credentials: Array<[name: string, value: string]>;
  credentialStatus: LegacyCredentialReadStatus;
}

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

export async function readLegacyPortableState(
  home: string,
): Promise<LegacyPortableState> {
  return {
    settings: await readLegacySettings(home),
    providerCatalog: await readLegacyProviderCatalog(home),
    ...(await readLegacyProviderCredentials(home)),
  };
}

async function readOptionalRegularJson(
  path: string,
  source: "settings" | "providerCatalog",
): Promise<unknown | undefined> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") return undefined;
    throw new LegacyPortableStateError(
      `The legacy ${source === "settings" ? "config.json" : "providers.json"} could not be read.`,
      source,
      { cause },
    );
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new LegacyPortableStateError(
      `The legacy ${source === "settings" ? "config.json" : "providers.json"} is not a regular file.`,
      source,
    );
  }
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (cause) {
    throw new LegacyPortableStateError(
      `The legacy ${source === "settings" ? "config.json" : "providers.json"} could not be parsed.`,
      source,
      { cause },
    );
  }
}

async function readLegacySettings(
  home: string,
): Promise<LegacySettingsObject | undefined> {
  const raw = await readOptionalRegularJson(
    join(home, "config.json"),
    "settings",
  );
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new LegacyPortableStateError(
      "The legacy config.json does not contain a settings object.",
      "settings",
    );
  }
  return raw as LegacySettingsObject;
}

async function readLegacyProviderCatalog(
  home: string,
): Promise<ProviderCatalog | undefined> {
  const raw = await readOptionalRegularJson(
    join(home, "providers.json"),
    "providerCatalog",
  );
  if (raw === undefined) return undefined;
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
  const store = await regularFileStatus(storePath);
  if (store === "missing") return { credentials: [], credentialStatus: "read" };
  if (store !== "regular" || (await regularFileStatus(keyPath)) !== "regular") {
    return { credentials: [], credentialStatus: "failed" };
  }

  try {
    const secrets = new EncryptedFileSecretProvider(home);
    const names = (await secrets.list())
      .filter((name) => providerCredentialName.test(name))
      .sort();
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

async function regularFileStatus(
  path: string,
): Promise<"missing" | "regular" | "invalid"> {
  try {
    const stats = await lstat(path);
    return stats.isFile() && !stats.isSymbolicLink() ? "regular" : "invalid";
  } catch (error) {
    if (errorCode(error) === "ENOENT") return "missing";
    throw error;
  }
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
