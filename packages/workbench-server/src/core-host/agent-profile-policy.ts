import { isDeepStrictEqual } from "node:util";
import {
  DEFAULT_AGENT_PROFILE,
  agentProfileScalarKind,
  lockedValue,
  type AgentProfile,
  type AgentProfileCompactionOverride,
} from "@nervekit/contracts/agent-profiles";
import type { ConversationConfig } from "@nervekit/contracts/core";
import type {
  AgentProfilePort,
  AgentProfileConfigPatch,
  TurnPreparationInput,
} from "@nervekit/conversation-core";
import type { Settings } from "@nervekit/contracts/settings";
import type { CapabilityOverridesDocument } from "@nervekit/contracts/capabilities";
import type { AgentProfileService } from "../domains/agent-profiles/agent-profile.service.js";
import { switchScalar, resolveProfileScalar } from "./agent-profile-scalars.js";
import { parseProfileModel } from "./agent-profile-availability.js";

export function profileDefaults(settings: Settings) {
  const model = settings.defaultModel ?? settings.lastAgentSelection.model;
  if (!model)
    throw new Error("Choose a default model before creating a conversation.");
  return {
    model,
    reasoningLevel: settings.defaultThinkingLevel,
    permissionRuleSetId: settings.defaultPermissionRuleSetId ?? "baseline",
    compaction: {
      auto: settings.compaction.auto,
      profile: settings.compaction.profile,
      triggerPercent: settings.compaction.customTriggerPercent,
    } satisfies AgentProfileCompactionOverride,
  };
}
export function applyProfileSets(
  profile: AgentProfile,
  config: Omit<ConversationConfig, "conversationId">,
  settings: Settings,
) {
  const defaults = profileDefaults(settings);
  const result = { ...config, agentProfile: profile.name };
  if (agentProfileScalarKind(profile.model) === "set")
    result.model =
      profile.model === "default"
        ? defaults.model
        : parseProfileModel(profile.name, profile.model as string);
  if (agentProfileScalarKind(profile.thinking) === "set")
    result.reasoningLevel = resolveProfileScalar(
      profile.thinking,
      config.reasoningLevel,
      defaults.reasoningLevel,
    );
  if (agentProfileScalarKind(profile.permission) === "set")
    result.permissionRuleSetId = resolveProfileScalar(
      profile.permission,
      config.permissionRuleSetId,
      defaults.permissionRuleSetId,
    );
  return result;
}
export function createAgentProfilePort(options: {
  profiles(): AgentProfileService;
  settings(projectId: string): Promise<Settings>;
  compaction(conversationId: string): Promise<AgentProfileCompactionOverride>;
  capabilities(
    projectId: string,
    conversationId: string,
  ): Promise<CapabilityOverridesDocument | undefined>;
  notice?(conversationId: string, text: string): void;
}): AgentProfilePort {
  const unavailableNotices = new Map<string, string>();
  const profiles = async (input: TurnPreparationInput) => {
    if (input.conversation.id)
      return options
        .profiles()
        .list(input.conversation.projectId, input.conversation.id);
    const configuration = await options.profiles().preview({
      projectId: input.conversation.projectId,
      document: input.agentProfileOverrides ?? {
        schemaVersion: 1,
        profiles: {},
      },
      lead: {
        model: input.config.model,
        reasoningLevel: input.config.reasoningLevel,
      },
      capabilityOverrides: input.capabilityOverrides,
    });
    return configuration.profiles.flatMap(({ effective }) =>
      effective ? [effective] : [],
    );
  };
  const defaultName = (settings: Settings) =>
    settings.defaultAgentProfile ?? DEFAULT_AGENT_PROFILE;
  const lead = (profile: AgentProfile | undefined): profile is AgentProfile =>
    Boolean(
      profile?.enabled &&
      !profile.error &&
      profile.trust !== "untrusted" &&
      profile.usableBy !== "subagent",
    );
  const active = async (input: TurnPreparationInput, settings: Settings) => {
    const list = await profiles(input);
    const current = list.find((p) => p.name === input.config.agentProfile);
    if (input.conversation.parentConversationId !== null) return current;
    if (lead(current)) {
      if (input.conversation.id)
        unavailableNotices.delete(input.conversation.id);
      return current;
    }
    const fallback = list.find((p) => p.name === defaultName(settings));
    if (!lead(fallback))
      throw new Error(
        "Default agent profile is not usable by lead conversations.",
      );
    if (
      input.conversation.id &&
      unavailableNotices.get(input.conversation.id) !==
        input.config.agentProfile
    ) {
      unavailableNotices.set(input.conversation.id, input.config.agentProfile);
      options.notice?.(
        input.conversation.id,
        `Agent profile "${input.config.agentProfile}" is unavailable; using "${fallback.name}".`,
      );
    }
    return fallback;
  };
  return {
    async resolveLockedScalars(input) {
      if (input.conversation.parentConversationId !== null) return {};
      const settings = await options.settings(input.conversation.projectId);
      const profile = await active(input, settings);
      if (!profile) return {};
      const defaults = profileDefaults(settings);
      const result: Awaited<
        ReturnType<AgentProfilePort["resolveLockedScalars"]>
      > = {};
      const model = lockedValue(profile.model);
      if (model !== undefined)
        result.model =
          model === "default"
            ? defaults.model
            : parseProfileModel(profile.name, model);
      const thinking = lockedValue(profile.thinking);
      if (thinking !== undefined)
        result.reasoningLevel =
          thinking === "default" ? defaults.reasoningLevel : thinking;
      const permission = lockedValue(profile.permission);
      if (permission !== undefined)
        result.permissionRuleSetId =
          permission === "default" ? defaults.permissionRuleSetId : permission;
      const compaction = lockedValue(profile.compaction);
      if (compaction !== undefined)
        result.compaction =
          compaction === "default" ? defaults.compaction : compaction;
      return result;
    },
    async switchProfile(input) {
      if (!input.conversation.id)
        throw new Error("Conversation is required to switch agent profiles.");
      if (input.conversation.parentConversationId !== null)
        throw new Error("Sub-agent profiles cannot be switched.");
      const settings = await options.settings(input.conversation.projectId);
      const list = await profiles(input);
      const next = list.find(
        (p) => p.name === (input.profile ?? defaultName(settings)),
      );
      if (!lead(next))
        throw new Error(
          `Agent profile "${input.profile ?? defaultName(settings)}" is not usable by lead conversations.`,
        );
      const previous = list.find((p) => p.name === input.config.agentProfile);
      const defaults = profileDefaults(settings);
      const patch: AgentProfileConfigPatch = {
        config: { agentProfile: next.name },
      };
      const modelString = (value: ConversationConfig["model"]) =>
        `${value.provider}/${value.modelId}`;
      const model = switchScalar(
        previous?.model,
        next.model,
        modelString(input.config.model),
        modelString(defaults.model),
      );
      if (model !== undefined)
        patch.config.model = parseProfileModel(next.name, model);
      const thinking = switchScalar(
        previous?.thinking,
        next.thinking,
        input.config.reasoningLevel,
        defaults.reasoningLevel,
      );
      if (thinking !== undefined) patch.config.reasoningLevel = thinking;
      const permission = switchScalar(
        previous?.permission,
        next.permission,
        input.config.permissionRuleSetId,
        defaults.permissionRuleSetId,
      );
      if (permission !== undefined)
        patch.config.permissionRuleSetId = permission;
      const normalizeCompaction = (
        value: AgentProfile["compaction"],
      ): AgentProfile["compaction"] => {
        if (typeof value === "string") return value;
        if ("lock" in value) return value;
        return {
          auto: value.auto ?? true,
          profile: value.profile,
          triggerPercent: value.triggerPercent ?? 80,
        };
      };
      const compaction = switchScalar(
        previous ? normalizeCompaction(previous.compaction) : undefined,
        normalizeCompaction(next.compaction),
        await options.compaction(input.conversation.id),
        defaults.compaction,
      );
      if (compaction !== undefined)
        patch.compaction = isDeepStrictEqual(compaction, defaults.compaction)
          ? null
          : compaction;
      const overrides = structuredClone(
        await options.capabilities(
          input.conversation.projectId,
          input.conversation.id,
        ),
      );
      if (overrides) {
        for (const name of Object.keys(next.tools)) {
          delete overrides.tools?.[name as keyof typeof overrides.tools];
          delete overrides.toolSettings?.[
            name as keyof typeof overrides.toolSettings
          ];
        }
        if (next.skills !== "inherit")
          for (const group of Object.values(overrides.skills ?? {}))
            for (const name of Object.keys(group))
              if (next.skills === "none" || name in next.skills)
                delete group[name];
        patch.capabilityOverrides = overrides;
      }
      return patch;
    },
  };
}
