// biome-ignore lint/style/noExcessiveLinesPerFile: Create sandbox form state intentionally keeps config mapping, validation, and persistence together.
import {
  type SandboxConfigV1,
  type SandboxCreateConfigInput,
  type SandboxCreateRequest,
  type SandboxSecretRef,
  sandboxConfigV1Schema,
  sandboxCreateConfigInputSchema,
  sandboxCreateRequestSchema,
  type ThinkingLevel,
  thinkingLevels,
} from "@nervekit/shared";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export type CreateSandboxToolKey =
  | "fileInspection"
  | "fileEditing"
  | "planMode"
  | "todos"
  | "shell"
  | "python"
  | "taskManagement"
  | "explore"
  | "web"
  | "jira"
  | "confluence";

export const CREATE_SANDBOX_TOOL_KEYS: CreateSandboxToolKey[] = [
  "fileInspection",
  "fileEditing",
  "planMode",
  "todos",
  "shell",
  "python",
  "taskManagement",
  "explore",
  "web",
  "jira",
  "confluence",
];

export const CREATE_SANDBOX_PREFERENCES_STORAGE_KEY =
  "nerve.sandboxManager.createSandboxPreferences";

export type CreateSandboxDisconnectPolicyMode =
  | "exit_self"
  | "stay_reconnecting";
export type CreateSandboxBootMode = "single" | "phases";
export type CreateSandboxBootRunAs = "sandbox" | "root" | "";
export type CreateSandboxBootNetwork =
  | "inherit"
  | "deny"
  | "package_registries_only"
  | "";
export type CreateSandboxBootOnFailure = "fail_sandbox" | "continue_readonly";
export type CreateSandboxBootSecretRefType = "env" | "file" | "kv";

export type CreateSandboxBootSecretEnvDraft = {
  id: string;
  name: string;
  refType: CreateSandboxBootSecretRefType;
  value: string;
  store: string;
  version: string;
};

export type CreateSandboxBootPhaseDraft = {
  id: string;
  name: string;
  script: string;
  timeoutSeconds: string;
  runAs: CreateSandboxBootRunAs;
  network: CreateSandboxBootNetwork;
  env: CreateSandboxBootSecretEnvDraft[];
};

type CreateSandboxPreferenceStorage = Pick<Storage, "getItem" | "setItem">;

type PersistedCreateSandboxBootSecretEnvPreference = {
  name?: string;
  refType?: CreateSandboxBootSecretRefType;
  value?: string;
  store?: string;
  version?: string;
};

type PersistedCreateSandboxBootPhasePreference = {
  name?: string;
  script?: string;
  timeoutSeconds?: string;
  runAs?: CreateSandboxBootRunAs;
  network?: CreateSandboxBootNetwork;
  env?: PersistedCreateSandboxBootSecretEnvPreference[];
};

type PersistedCreateSandboxPreferences = {
  version: 1;
  image?: string;
  labels?: string;
  startAfterCreate?: boolean;
  mainProvider?: string;
  mainModel?: string;
  mainThinking?: ThinkingLevel;
  exploreProvider?: string;
  exploreModel?: string;
  initialPrompt?: string;
  systemPromptAmendment?: string;
  mode?: CreateSandboxDraft["mode"];
  permissionLevel?: CreateSandboxDraft["permissionLevel"];
  disconnectPolicyMode?: CreateSandboxDisconnectPolicyMode;
  disconnectExitAfterSeconds?: string;
  tools?: Partial<Record<CreateSandboxToolKey, boolean>>;
  mainModelProfileId?: string;
  exploreModelProfileId?: string;
  gitIdentityProfileId?: string;
  gitCredentialProfileIds?: string[];
  githubProfileId?: string;
  jiraProfileId?: string;
  confluenceProfileId?: string;
  webProfileId?: string;
  bootEnabled?: boolean;
  bootMode?: CreateSandboxBootMode;
  bootScript?: string;
  bootTimeoutSeconds?: string;
  bootRunAs?: "sandbox" | "root";
  bootNetwork?: "inherit" | "deny" | "package_registries_only";
  bootOnFailure?: CreateSandboxBootOnFailure;
  bootPhases?: PersistedCreateSandboxBootPhasePreference[];
};

