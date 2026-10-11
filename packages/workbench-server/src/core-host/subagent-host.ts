import type { ConversationConfig } from "@nervekit/contracts/core";
import type { ModelSelection } from "@nervekit/contracts/models";
import type { SubagentProfile } from "@nervekit/contracts/subagents";
import type { ModelPort, SubagentHost } from "@nervekit/conversation-core";
import { subagentCompactionToSettings } from "../domains/subagents/subagent-compaction.js";
import type { SubagentProfileService } from "../domains/subagents/subagent-profile.service.js";
import type { ConversationHarnessSettings } from "./conversation-harness.service.js";

export interface SubagentHostOptions {
  profiles: Pick<SubagentProfileService, "usable" | "find">;
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

function parseModel(profile: string, value: string): ModelSelection {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1)
    throw new Error(
      `Profile ${profile}: model "${value}" must be "lead" or "<provider>/<modelId>"`,
    );
  return { provider: value.slice(0, slash), modelId: value.slice(slash + 1) };
}

export function createSubagentHost(options: SubagentHostOptions): SubagentHost {
  const usableNames = async (projectId: string) =>
    (await options.profiles.usable(projectId)).map((profile) => profile.name);

  const usableProfile = async (parentId: string, name: string) => {
    const { projectId } = options.parent(parentId);
    const profile = await options.profiles.find(projectId, name);
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
      const usable = await usableNames(projectId);
      throw new Error(
        `Sub-agent profile "${name}" ${reason}. Usable profiles: ${usable.join(", ") || "none"}.`,
      );
    }
    return profile;
  };

  return {
    async usableProfiles(parentId) {
      return usableNames(options.parent(parentId).projectId);
    },

    async resolveProfile({ parentId, profile: name }) {
      const profile = await usableProfile(parentId, name);
      const lead = options.parent(parentId).config;
      const config: ResolvedConfig = {
        permissionRuleSetId: profile.permission,
        instructions: profile.instructions.trim() ? profile.instructions : null,
        reasoningLevel:
          profile.thinking === "lead" ? lead.reasoningLevel : profile.thinking,
      };
      if (profile.model === "lead") config.model = lead.model;
      else {
        const model = parseModel(name, profile.model);
        try {
          await options.models.resolve(model);
        } catch (error) {
          throw new Error(
            `Sub-agent profile "${name}": model ${profile.model} is not available (${error instanceof Error ? error.message : String(error)}). Choose another model in Settings → Sub-agents.`,
            { cause: error },
          );
        }
        config.model = model;
      }
      return { name: profile.name, config };
    },

    async initializeChild({ parentId, childId, profile: name }) {
      const profile = await usableProfile(parentId, name);
      await options.initializeCapabilities(parentId, childId, profile);
      const compaction = subagentCompactionToSettings(profile.compaction);
      if (compaction) await options.harness.initialize(childId, compaction);
    },
  };
}
