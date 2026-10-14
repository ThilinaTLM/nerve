import type { ConversationConfig } from "@nervekit/contracts/core";
import type { SubagentProfile } from "@nervekit/contracts/subagents";
import type { ModelPort, SubagentHost } from "@nervekit/conversation-core";
import { subagentCompactionToSettings } from "../domains/subagents/subagent-compaction.js";
import type { SubagentProfileService } from "../domains/subagents/subagent-profile.service.js";
import {
  availableProfileSnapshot,
  parseProfileModel,
  type ProfileAvailability,
} from "./subagent-profile-availability.js";
import type { ConversationHarnessSettings } from "./conversation-harness.service.js";

export interface SubagentHostOptions {
  profiles: Pick<SubagentProfileService, "usable" | "find">;
  availability: ProfileAvailability;
  models: ModelPort;
  harness: Pick<ConversationHarnessSettings, "initialize">;
  /** The parent's project and current configuration. */
  parent(parentId: string): { projectId: string; config: ConversationConfig };
  initializeCapabilities(
    parentId: string,
    childId: string,
    profile: SubagentProfile,
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
          : profile.trust === "untrusted"
            ? "is not trusted yet; trust it in Settings → Sub-agents"
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
      const profile = await usableProfile(parentId, name, parent);
      const lead = parent.config;
      const config: ResolvedConfig = {
        permissionRuleSetId: profile.permission,
        instructions: profile.instructions.trim() ? profile.instructions : null,
        reasoningLevel:
          profile.thinking === "lead" ? lead.reasoningLevel : profile.thinking,
      };
      config.model =
        profile.model === "lead"
          ? structuredClone(lead.model)
          : parseProfileModel(name, profile.model);
      if (profile.model !== "lead") await options.models.resolve(config.model);
      const compaction = subagentCompactionToSettings(profile.compaction);
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