const readableAdjectives = [
  "amber",
  "brave",
  "bright",
  "calm",
  "clear",
  "cosmic",
  "daring",
  "gentle",
  "golden",
  "hidden",
  "lively",
  "lunar",
  "nimble",
  "quiet",
  "rapid",
  "silver",
  "steady",
  "swift",
  "verdant",
  "vivid",
];

const readableNouns = [
  "atlas",
  "beacon",
  "branch",
  "brook",
  "canvas",
  "comet",
  "ember",
  "forest",
  "harbor",
  "meadow",
  "matrix",
  "orbit",
  "prairie",
  "quartz",
  "river",
  "signal",
  "summit",
  "thread",
  "valley",
  "voyage",
];

const readableObjects = [
  "anchor",
  "bridge",
  "citadel",
  "compass",
  "engine",
  "garden",
  "lantern",
  "mirror",
  "needle",
  "notebook",
  "portal",
  "rocket",
  "shelter",
  "station",
  "studio",
  "terminal",
  "tower",
  "workshop",
  "zephyr",
  "zenith",
];

export type CreateSandboxDraft = {
  name: string;
  sandboxId: string;
  image: string;
  labels: string;
  startAfterCreate: boolean;
  mainProvider: string;
  mainModel: string;
  mainThinking: ThinkingLevel;
  exploreProvider: string;
  exploreModel: string;
  initialPrompt: string;
  systemPromptAmendment: string;
  mode: "normal" | "planning";
  permissionLevel: "read_only" | "supervised" | "autonomous";
  disconnectPolicyMode: CreateSandboxDisconnectPolicyMode;
  disconnectExitAfterSeconds: string;
  tools: Record<CreateSandboxToolKey, boolean>;
  mainModelProfileId: string;
  exploreModelProfileId: string;
  gitIdentityProfileId: string;
  gitCredentialProfileIds: string[];
  githubProfileId: string;
  jiraProfileId: string;
  confluenceProfileId: string;
  webProfileId: string;
  bootEnabled: boolean;
  bootMode: CreateSandboxBootMode;
  bootScript: string;
  bootTimeoutSeconds: string;
  bootRunAs: "sandbox" | "root";
  bootNetwork: "inherit" | "deny" | "package_registries_only";
  bootOnFailure: CreateSandboxBootOnFailure;
  bootPhases: CreateSandboxBootPhaseDraft[];
  yamlSource: string;
  yamlDirty: boolean;
};

export function createReadableSandboxIdentity(): {
  name: string;
  sandboxId: string;
} {
  const slug = [
    readableAdjectives[randomIndex(readableAdjectives.length)],
    readableNouns[randomIndex(readableNouns.length)],
    readableObjects[randomIndex(readableObjects.length)],
  ].join("-");
  return { name: slug, sandboxId: slug };
}

function randomIndex(length: number): number {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef?.getRandomValues) {
    const values = new Uint32Array(1);
    cryptoRef.getRandomValues(values);
    return values[0] % length;
  }
  return Math.floor(Math.random() * length);
}

function createDraftId(prefix: string): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef?.randomUUID) return `${prefix}_${cryptoRef.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}`;
}

export function createDefaultBootSecretEnv(): CreateSandboxBootSecretEnvDraft {
  return {
    id: createDraftId("boot_env"),
    name: "",
    refType: "env",
    value: "",
    store: "",
    version: "",
  };
}

export function createDefaultBootPhase(index = 0): CreateSandboxBootPhaseDraft {
  const names = ["setup", "install", "prepare"];
  return {
    id: createDraftId("boot_phase"),
    name: names[index] ?? `phase-${index + 1}`,
    script: "",
    timeoutSeconds: "",
    runAs: "",
    network: "",
    env: [],
  };
}

