import { defaultSettings } from "@nervekit/contracts/settings";
import {
  resolveAgentConfiguration,
  type ProfileTransitionResult,
} from "@nervekit/contracts/agent-configuration";
import type { AgentConfigurationPort } from "../configuration.js";
import type { TurnPreparationInput, TurnResourcesPort } from "../ports.js";

const digest = "0".repeat(64);
export const testDefaults: TurnPreparationInput["config"] = {
  model: { provider: "test", modelId: "test" },
  reasoningLevel: "off",
  permissionRuleSetId: "baseline",
  agentProfile: "coding",
  instructions: null,
  systemPrompt: null,
  workingDirectory: "/tmp",
};

/** Independent in-memory agent authority for core unit fixtures. Production uses scoped JSON. */
export function testConfiguration(
  resources: TurnResourcesPort,
  base?: (id: string) => Partial<TurnPreparationInput["config"]>,
  compaction: (
    id: string,
  ) =>
    | typeof defaultSettings.compaction
    | Promise<typeof defaultSettings.compaction> = () =>
    defaultSettings.compaction,
  defaults: () =>
    | TurnPreparationInput["config"]
    | Promise<TurnPreparationInput["config"]> = () =>
    structuredClone(testDefaults),
) {
  const agents = new Map<string, Partial<TurnPreparationInput["config"]>>();
  const snapshot = (id: string) => ({
    ...testDefaults,
    ...base?.(id),
    ...agents.get(id),
  });
  const resolution = (id: string) => {
    const value = snapshot(id);
    return resolveAgentConfiguration({
      role: "lead",
      conversation: {
        model: value.model,
        reasoningLevel: value.reasoningLevel,
        permissionRuleSetId: value.permissionRuleSetId,
      },
    });
  };
  const port: AgentConfigurationPort = {
    historyContext(id) {
      const { instructions, systemPrompt } = snapshot(id);
      return { instructions, systemPrompt };
    },
    async configureContext(id, patch) {
      agents.set(id, { ...agents.get(id), ...patch });
    },
    async resolveConfig(id, context) {
      return { ...snapshot(id), ...context, conversationId: id };
    },
    summary(id) {
      const { model, reasoningLevel, permissionRuleSetId, agentProfile } =
        snapshot(id);
      return { model, reasoningLevel, permissionRuleSetId, agentProfile };
    },
    profiles: {
      async preview(id, profile) {
        return {
          status: "ready",
          preview: {
            targetDefinition: {
              schemaVersion: 1,
              name: profile,
              description: "Fixture profile",
              usableBy: "lead",
              instructions: "",
            },
            changedFields: [],
            unchangedRequirements: [],
            targetProfile: { name: profile, digest },
            source: "builtin",
            expectedRevision: 0,
            expectedDigest: "missing",
            recommendations: {},
            requirements: {},
            resolution: resolution(id),
          },
        };
      },
      async apply(input) {
        agents.set(input.conversationId, {
          ...agents.get(input.conversationId),
          ...input.choices,
          agentProfile: input.targetProfile.name,
        });
        const result: ProfileTransitionResult = {
          status: "applied",
          source: {
            scope: {
              scope: "conversation",
              conversationId: input.conversationId,
            },
            path: "/test/agent.json",
            generation: 1,
            revision: 1,
            digest,
          },
          effective: {
            status: "available",
            conversationId: input.conversationId,
            role: "lead",
            appliedProfile: null,
            resolution: resolution(input.conversationId),
            diagnostics: [],
            sources: [],
          },
        };
        return result;
      },
    },
    async prepareCreation(input) {
      const value = await defaults();
      return {
        ...value,
        ...input.application?.config,
        ...input.overrides,
        ...input.config,
        agentProfile:
          input.agentProfile?.name ??
          input.application?.config.agentProfile ??
          value.agentProfile,
      };
    },
    async initializeConversation(input) {
      const value = await port.prepareCreation(input);
      agents.set(input.id, {
        model: value.model,
        reasoningLevel: value.reasoningLevel,
        permissionRuleSetId: value.permissionRuleSetId,
        agentProfile: value.agentProfile,
        instructions: value.instructions,
        systemPrompt: value.systemPrompt,
      });
    },
    async capturePreview(input) {
      const value = input.conversation.id
        ? snapshot(input.conversation.id)
        : {
            ...(await defaults()),
            ...input.overrides,
            agentProfile: input.agentProfile?.name ?? "coding",
          };
      const config = { ...value, ...input.config };
      const prepared = await resources.prepare({ ...input, config });
      return {
        status: "available",
        systemPrompt: config.systemPrompt ?? prepared.systemPrompt,
        resolution: resolveAgentConfiguration({
          role: "lead",
          conversation: {
            model: value.model,
            reasoningLevel: value.reasoningLevel,
          },
        }),
      };
    },
    async captureRequest(input) {
      const value = structuredClone(
        input.conversation.id && base
          ? snapshot(input.conversation.id)
          : input.config,
      );
      const prepared = await resources.prepare({
        conversation: input.conversation,
        config: structuredClone(value),
        projectDir: input.projectDir,
        coreTools: input.coreTools,
      });
      return {
        id: "test-capture",
        model: value.model,
        reasoningLevel: value.reasoningLevel,
        agentProfile: value.agentProfile,
        systemPrompt: value.systemPrompt ?? prepared.systemPrompt,
        tools: prepared.tools,
        isCurrent: () => true,
      };
    },
    async captureCompaction(id) {
      const value = snapshot(id);
      return {
        model: value.model,
        reasoningLevel: value.reasoningLevel,
        settings: await compaction(id),
        isCurrent: () => true,
      };
    },
    async captureRetry() {
      return { enabled: true, maxRetries: 2, baseDelayMs: 1 };
    },
  };
  return Object.assign(port, {
    snapshot,
    update(id: string, patch: Partial<TurnPreparationInput["config"]>) {
      agents.set(id, { ...agents.get(id), ...patch });
    },
  });
}
