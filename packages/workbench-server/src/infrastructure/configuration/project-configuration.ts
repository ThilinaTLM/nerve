import { lstat } from "node:fs/promises";
import {
  atomicReplaceFile,
  withFileMutation,
} from "../storage-bootstrap/file-mutations.js";
import { join } from "node:path";
import {
  harnessConfigSchema,
  projectHarnessOverridesSchema,
  projectHarnessValuesSchema,
  projectSettingsPatchSchema,
  type ProjectSettingsPatch,
  type ProjectSettingsResult,
  type Settings,
  type UserConfiguration,
  userConfigurationSchema,
} from "@nervekit/contracts/settings";
import type { InitializedStorage } from "../storage-bootstrap/initialize.js";
import { readJsonFile } from "../storage-bootstrap/json.js";
import { settingsFromConfiguration } from "./home-configuration.js";
import { HOME_CONFIGURATION_CODECS } from "./home-configuration-codecs.js";
import { projectConfigurationRoot } from "./scope-paths.js";

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
  const root = projectConfigurationRoot(projectDir);
  const harnessRaw = await optionalJson(join(root, "harness.json"));
  const user = storage.configuration;
  const harness = resolveHarness(storage, harnessRaw, input);
  return userConfigurationSchema.parse({
    daemon: user.daemon,
    harness,
    ui: user.ui,
    permissions: user.permissions,
    providers: user.providers,
    integrations: user.integrations,
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

function assertNoLegacyCapabilitySelection(
  harness: Record<string, unknown>,
): void {
  const tools = asOptionalRecord(harness.tools);
  const skills = asOptionalRecord(harness.skills);
  const agentBrowser = asOptionalRecord(skills?.agentBrowser);
  if (
    (tools && Object.hasOwn(tools, "disabled")) ||
    (skills && Object.hasOwn(skills, "disabled")) ||
    (agentBrowser && Object.hasOwn(agentBrowser, "enabled"))
  ) {
    throw new Error(
      "Project tool and skill selections in .nerve/config/harness.json must be migrated to .nerve/config/capabilities.json.",
    );
  }
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
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
    Object.defineProperty(output, key, {
      value: deepMerge(
        Object.hasOwn(output, key) ? output[key] : undefined,
        value,
      ),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return output;
}

function applyHarnessEnvironment(
  harness: UserConfiguration["harness"],
  env: NodeJS.ProcessEnv,
): UserConfiguration["harness"] {
  return harnessConfigSchema.parse({
    ...harness,
    defaults: {
      ...harness.defaults,
      ...(env.NERVE_DEFAULT_PERMISSION_RULE_SET_ID
        ? { permissionRuleSetId: env.NERVE_DEFAULT_PERMISSION_RULE_SET_ID }
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
        /^--(default-permission-rule-set-id|default-model|default-thinking-level)=(.+)$/.exec(
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
      ...(values.get("default-permission-rule-set-id")
        ? { permissionRuleSetId: values.get("default-permission-rule-set-id") }
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

function resolveHarness(
  storage: InitializedStorage,
  raw: Record<string, unknown>,
  input: ConfigurationResolutionInput = {},
) {
  assertNoLegacyCapabilitySelection(raw);
  projectHarnessOverridesSchema.parse(raw);
  const known = projectHarnessValuesSchema.parse(raw);
  let harness = HOME_CONFIGURATION_CODECS.harness.decode(
    deepMerge(storage.configuration.harness, known),
  );
  harness = applyHarnessEnvironment(harness, input.env ?? process.env);
  return applyHarnessArguments(harness, input.argv ?? process.argv.slice(2));
}

function projectHarnessResult(
  storage: InitializedStorage,
  raw: Record<string, unknown>,
): ProjectSettingsResult {
  return {
    overrides: projectHarnessOverridesSchema.parse(raw),
    inherited: storage.configuration.harness,
    effective: resolveHarness(storage, raw),
  };
}

/** Reject configuration symlinks before either reading or creating directories. */
async function assertProjectHarnessPath(projectDir: string): Promise<void> {
  for (const path of [
    projectDir,
    join(projectDir, ".nerve"),
    projectConfigurationRoot(projectDir),
    join(projectConfigurationRoot(projectDir), "harness.json"),
  ]) {
    try {
      if ((await lstat(path)).isSymbolicLink())
        throw new Error(
          "Project harness configuration must not use symbolic links.",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

export function readProjectHarnessSettings(
  storage: InitializedStorage,
  projectDir: string,
): Promise<ProjectSettingsResult> {
  const path = join(projectConfigurationRoot(projectDir), "harness.json");
  return withFileMutation(path, async () => {
    await assertProjectHarnessPath(projectDir);
    return projectHarnessResult(storage, await optionalJson(path));
  });
}

/** Null deletes keys recursively, objects merge, and arrays/scalars replace. */
function patchHarness(
  raw: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...raw };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else
      Object.defineProperty(next, key, {
        value: asOptionalRecord(value)
          ? patchHarness(
              asOptionalRecord(next[key]) ?? {},
              value as Record<string, unknown>,
            )
          : value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  return next;
}

export async function updateProjectHarnessSettings(
  storage: InitializedStorage,
  projectDir: string,
  patch: ProjectSettingsPatch,
): Promise<ProjectSettingsResult> {
  const parsed = projectSettingsPatchSchema.parse(patch);
  const path = join(projectConfigurationRoot(projectDir), "harness.json");
  let result!: ProjectSettingsResult;
  let next: Record<string, unknown>;
  // prepare runs inside the shared per-file mutation queue: read/modify/write is
  // serialized with other filesystem writers, not just this API's own calls.
  await atomicReplaceFile(
    path,
    async (handle) => {
      await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`);
    },
    {
      prepare: async () => {
        await assertProjectHarnessPath(projectDir);
        const current = await optionalJson(path);
        projectHarnessResult(storage, current); // Never overwrite an invalid document.
        next = patchHarness(current, parsed);
        result = projectHarnessResult(storage, next); // Validate before touching disk.
        return { mode: 0o600 };
      },
    },
  );
  return result;
}