export function createDefaultDraft(): CreateSandboxDraft {
  const identity = createReadableSandboxIdentity();
  return {
    name: identity.name,
    sandboxId: identity.sandboxId,
    image: "",
    labels: "",
    startAfterCreate: true,
    mainProvider: "anthropic",
    mainModel: "claude-sonnet-4-5",
    mainThinking: "off",
    exploreProvider: "",
    exploreModel: "",
    initialPrompt: "",
    systemPromptAmendment: "",
    mode: "normal",
    permissionLevel: "autonomous",
    disconnectPolicyMode: "exit_self",
    disconnectExitAfterSeconds: "300",
    tools: {
      fileInspection: true,
      fileEditing: true,
      planMode: true,
      todos: true,
      shell: true,
      python: false,
      taskManagement: false,
      explore: false,
      web: false,
      jira: false,
      confluence: false,
    },
    mainModelProfileId: "",
    exploreModelProfileId: "",
    gitIdentityProfileId: "",
    gitCredentialProfileIds: [],
    githubProfileId: "",
    jiraProfileId: "",
    confluenceProfileId: "",
    webProfileId: "",
    bootEnabled: false,
    bootMode: "single",
    bootScript: "",
    bootTimeoutSeconds: "600",
    bootRunAs: "sandbox",
    bootNetwork: "inherit",
    bootOnFailure: "fail_sandbox",
    bootPhases: [],
    yamlSource: "",
    yamlDirty: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function thinkingValue(value: unknown): ThinkingLevel | undefined {
  return typeof value === "string" &&
    thinkingLevels.includes(value as ThinkingLevel)
    ? (value as ThinkingLevel)
    : undefined;
}

function modeValue(value: unknown): CreateSandboxDraft["mode"] | undefined {
  return value === "normal" || value === "planning" ? value : undefined;
}

function permissionLevelValue(
  value: unknown,
): CreateSandboxDraft["permissionLevel"] | undefined {
  return value === "read_only" ||
    value === "supervised" ||
    value === "autonomous"
    ? value
    : undefined;
}

function disconnectPolicyModeValue(
  value: unknown,
): CreateSandboxDisconnectPolicyMode | undefined {
  return value === "exit_self" || value === "stay_reconnecting"
    ? value
    : undefined;
}

function bootModeValue(value: unknown): CreateSandboxBootMode | undefined {
  return value === "single" || value === "phases" ? value : undefined;
}

function bootRunAsValue(value: unknown): "sandbox" | "root" | undefined {
  return value === "sandbox" || value === "root" ? value : undefined;
}

function bootNetworkValue(
  value: unknown,
): "inherit" | "deny" | "package_registries_only" | undefined {
  return value === "inherit" ||
    value === "deny" ||
    value === "package_registries_only"
    ? value
    : undefined;
}

function bootOnFailureValue(
  value: unknown,
): CreateSandboxBootOnFailure | undefined {
  return value === "fail_sandbox" || value === "continue_readonly"
    ? value
    : undefined;
}

function bootPhaseRunAsValue(
  value: unknown,
): CreateSandboxBootRunAs | undefined {
  return value === "" ? value : bootRunAsValue(value);
}

function bootPhaseNetworkValue(
  value: unknown,
): CreateSandboxBootNetwork | undefined {
  return value === "" ? value : bootNetworkValue(value);
}

function bootSecretRefTypeValue(
  value: unknown,
): CreateSandboxBootSecretRefType | undefined {
  return value === "env" || value === "file" || value === "kv"
    ? value
    : undefined;
}

function storedBootSecretEnvRows(
  value: unknown,
): CreateSandboxBootSecretEnvDraft[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((row) => ({
    id: createDraftId("boot_env"),
    name: stringValue(row.name) ?? "",
    refType: bootSecretRefTypeValue(row.refType) ?? "env",
    value: stringValue(row.value) ?? "",
    store: stringValue(row.store) ?? "",
    version: stringValue(row.version) ?? "",
  }));
}

function storedBootPhases(
  value: unknown,
): CreateSandboxBootPhaseDraft[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((phase) => ({
    id: createDraftId("boot_phase"),
    name: stringValue(phase.name) ?? "",
    script: stringValue(phase.script) ?? "",
    timeoutSeconds: stringValue(phase.timeoutSeconds) ?? "",
    runAs: bootPhaseRunAsValue(phase.runAs) ?? "",
    network: bootPhaseNetworkValue(phase.network) ?? "",
    env: storedBootSecretEnvRows(phase.env) ?? [],
  }));
}

function storageOrDefault(
  storage?: CreateSandboxPreferenceStorage,
): CreateSandboxPreferenceStorage | undefined {
  if (storage) return storage;
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

function readStoredPreferences(
  storage?: CreateSandboxPreferenceStorage,
): PersistedCreateSandboxPreferences | undefined {
  const target = storageOrDefault(storage);
  if (!target) return undefined;
  try {
    const raw = target.getItem(CREATE_SANDBOX_PREFERENCES_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1) return undefined;
    return parsed as PersistedCreateSandboxPreferences;
  } catch {
    return undefined;
  }
}

export function createDraftFromStoredPreferences(
  storage?: CreateSandboxPreferenceStorage,
): CreateSandboxDraft {
  const draft = createDefaultDraft();
  const stored = readStoredPreferences(storage);
  if (!stored) return draft;

  draft.image = stringValue(stored.image) ?? draft.image;
  draft.labels = stringValue(stored.labels) ?? draft.labels;
  draft.startAfterCreate =
    booleanValue(stored.startAfterCreate) ?? draft.startAfterCreate;
  draft.mainProvider = stringValue(stored.mainProvider) ?? draft.mainProvider;
  draft.mainModel = stringValue(stored.mainModel) ?? draft.mainModel;
  draft.mainThinking = thinkingValue(stored.mainThinking) ?? draft.mainThinking;
  draft.exploreProvider =
    stringValue(stored.exploreProvider) ?? draft.exploreProvider;
  draft.exploreModel = stringValue(stored.exploreModel) ?? draft.exploreModel;
  draft.initialPrompt =
    stringValue(stored.initialPrompt) ?? draft.initialPrompt;
  draft.systemPromptAmendment =
    stringValue(stored.systemPromptAmendment) ?? draft.systemPromptAmendment;
  draft.mode = modeValue(stored.mode) ?? draft.mode;
  draft.permissionLevel =
    permissionLevelValue(stored.permissionLevel) ?? draft.permissionLevel;
  draft.disconnectPolicyMode =
    disconnectPolicyModeValue(stored.disconnectPolicyMode) ??
    draft.disconnectPolicyMode;
  draft.disconnectExitAfterSeconds =
    stringValue(stored.disconnectExitAfterSeconds) ??
    draft.disconnectExitAfterSeconds;
  draft.mainModelProfileId =
    stringValue(stored.mainModelProfileId) ?? draft.mainModelProfileId;
  draft.exploreModelProfileId =
    stringValue(stored.exploreModelProfileId) ?? draft.exploreModelProfileId;
  draft.gitIdentityProfileId =
    stringValue(stored.gitIdentityProfileId) ?? draft.gitIdentityProfileId;
  if (Array.isArray(stored.gitCredentialProfileIds)) {
    draft.gitCredentialProfileIds = stored.gitCredentialProfileIds.filter(
      (value): value is string => typeof value === "string",
    );
  }
  draft.githubProfileId =
    stringValue(stored.githubProfileId) ?? draft.githubProfileId;
  draft.jiraProfileId =
    stringValue(stored.jiraProfileId) ?? draft.jiraProfileId;
  draft.confluenceProfileId =
    stringValue(stored.confluenceProfileId) ?? draft.confluenceProfileId;
  draft.bootEnabled = booleanValue(stored.bootEnabled) ?? draft.bootEnabled;
  draft.bootMode = bootModeValue(stored.bootMode) ?? draft.bootMode;
  draft.bootScript = stringValue(stored.bootScript) ?? draft.bootScript;
  draft.bootTimeoutSeconds =
    stringValue(stored.bootTimeoutSeconds) ?? draft.bootTimeoutSeconds;
  draft.bootRunAs = bootRunAsValue(stored.bootRunAs) ?? draft.bootRunAs;
  draft.bootNetwork = bootNetworkValue(stored.bootNetwork) ?? draft.bootNetwork;
  draft.bootOnFailure =
    bootOnFailureValue(stored.bootOnFailure) ?? draft.bootOnFailure;
  draft.bootPhases = storedBootPhases(stored.bootPhases) ?? draft.bootPhases;

  draft.webProfileId = stringValue(stored.webProfileId) ?? draft.webProfileId;

  if (isRecord(stored.tools)) {
    for (const tool of CREATE_SANDBOX_TOOL_KEYS) {
      const enabled = booleanValue(stored.tools[tool]);
      if (enabled !== undefined) draft.tools[tool] = enabled;
    }
  }

  draft.yamlSource = "";
  draft.yamlDirty = false;
  return draft;
}

function preferencesFromDraft(
  draft: CreateSandboxDraft,
): PersistedCreateSandboxPreferences {
  return {
    version: 1,
    image: draft.image,
    labels: draft.labels,
    startAfterCreate: draft.startAfterCreate,
    mainProvider: draft.mainProvider,
    mainModel: draft.mainModel,
    mainThinking: draft.mainThinking,
    exploreProvider: draft.exploreProvider,
    exploreModel: draft.exploreModel,
    initialPrompt: draft.initialPrompt,
    systemPromptAmendment: draft.systemPromptAmendment,
    mode: draft.mode,
    permissionLevel: draft.permissionLevel,
    disconnectPolicyMode: draft.disconnectPolicyMode,
    disconnectExitAfterSeconds: draft.disconnectExitAfterSeconds,
    tools: { ...draft.tools },
    mainModelProfileId: draft.mainModelProfileId,
    exploreModelProfileId: draft.exploreModelProfileId,
    gitIdentityProfileId: draft.gitIdentityProfileId,
    gitCredentialProfileIds: [...draft.gitCredentialProfileIds],
    githubProfileId: draft.githubProfileId,
    jiraProfileId: draft.jiraProfileId,
    confluenceProfileId: draft.confluenceProfileId,
    webProfileId: draft.webProfileId,
    bootEnabled: draft.bootEnabled,
    bootMode: draft.bootMode,
    bootScript: draft.bootScript,
    bootTimeoutSeconds: draft.bootTimeoutSeconds,
    bootRunAs: draft.bootRunAs,
    bootNetwork: draft.bootNetwork,
    bootOnFailure: draft.bootOnFailure,
    bootPhases: draft.bootPhases.map((phase) => ({
      name: phase.name,
      script: phase.script,
      timeoutSeconds: phase.timeoutSeconds,
      runAs: phase.runAs,
      network: phase.network,
      env: phase.env.map((row) => ({
        name: row.name,
        refType: row.refType,
        value: row.value,
        store: row.store,
        version: row.version,
      })),
    })),
  };
}

export function saveCreateSandboxPreferences(
  draft: CreateSandboxDraft,
  storage?: CreateSandboxPreferenceStorage,
): void {
  const target = storageOrDefault(storage);
  if (!target) return;
  try {
    target.setItem(
      CREATE_SANDBOX_PREFERENCES_STORAGE_KEY,
      JSON.stringify(preferencesFromDraft(draft)),
    );
  } catch {
    // Browser storage may be unavailable or full. Creation should still work.
  }
}

function parseLabels(input: string): Record<string, string> | undefined {
  const entries = input
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const index = pair.indexOf("=");
      if (index === -1) return undefined;
      return [
        pair.slice(0, index).trim(),
        pair.slice(index + 1).trim(),
      ] as const;
    })
    .filter((pair): pair is readonly [string, string] => Boolean(pair));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function parsePositiveSeconds(
  value: string,
  fieldName: string,
): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isInteger(seconds)) {
    throw new Error(`${fieldName} must be a positive whole number of seconds.`);
  }
  return seconds;
}

