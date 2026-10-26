// Invented RAW source catalogs fed through the real production provider adapters.
// No filesystem discovery, real launches/projects, network, or pre-scored items.
import {
  resolveAgentConfiguration,
  profileDefinitionSchema,
} from "@nervekit/contracts/agent-configuration";
import { launchDefinitionSchema } from "@nervekit/contracts/launch-definitions";
import {
  createCompletionProviders,
  type CompletionSourcePorts,
} from "../../src/domains/completions/completion-source-providers.js";

export const syntheticScope = {
  projectId: "proj_synthetic",
  conversationId: "conv_synthetic",
};
export type SyntheticProviderOptions = {
  paths: readonly string[];
  discover?: CompletionSourcePorts["discover"];
  allSources?: boolean;
  crossKind?: boolean;
  weakCompetition?: boolean;
};
export function syntheticProviders(options: SyntheticProviderOptions) {
  const now = Date.now();
  const timestamp = new Date(now).toISOString();
  const settings = {
    tools: { web_search: { enabled: false } },
    subagents: { cobalt: { enabled: false } },
  };
  const profile = profileDefinitionSchema.parse({
    schemaVersion: 1,
    name: "cobalt",
    label: "cobalt",
    description: "Invented review profile",
    usableBy: "subagent",
    instructions: "Review the invented fixture only.",
  });
  const crossKind = options.crossKind;
  const launchName = options.weakCompetition
    ? "s_x_e_x_s_x_s_x_i_x_o_x_n"
    : crossKind
      ? "session"
      : "beacon";
  const prTitle = options.weakCompetition
    ? "s_y_e_y_s_y_s_y_i_y_o_y_n"
    : crossKind
      ? "session"
      : "Aurora session migration";
  const refuseWrite = async (): Promise<never> => {
    throw new Error("Ranking benchmark must not mutate owning configuration");
  };
  const ports: CompletionSourcePorts = {
    project: (id) => ({ id, directory: "/synthetic/unified-completion" }),
    isProjectAgentTrusted: () => true,
    configuration: {
      ensureLoaded: async (scope) => ({
        status: "ready",
        value: {
          scope,
          path: "/synthetic/agent.json",
          generation: 1,
          revision: 0,
          digest: "sha256:synthetic",
          document: { schemaVersion: 1, revision: 0, overrides: {} },
        },
      }),
      getEffective: async (conversationId) => ({
        status: "available",
        conversationId,
        role: "lead",
        resolution: resolveAgentConfiguration({
          role: "lead",
          conversation: settings,
        }),
        sources: [],
        diagnostics: [],
      }),
      captureDefaults: async () => ({
        options: { project: settings },
        isCurrent: () => true,
      }),
      save: refuseWrite,
      subscribeHealth: () => () => {},
      profiles: {
        list: async () => ({
          profiles: options.allSources
            ? {
                cobalt: {
                  status: "available",
                  source: "project",
                  digest: "sha256:synthetic",
                  definition: profile,
                  diagnostics: [],
                },
              }
            : {},
          diagnostics: [],
        }),
      },
    },
    skills: async () =>
      options.allSources
        ? [
            {
              name: "aurora",
              description: "Invented project review skill",
              source: "nerve",
              filePath: "/synthetic/aurora/SKILL.md",
            },
          ]
        : [],
    tools: options.allSources
      ? [
          { name: "read", description: "Read an invented source file" },
          { name: "web_search", description: "Search an invented topic" },
        ]
      : [],
    prs: async () => ({
      items:
        options.allSources || crossKind
          ? [
              {
                number: 271,
                title: prTitle,
                url: "https://synthetic.invalid/project/pull/271",
                state: "OPEN",
                headRefName: crossKind ? "invented" : "aurora/migration",
                updatedAt: timestamp,
                author: "invented-author",
              },
            ]
          : [],
      refreshing: false,
      updatedAt: timestamp,
    }),
    issues: async () => ({
      items: options.allSources
        ? [
            {
              number: 42,
              title: "Session rollover",
              url: "https://synthetic.invalid/project/issues/42",
              state: "OPEN",
              author: "invented-author",
              updatedAt: timestamp,
            },
          ]
        : [],
      refreshing: false,
      updatedAt: timestamp,
    }),
    launches: () =>
      options.allSources || crossKind
        ? [
            {
              id: "launch_synthetic",
              projectId: syntheticScope.projectId,
              displayName: launchName,
              name: launchName,
              status: "running",
              updatedAt: timestamp,
            },
          ]
        : [],
    definitions: async () => ({
      projectId: syntheticScope.projectId,
      revision: "synthetic-launch-catalog",
      folders: [],
      definitions: options.allSources
        ? [
            launchDefinitionSchema.parse({
              id: "launchdef_synthetic",
              label: "beacon-build",
              command: "printf 'synthetic beacon'",
              scope: { kind: "project", projectId: syntheticScope.projectId },
              parentFolderId: null,
              order: 0,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          ]
        : [],
    }),
    children: () =>
      options.allSources
        ? [
            {
              id: "conv_child_synthetic",
              title: "session-worker",
              projectId: syntheticScope.projectId,
              parentConversationId: syntheticScope.conversationId,
              status: "running",
              updatedAt: timestamp,
            },
          ]
        : [],
    discover:
      options.discover ??
      (async () =>
        options.paths.map((path) => ({
          relativePath: path,
          kind: path.endsWith("/src")
            ? ("directory" as const)
            : ("file" as const),
        }))),
  };
  const providers = createCompletionProviders(ports);
  return {
    now,
    providers,
    async documents() {
      return (
        await Promise.all(
          providers.map(async (provider) => {
            const snapshot = await provider.load(syntheticScope);
            return "documents" in snapshot ? snapshot.documents : snapshot;
          }),
        )
      ).flat();
    },
  };
}
