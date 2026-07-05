import {
  type SandboxCreateConfigInput,
  type SandboxCreateRequest,
  sandboxCreateConfigInputSchema,
  sandboxCreateRequestSchema,
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

export type CreateSandboxDraft = {
  name: string;
  sandboxId: string;
  image: string;
  labels: string;
  startAfterCreate: boolean;
  mainProvider: string;
  mainModel: string;
  mainThinking: string;
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

export function createDefaultDraft(): CreateSandboxDraft {
  return {
    name: "",
    sandboxId: "",
    image: "nerve-sandbox:dev",
    labels: "",
    startAfterCreate: true,
    mainProvider: "anthropic",
    mainModel: "claude-sonnet-4-5",
    mainThinking: "",
    exploreProvider: "",
    exploreModel: "",
    initialPrompt: "",
    systemPromptAmendment: "",
    mode: "normal",
    permissionLevel: "supervised",
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