function millisecondsFromSeconds(
  value: string,
  fieldName: string,
): number | undefined {
  const seconds = parsePositiveSeconds(value, fieldName);
  return seconds === undefined ? undefined : seconds * 1000;
}

export function buildControllerConfigFromDraft(
  draft: CreateSandboxDraft,
): SandboxCreateConfigInput["controller"] {
  if (draft.disconnectPolicyMode === "stay_reconnecting") {
    return { disconnectPolicy: { mode: "stay_reconnecting" } };
  }
  const exitAfterMs = millisecondsFromSeconds(
    draft.disconnectExitAfterSeconds,
    "Disconnect shutdown timeout",
  );
  if (exitAfterMs === undefined) {
    throw new Error("Disconnect shutdown timeout is required.");
  }
  return {
    disconnectPolicy: { mode: "exit_self", exitAfterMs },
  };
}

export function buildSecretRefFromEnvDraft(
  row: CreateSandboxBootSecretEnvDraft,
): SandboxSecretRef | undefined {
  const value = row.value.trim();
  if (!value) return undefined;
  if (row.refType === "env") return { env: value };
  if (row.refType === "file") return { file: value };
  if (row.refType === "kv") {
    const kv: { key: string; store?: string; version?: string } = {
      key: value,
    };
    const store = row.store.trim();
    const version = row.version.trim();
    if (store) kv.store = store;
    if (version) kv.version = version;
    return { kv };
  }
  return undefined;
}

