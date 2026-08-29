import { join } from "node:path";
import {
  harnessConfigSchema,
  integrationsConfigSchema,
  providersConfigSchema,
  uiConfigSchema,
  type Settings,
  type UserConfiguration,
  userConfigurationSchema,
} from "@nervekit/contracts";
import type { InitializedStorage } from "../storage-bootstrap/initialize.js";
import { readJsonFile } from "../storage-bootstrap/json.js";
import { settingsFromConfiguration } from "./home-configuration.js";

export interface ConfigurationResolutionInput {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
}

/** Resolve portable project overrides without ever consulting project daemon, identity, or secret data. */
export async function resolveProjectConfiguration(
  storage: InitializedStorage,
  projectDir: string,
  input: ConfigurationResolutionInput = {},
): Promise<UserConfiguration> {
  const root = join(projectDir, ".nerve", "config");
  const [harnessRaw, uiRaw, providersRaw, integrationsRaw] = await Promise.all([
    optionalJson(join(root, "harness.json")),
    optionalJson(join(root, "ui.json")),
    optionalJson(join(root, "providers.json")),
    optionalJson(join(root, "integrations.json")),
  ]);
  const user = storage.configuration;
  let harness = harnessConfigSchema.parse(deepMerge(user.harness, harnessRaw));
  harness = applyHarnessEnvironment(harness, input.env ?? process.env);
  harness = applyHarnessArguments(harness, input.argv ?? process.argv.slice(2));
  return userConfigurationSchema.parse({
    daemon: user.daemon,
    harness,
    ui: uiConfigSchema.parse(deepMerge(user.ui, uiRaw)),
    permissions: user.permissions,
    providers: providersConfigSchema.parse(
      mergeProviders(user.providers, providersRaw),
    ),
    integrations: integrationsConfigSchema.parse(
      mergeIntegrations(user.integrations, integrationsRaw),
    ),
  });
}

export async function resolveProjectSettings(
  storage: InitializedStorage,
  projectDir: string,
  input?: ConfigurationResolutionInput,
): Promise<Settings> {
  // Small in-memory test hosts may provide only the already-resolved runtime
  // settings; production InitializedStorage always carries configuration.
  if (!storage.configuration) return storage.settings;
  return settingsFromConfiguration(
    await resolveProjectConfiguration(storage, projectDir, input),
  );
}

async function optionalJson(path: string): Promise<Record<string, unknown>> {
  return readJsonFile<unknown>(path)
    .then(asRecord)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return {};
      throw new Error(`Project configuration at ${path} is unreadable.`, {
        cause: error,
      });
    });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Project configuration document must be an object.");
  }
  return value as Record<string, unknown>;
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!override || typeof override !== "object" || Array.isArray(override))
    return override === undefined ? base : override;
  if (!base || typeof base !== "object" || Array.isArray(base)) return override;
  const output: Record<string, unknown> = {
    ...(base as Record<string, unknown>),
  };
  for (const [key, value] of Object.entries(override)) {
    output[key] = deepMerge(output[key], value);
  }
  return output;
}

function mergeKeyedDocument(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
  field: string,
  key: (value: unknown) => string,
): Record<string, unknown> {
  const merged = deepMerge(base, { ...override, [field]: undefined }) as Record<
    string,
    unknown
  >;
  const values = new Map<string, unknown>();
  for (const value of array(base[field])) values.set(key(value), value);
  for (const value of array(override[field])) {
    const id = key(value);
    values.set(id, deepMerge(values.get(id), value));
  }
  merged[field] = [...values.values()];
  return merged;
}

function mergeProviders(
  base: UserConfiguration["providers"],
  override: Record<string, unknown>,
): Record<string, unknown> {
  const merged = deepMerge(base, override) as Record<string, unknown>;
  merged.providers = mergeKeyedDocument(
    base,
    override,
    "providers",
    (provider) => stringKey(provider, "id"),
  ).providers;
  merged.models = mergeKeyedDocument(
    base,
    override,
    "models",
    (model) =>
      `${stringKey(model, "provider")}\0${stringKey(model, "modelId")}`,
  ).models;
  return merged;
}

function mergeIntegrations(
  base: UserConfiguration["integrations"],
  override: Record<string, unknown>,
): Record<string, unknown> {
  const merged = deepMerge(base, override) as Record<string, unknown>;
  const baseProfiles = asRecord(base.profiles);
  const overrideProfiles = override.profiles ? asRecord(override.profiles) : {};
  merged.profiles = {
    atlassian: mergeKeyedArray(
      baseProfiles.atlassian,
      overrideProfiles.atlassian,
      "id",
    ),
    tavily: mergeKeyedArray(baseProfiles.tavily, overrideProfiles.tavily, "id"),
  };
  return merged;
}

function mergeKeyedArray(
  base: unknown,
  override: unknown,
  field: string,
): unknown[] {
  const values = new Map<string, unknown>();
  for (const value of array(base)) values.set(stringKey(value, field), value);
  for (const value of array(override)) {
    const id = stringKey(value, field);
    values.set(id, deepMerge(values.get(id), value));
  }
  return [...values.values()];
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringKey(value: unknown, field: string): string {
  const record = asRecord(value);
  const key = record[field];
  if (typeof key !== "string" || key.length === 0) {
    throw new Error(`Project configuration entry is missing '${field}'.`);
  }
  return key;
}

function applyHarnessEnvironment(
  harness: UserConfiguration["harness"],
  env: NodeJS.ProcessEnv,
): UserConfiguration["harness"] {
  return harnessConfigSchema.parse({
    ...harness,
    defaults: {
      ...harness.defaults,
      ...(env.NERVE_DEFAULT_MODE ? { mode: env.NERVE_DEFAULT_MODE } : {}),
      ...(env.NERVE_DEFAULT_PERMISSION_LEVEL
        ? { permissionLevel: env.NERVE_DEFAULT_PERMISSION_LEVEL }
        : {}),
      ...(env.NERVE_DEFAULT_MODEL_PROVIDER && env.NERVE_DEFAULT_MODEL_ID
        ? {
            model: {
              provider: env.NERVE_DEFAULT_MODEL_PROVIDER,
              modelId: env.NERVE_DEFAULT_MODEL_ID,
            },
          }
        : {}),
      ...(env.NERVE_DEFAULT_THINKING_LEVEL
        ? { thinkingLevel: env.NERVE_DEFAULT_THINKING_LEVEL }
        : {}),
    },
  });
}

function applyHarnessArguments(
  harness: UserConfiguration["harness"],
  argv: string[],
): UserConfiguration["harness"] {
  const values = new Map(
    argv.flatMap((argument) => {
      const match =
        /^--(default-mode|default-permission-level|default-model|default-thinking-level)=(.+)$/.exec(
          argument,
        );
      return match ? [[match[1], match[2]] as const] : [];
    }),
  );
  const model = values.get("default-model")?.split("/", 2);
  return harnessConfigSchema.parse({
    ...harness,
    defaults: {
      ...harness.defaults,
      ...(values.get("default-mode")
        ? { mode: values.get("default-mode") }
        : {}),
      ...(values.get("default-permission-level")
        ? { permissionLevel: values.get("default-permission-level") }
        : {}),
      ...(model?.[0] && model[1]
        ? { model: { provider: model[0], modelId: model[1] } }
        : {}),
      ...(values.get("default-thinking-level")
        ? { thinkingLevel: values.get("default-thinking-level") }
        : {}),
    },
  });
}
