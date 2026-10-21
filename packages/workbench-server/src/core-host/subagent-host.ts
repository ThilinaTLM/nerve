import { resolveProfileScalar, scalarValue } from "./agent-profile-scalars.js";
import { profileDefaults } from "./agent-profile-policy.js";
import type { Settings } from "@nervekit/contracts/settings";
import type { ConversationConfig } from "@nervekit/contracts/core";
import type { AgentProfile } from "@nervekit/contracts/agent-profiles";
import type { ModelPort, SubagentHost } from "@nervekit/conversation-core";
import { agentProfileCompactionToSettings } from "../domains/agent-profiles/agent-profile-compaction.js";
import type { AgentProfileService } from "../domains/agent-profiles/agent-profile.service.js";
import {
  availableProfileSnapshot,
  parseProfileModel,
  type ProfileAvailability,
} from "./agent-profile-availability.js";
import type { ConversationHarnessSettings } from "./conversation-harness.service.js";

export interface SubagentHostOptions {
  profiles: Pick<AgentProfileService, "usable" | "find">;
  availability: ProfileAvailability;
  models: ModelPort;
  validatePermission?(ruleSetId: string): Promise<void>;
  settings?(projectId: string): Promise<Settings>;
  effectiveParent?(parentId: string): Promise<ConversationConfig>;
  parentCompaction?(
    parentId: string,
  ): Promise<import("@nervekit/contracts/settings").AutoCompactionSettings>;
  harness: Pick<ConversationHarnessSettings, "initialize">;
  /** The parent's project and current configuration. */
  parent(parentId: string): { projectId: string; config: ConversationConfig };
  initializeCapabilities(
    parentId: string,
    childId: string,
    profile: AgentProfile,
  ): Promise<void>;
}

type ResolvedConfig = Awaited<
  ReturnType<SubagentHost["resolveProfile"]>
>["config"];

export function createSubagentHost(options: SubagentHostOptions): SubagentHost {
  const usableNames = async (
    parentId: string,
    parent = structuredClone(options.parent(parentId)),
  ) => {
    if (options.effectiveParent)
      parent.config = await options.effectiveParent(parentId);
    const { projectId } = parent;
    const profiles = await options.profiles.usable({
      projectId,
      conversationId: parentId,
      parentConfig: parent.config,
    });
    const checked = await Promise.all(
      profiles.map(async (profile) => ({
        profile,
        diagnostics: await options.availability(profile, {
          projectId,
          conversationId: parentId,
          parentConfig: parent.config,
        }),
      })),
    );
    return checked
      .filter(
        ({ diagnostics }) =>
          !diagnostics.some((item) => item.severity === "blocking"),
      )
      .map(({ profile }) => profile.name);
  };

  const usableProfile = async (
    parentId: string,
    name: string,
    parent: { projectId: string; config: ConversationConfig },
  ) => {
    const { projectId } = parent;
    const profile = await options.profiles.find(
      { projectId, conversationId: parentId, parentConfig: parent.config },
      name,
    );
    const reason = !profile
      ? "does not exist"
      : profile.error
        ? `is invalid (${profile.error})`
        : !profile.enabled
          ? "is disabled"
          : profile.usableBy === "lead"
            ? "is only usable by lead conversations"
            : profile.trust === "untrusted"
              ? "is not trusted yet; trust it in Settings → Agent profiles"
              : undefined;
    if (!profile || reason) {
      const usable = await usableNames(parentId, parent);
      throw new Error(
        `Sub-agent profile "${name}" ${reason}. Usable profiles: ${usable.join(", ") || "none"}.`,
      );
    }
    const diagnostics = await options.availability(profile, {
      projectId,
      conversationId: parentId,
      parentConfig: parent.config,
    });
    const blockers = diagnostics.filter((item) => item.severity === "blocking");
    if (blockers.length)
      throw new Error(
        `Sub-agent profile "${name}": ${blockers.map((item) => item.message).join(" ")}`,
      );
    return availableProfileSnapshot(profile, diagnostics);
  };

  return {
    async usableProfiles(parentId) {
      return usableNames(parentId);
    },

    async resolveProfile({ parentId, profile: name }) {
      const parent = structuredClone(options.parent(parentId));
      if (options.effectiveParent)
        parent.config = await options.effectiveParent(parentId);
      const inheritedCompaction = await options.parentCompaction?.(parentId);
      const profile = await usableProfile(parentId, name, parent);
      const lead = parent.config;
      const defaults = options.settings
        ? profileDefaults(await options.settings(parent.projectId))
        : { ...lead, compaction: undefined };
      const model = scalarValue(profile.model);
      const config: ResolvedConfig = {
        permissionRuleSetId: resolveProfileScalar(
          profile.permission,
          lead.permissionRuleSetId,
          defaults.permissionRuleSetId,
        ),
        instructions: profile.instructions.trim() ? profile.instructions : null,
        reasoningLevel: resolveProfileScalar(
          profile.thinking,
          lead.reasoningLevel,
          defaults.reasoningLevel,
        ),
        model:
          model === "inherit"
            ? structuredClone(lead.model)
            : model === "default"
              ? defaults.model
              : parseProfileModel(name, model),
      };
      await options.validatePermission?.(config.permissionRuleSetId!);
      if (model !== "inherit") await options.models.resolve(config.model!);
      const compact = scalarValue(profile.compaction);
      const compaction =
        compact === "inherit" && inheritedCompaction
          ? inheritedCompaction
          : agentProfileCompactionToSettings(
              compact === "default"
                ? (defaults.compaction ?? "inherit")
                : compact,
            );
      return {
        name: profile.name,
        config,
        async initializeChild(childId) {
          await options.initializeCapabilities(
            parentId,
            childId,
            structuredClone(profile),
          );
          if (compaction)
            await options.harness.initialize(
              childId,
              structuredClone(compaction),
            );
        },
      };
    },
  };
}