function secretEnvRowHasInput(row: CreateSandboxBootSecretEnvDraft): boolean {
  return Boolean(
    row.name.trim() ||
      row.value.trim() ||
      (row.refType === "kv" && (row.store.trim() || row.version.trim())),
  );
}

function secretRefValueLabel(refType: CreateSandboxBootSecretRefType): string {
  if (refType === "file") return "file path";
  if (refType === "kv") return "secret key";
  return "source environment variable";
}

export function validateBootDraft(
  draft: CreateSandboxDraft,
): string | undefined {
  if (!draft.bootEnabled) return undefined;

  try {
    parsePositiveSeconds(draft.bootTimeoutSeconds, "Boot timeout");
  } catch (error) {
    return errorMessage(error);
  }

  if (draft.bootMode === "single") {
    if (!draft.bootScript.trim()) return "Boot script is required.";
    return undefined;
  }

  if (draft.bootPhases.length === 0) {
    return "Add at least one boot phase.";
  }

  const phaseNames = new Set<string>();
  for (const [phaseIndex, phase] of draft.bootPhases.entries()) {
    const phaseLabel = `Boot phase ${phaseIndex + 1}`;
    const name = phase.name.trim();
    if (!name) return `${phaseLabel} needs a name.`;
    if (phaseNames.has(name)) return `Duplicate boot phase name: ${name}.`;
    phaseNames.add(name);
    if (!phase.script.trim()) return `${phaseLabel} needs a script.`;
    try {
      parsePositiveSeconds(phase.timeoutSeconds, `${phaseLabel} timeout`);
    } catch (error) {
      return errorMessage(error);
    }

    const envNames = new Set<string>();
    for (const [envIndex, row] of phase.env.entries()) {
      if (!secretEnvRowHasInput(row)) continue;
      const envLabel = `${phaseLabel} secret environment row ${envIndex + 1}`;
      const envName = row.name.trim();
      if (!envName) return `${envLabel} needs an environment variable name.`;
      if (envNames.has(envName)) {
        return `${phaseLabel} has duplicate secret environment variable ${envName}.`;
      }
      envNames.add(envName);
      if (!row.value.trim()) {
        return `${envLabel} needs a ${secretRefValueLabel(row.refType)}.`;
      }
    }
  }

  return undefined;
}

