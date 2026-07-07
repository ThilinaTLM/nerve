import {
  type SandboxCreateConfigInput,
  type SandboxCreateRequest,
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

type CreateSandboxPreferenceStorage = Pick<Storage, "getItem" | "setItem">;

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
  tools?: Partial<Record<CreateSandboxToolKey, boolean>>;
  mainModelProfileId?: string;
  exploreModelProfileId?: string;
  githubProfileId?: string;
  jiraProfileId?: string;
  confluenceProfileId?: string;
  webProfileId?: string;
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
  tools: Record<CreateSandboxToolKey, boolean>;
  mainModelProfileId: string;
  exploreModelProfileId: string;
  githubProfileId: string;
  jiraProfileId: string;
  confluenceProfileId: string;
  webProfileId: string;
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

export function createDefaultDraft(): CreateSandboxDraft {
  const identity = createReadableSandboxIdentity();
  return {
    name: identity.name,
    sandboxId: identity.sandboxId,
    image: "nerve-sandbox:dev",
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
    githubProfileId: "",
    jiraProfileId: "",
    confluenceProfileId: "",
    webProfileId: "",
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
  draft.mainModelProfileId =
    stringValue(stored.mainModelProfileId) ?? draft.mainModelProfileId;
  draft.exploreModelProfileId =
    stringValue(stored.exploreModelProfileId) ?? draft.exploreModelProfileId;
  draft.githubProfileId =
    stringValue(stored.githubProfileId) ?? draft.githubProfileId;
  draft.jiraProfileId =
    stringValue(stored.jiraProfileId) ?? draft.jiraProfileId;
  draft.confluenceProfileId =
    stringValue(stored.confluenceProfileId) ?? draft.confluenceProfileId;
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
    tools: { ...draft.tools },
    mainModelProfileId: draft.mainModelProfileId,
    exploreModelProfileId: draft.exploreModelProfileId,
    githubProfileId: draft.githubProfileId,
    jiraProfileId: draft.jiraProfileId,
    confluenceProfileId: draft.confluenceProfileId,
    webProfileId: draft.webProfileId,
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

  const groups: Record<string, { enabled: boolean }> = {};
  for (const [key, enabled] of Object.entries(draft.tools))
    groups[key] = { enabled };
  config.tools = { groups };

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
  config: SandboxCreateConfigInput,
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

function orderedCreateRequest(
  request: SandboxCreateRequest,
): Record<string, unknown> {
  return {
    ...(request.image ? { image: request.image } : {}),
    ...(request.name ? { name: request.name } : {}),
    ...(request.start === undefined ? {} : { start: request.start }),
    ...(request.auth ? { auth: request.auth } : {}),
    config: orderedConfig(request.config),
  };
}

export function requestToYaml(request: SandboxCreateRequest): string {
  const parsed = sandboxCreateRequestSchema.parse(request);
  return stringifyYaml(orderedCreateRequest(parsed));
}

export function parseCreateRequestYaml(input: string): SandboxCreateRequest {
  const parsed = parseYaml(input || "{}") as unknown;
  return sandboxCreateRequestSchema.parse(parsed);
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
      githubProfileId: draft.githubProfileId.trim() || undefined,
      jiraProfileId: draft.jiraProfileId.trim() || undefined,
      confluenceProfileId: draft.confluenceProfileId.trim() || undefined,
      webProfileId: draft.webProfileId.trim() || undefined,
    };
    const request = sandboxCreateRequestSchema.parse({
      config: buildConfigFromDraft(draft),
      image: draft.image.trim() || undefined,
      name: draft.name.trim() || undefined,
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
    return { ok: true, request: parseCreateRequestYaml(draft.yamlSource) };
  } catch (error) {
    return {
      ok: false,
      error: `YAML create request is invalid: ${errorMessage(error)}`,
    };
  }
}

export function buildYamlFromDraft(
  draft: CreateSandboxDraft,
): { ok: true; yaml: string } | { ok: false; error: string } {
  const result = buildCreateRequestFromForm(draft);
  if (!result.ok) return result;
  return { ok: true, yaml: requestToYaml(result.request) };
}

export function buildCreateRequest(
  draft: CreateSandboxDraft,
): BuildCreateRequestResult {
  return draft.yamlDirty
    ? buildCreateRequestFromYaml(draft)
    : buildCreateRequestFromForm(draft);
}