export function buildBootConfigFromDraft(
  draft: CreateSandboxDraft,
): SandboxCreateConfigInput["boot"] | undefined {
  const validationError = validateBootDraft(draft);
  if (validationError) throw new Error(validationError);
  if (!draft.bootEnabled) return undefined;

  const boot: NonNullable<SandboxCreateConfigInput["boot"]> = {
    runAs: draft.bootRunAs,
    network: draft.bootNetwork,
    onFailure: draft.bootOnFailure,
  };
  const timeoutMs = millisecondsFromSeconds(
    draft.bootTimeoutSeconds,
    "Boot timeout",
  );
  if (timeoutMs !== undefined) boot.timeoutMs = timeoutMs;

  if (draft.bootMode === "single") {
    boot.script = draft.bootScript;
    return boot;
  }

  boot.phases = draft.bootPhases.map((phase, index) => {
    const phaseConfig: NonNullable<
      NonNullable<SandboxCreateConfigInput["boot"]>["phases"]
    >[number] = {
      name: phase.name.trim(),
      script: phase.script,
    };
    const phaseTimeoutMs = millisecondsFromSeconds(
      phase.timeoutSeconds,
      `Boot phase ${index + 1} timeout`,
    );
    if (phaseTimeoutMs !== undefined) phaseConfig.timeoutMs = phaseTimeoutMs;
    if (phase.runAs) phaseConfig.runAs = phase.runAs;
    if (phase.network) phaseConfig.network = phase.network;

    const env: Record<string, SandboxSecretRef> = {};
    for (const row of phase.env) {
      const name = row.name.trim();
      const ref = buildSecretRefFromEnvDraft(row);
      if (name && ref) env[name] = ref;
    }
    if (Object.keys(env).length > 0) phaseConfig.env = env;
    return phaseConfig;
  });

  return boot;
}

export function buildConfigFromDraft(
  draft: CreateSandboxDraft,
): SandboxCreateConfigInput {
  const config: Record<string, unknown> = {
    version: 1,
    agent: {
      mainModel: {
        provider: draft.mainProvider,
        model: draft.mainModel,
        ...(draft.mainThinking ? { thinkingLevel: draft.mainThinking } : {}),
      },
      ...(draft.exploreProvider && draft.exploreModel
        ? {
            exploreModel: {
              provider: draft.exploreProvider,
              model: draft.exploreModel,
            },
          }
        : {}),
      ...(draft.initialPrompt ? { initialPrompt: draft.initialPrompt } : {}),
      ...(draft.systemPromptAmendment
        ? { systemPromptAmendment: draft.systemPromptAmendment }
        : {}),
      mode: draft.mode,
      permissionLevel: draft.permissionLevel,
    },
  };

  const labels = parseLabels(draft.labels);
  const identity: Record<string, unknown> = {};
  if (draft.sandboxId.trim()) identity.sandboxId = draft.sandboxId.trim();
  if (draft.name.trim()) identity.name = draft.name.trim();
  if (labels) identity.labels = labels;
  if (Object.keys(identity).length > 0) config.identity = identity;

  config.controller = buildControllerConfigFromDraft(draft);

  const groups: Record<string, { enabled: boolean }> = {};
  for (const [key, enabled] of Object.entries(draft.tools))
    groups[key] = { enabled };
  config.tools = { groups };

  const boot = buildBootConfigFromDraft(draft);
  if (boot) config.boot = boot;

  return sandboxCreateConfigInputSchema.parse(config);
}

const configKeyOrder = [
  "version",
  "identity",
  "secretStores",
  "modelCatalog",
  "agent",
  "controller",
  "git",
  "github",
  "tools",
  "skills",
  "boot",
  "security",
  "storage",
  "resources",
  "observability",
];

function orderedConfig(
  config: SandboxCreateConfigInput | SandboxConfigV1,
): Record<string, unknown> {
  const source = config as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const key of configKeyOrder) {
    if (source[key] !== undefined) ordered[key] = source[key];
  }
  for (const key of Object.keys(source).sort()) {
    if (!(key in ordered) && source[key] !== undefined)
      ordered[key] = source[key];
  }
  return ordered;
}

export function configToYaml(config: SandboxConfigV1): string {
  const parsed = sandboxConfigV1Schema.parse(config);
  return stringifyYaml(orderedConfig(parsed));
}

export function configInputToYaml(config: SandboxCreateConfigInput): string {
  const parsed = sandboxCreateConfigInputSchema.parse(config);
  return stringifyYaml(orderedConfig(parsed));
}

export function parseSandboxConfigYaml(input: string): SandboxConfigV1 {
  const parsed = parseYaml(input || "{}") as unknown;
  return sandboxConfigV1Schema.parse(parsed);
}

export type BuildCreateRequestResult =
  | { ok: true; request: SandboxCreateRequest }
  | { ok: false; error: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildCreateRequestFromForm(
  draft: CreateSandboxDraft,
): BuildCreateRequestResult {
  try {
    const auth = {
      mainModelProfileId: draft.mainModelProfileId.trim() || undefined,
      exploreModelProfileId: draft.exploreModelProfileId.trim() || undefined,
      gitIdentityProfileId: draft.gitIdentityProfileId.trim() || undefined,
      gitCredentialProfileIds: draft.gitCredentialProfileIds.length
        ? draft.gitCredentialProfileIds
        : undefined,
      githubProfileId: draft.githubProfileId.trim() || undefined,
      jiraProfileId: draft.jiraProfileId.trim() || undefined,
      confluenceProfileId: draft.confluenceProfileId.trim() || undefined,
      webProfileId: draft.webProfileId.trim() || undefined,
    };
    const request = sandboxCreateRequestSchema.parse({
      config: buildConfigFromDraft(draft),
      image: draft.image.trim() || undefined,
      start: draft.startAfterCreate,
      auth: Object.values(auth).some(Boolean) ? auth : undefined,
    });
    return { ok: true, request };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export function buildCreateRequestFromYaml(
  draft: CreateSandboxDraft,
): BuildCreateRequestResult {
  try {
    const request = sandboxCreateRequestSchema.parse({
      config: parseSandboxConfigYaml(draft.yamlSource),
      image: draft.image.trim() || undefined,
      start: draft.startAfterCreate,
    });
    return { ok: true, request };
  } catch (error) {
    return {
      ok: false,
      error: `YAML sandbox config is invalid: ${errorMessage(error)}`,
    };
  }
}

export function buildCreateRequest(
  draft: CreateSandboxDraft,
): BuildCreateRequestResult {
  return draft.yamlDirty
    ? buildCreateRequestFromYaml(draft)
    : buildCreateRequestFromForm(draft);
}
