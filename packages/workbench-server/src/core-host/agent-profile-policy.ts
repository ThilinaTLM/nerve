import { existsSync, readFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  agentProfileDraftSchema,
  appliedAgentProfileSchema,
  applyAgentProfileTemplate,
  DEFAULT_AGENT_PROFILE,
  type ApplyAgentProfileOptions,
  type AgentProfileSettings,
  type AppliedAgentProfile,
  type AgentProfileDraft,
} from "@nervekit/contracts/agent-profiles";
import {
  capabilityToolNameSchema,
  capabilityToolPayload,
  capabilityToolsSchema,
  emptyCapabilityOverrides,
  type CapabilitySelection,
} from "@nervekit/contracts/capabilities";
import type { ConversationConfig } from "@nervekit/contracts/core";
import type {
  AgentProfileApplication,
  AgentProfilePort,
  TurnPreparationInput,
} from "@nervekit/conversation-core";
import type { Settings } from "@nervekit/contracts/settings";
import {
  atomicWriteFile,
  atomicWriteJson,
} from "../infrastructure/storage-bootstrap/index.js";
import type { AgentProfileService } from "../domains/agent-profiles/agent-profile.service.js";
import type { CapabilityService } from "./capability.service.js";
import type { ConversationHarnessSettings } from "./conversation-harness.service.js";
import { listAvailableSkills } from "./resource-loader.js";
import type { Skill } from "@nervekit/harness/resources";

function usesApplicationSettings(profile: AgentProfileDraft): boolean {
  return [
    profile.model,
    profile.thinking,
    profile.permission,
    profile.compaction,
    profile.skills,
    ...Object.values(profile.tools ?? {}),
  ].includes("settings");
}

export function profileDefaults(settings: Settings) {
  const model = settings.defaultModel ?? settings.lastAgentSelection.model;
  if (!model)
    throw new Error("Choose a default model before creating a conversation.");
  return {
    model,
    reasoningLevel: settings.defaultThinkingLevel,
    permissionRuleSetId: settings.defaultPermissionRuleSetId,
    compaction: settings.compaction,
  };
}
export function createAgentProfilePort(options: {
  clampThinking: ApplyAgentProfileOptions["clampThinking"];
  dataPath: string;
  home: string;
  profiles(): AgentProfileService;
  settings(projectId: string): Promise<Settings>;
  parentInput(id: string): TurnPreparationInput;
  capabilities(): CapabilityService;
  harness(): ConversationHarnessSettings;
  skillCatalogs: { nerve: readonly Skill[]; agentBrowser: readonly Skill[] };
}): AgentProfilePort & {
  settingsFor(input: TurnPreparationInput): Promise<AgentProfileSettings>;
} {
  const cache = new Map<string, AppliedAgentProfile | null>();
  const paths = (id: string) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(id))
      throw new Error("Invalid conversation ID");
    const root = join(options.dataPath, "conversations", id, "config");
    return {
      applied: join(root, "applied-agent-profile.json"),
      capabilities: join(root, "capabilities.json"),
      harness: join(root, "harness.json"),
    };
  };
  const selectionSettings = async (
    input: TurnPreparationInput,
    selection: CapabilitySelection,
  ) => {
    const installed = (
      await listAvailableSkills(input.projectDir, {
        storageHome: options.home,
        nerveSkills: options.skillCatalogs.nerve,
        agentBrowserSkills: options.skillCatalogs.agentBrowser,
      })
    ).skills;
    const skills: Exclude<AgentProfileSettings["skills"], string> = {
      file: {},
      nerve: {},
      agentBrowser: {},
    };
    for (const skill of installed) {
      const kind =
        skill.source === "nerve"
          ? "nerve"
          : skill.source === "agentBrowser"
            ? "agentBrowser"
            : "file";
      skills[kind][skill.name] =
        kind === "file"
          ? !selection.disabledFileSkills.includes(skill.name)
          : kind === "nerve"
            ? selection.enabledNerveSkills.includes(skill.name)
            : selection.enabledAgentBrowserSkills.includes(skill.name);
    }
    return {
      tools: capabilityToolsSchema.parse(
        Object.fromEntries(
          capabilityToolNameSchema.options.map((name) => [
            name,
            capabilityToolPayload(selection, name),
          ]),
        ),
      ),
      skills,
    };
  };
  const settingsFor = async (
    input: TurnPreparationInput,
  ): Promise<AgentProfileSettings> => {
    const settings = await options.settings(input.conversation.projectId);
    const selection = (
      await options
        .capabilities()
        .configuration(
          input.conversation.projectId,
          input.conversation.id,
          input.capabilityOverrides,
        )
    ).effective;
    return {
      model: input.config.model,
      thinking: input.config.reasoningLevel,
      permission: input.config.permissionRuleSetId,
      compaction: input.conversation.id
        ? await options.harness().compactionSettings(input.conversation.id)
        : settings.compaction,
      ...(await selectionSettings(input, selection)),
    };
  };
  /** Application settings (project → user) without the conversation layer. */
  const applicationSettingsFor = async (
    input: TurnPreparationInput,
  ): Promise<AgentProfileSettings> => {
    const settings = await options.settings(input.conversation.projectId);
    const defaults = profileDefaults(settings);
    const selection = (
      await options
        .capabilities()
        .configuration(
          input.conversation.projectId,
          undefined,
          emptyCapabilityOverrides(),
        )
    ).inherited;
    return {
      model: defaults.model,
      thinking: defaults.reasoningLevel,
      permission: defaults.permissionRuleSetId,
      compaction: defaults.compaction,
      ...(await selectionSettings(input, selection)),
    };
  };
  const apply = async (
    input: TurnPreparationInput & {
      profile?: string;
      preserveModel?: boolean;
      preserveThinking?: boolean;
    },
    lead?: AgentProfileSettings,
  ): Promise<AgentProfileApplication> => {
    const defaults = await options.settings(input.conversation.projectId);
    const name =
      input.profile ?? defaults.defaultAgentProfile ?? DEFAULT_AGENT_PROFILE;
    const parentConfig = input.conversation.parentConversationId
      ? options.parentInput(input.conversation.parentConversationId).config
      : undefined;
    const profiles = input.agentProfileOverrides
      ? (
          await options.profiles().preview({
            projectId: input.conversation.projectId,
            profiles: input.agentProfileOverrides,
            lead: {
              model: input.config.model,
              reasoningLevel: input.config.reasoningLevel,
            },
            capabilityOverrides: input.capabilityOverrides,
          })
        ).profiles.flatMap((p) => (p.effective ? [p.effective] : []))
      : await options.profiles().list(
          input.conversation.projectId,
          undefined,
          input.config as ConversationConfig,
          parentConfig
            ? {
                model: parentConfig.model,
                reasoningLevel: parentConfig.reasoningLevel,
              }
            : undefined,
        );
    const profile = profiles.find((p) => p.name === name);
    const child = input.conversation.parentConversationId !== null;
    if (
      !profile ||
      !profile.enabled ||
      profile.error ||
      profile.trust === "untrusted" ||
      (child ? profile.usableBy === "lead" : profile.usableBy === "subagent")
    )
      throw new Error(
        `Agent profile "${name}" is not usable by this conversation.`,
      );
    const current = await settingsFor(input);
    const effectiveLead =
      lead ??
      (input.conversation.parentConversationId
        ? await settingsFor(
            options.parentInput(input.conversation.parentConversationId),
          )
        : undefined);
    const template = Object.fromEntries(
      Object.entries(profile).filter(
        ([key]) =>
          !["source", "trust", "path", "digest", "error"].includes(key),
      ),
    );

    const { settings, applied } = applyAgentProfileTemplate(
      agentProfileDraftSchema.parse(template),
      current,
      {
        lead: effectiveLead,
        settings: usesApplicationSettings(profile)
          ? await applicationSettingsFor(input)
          : undefined,
        preserveModel: input.preserveModel,
        preserveThinking: input.preserveThinking,
        clampThinking: options.clampThinking,
      },
    );
    const application: AgentProfileApplication = {
      config: {
        agentProfile: name,
        model: settings.model,
        reasoningLevel: settings.thinking,
        permissionRuleSetId: settings.permission,
      },
      applied,
    };
    if (profile.compaction !== undefined)
      application.compaction = settings.compaction;
    if (
      input.capabilityOverrides ||
      Object.keys(profile.tools).length ||
      profile.skills !== undefined
    ) {
      const document = structuredClone(
        (
          await options
            .capabilities()
            .configuration(
              input.conversation.projectId,
              input.conversation.id,
              input.capabilityOverrides,
            )
        ).conversation ?? emptyCapabilityOverrides(),
      );
      for (const [name, setting] of Object.entries(profile.tools)) {
        const key = name as keyof typeof settings.tools;
        // Reset to settings drops the conversation override so the tool follows settings.
        if (setting === "settings") delete document.tools[key];
        else Object.assign(document.tools, { [name]: settings.tools[key] });
      }
      if (profile.skills === "settings")
        document.skills = { file: {}, nerve: {}, agentBrowser: {} };
      else if (profile.skills !== undefined) {
        const prior =
          current.skills === "none"
            ? { file: {}, nerve: {}, agentBrowser: {} }
            : current.skills;
        const chosen =
          settings.skills === "none"
            ? { file: {}, nerve: {}, agentBrowser: {} }
            : settings.skills;
        for (const kind of ["file", "nerve", "agentBrowser"] as const)
          document.skills[kind] = Object.fromEntries(
            [
              ...new Set([
                ...Object.keys(prior[kind]),
                ...Object.keys(chosen[kind]),
              ]),
            ].map((name) => [name, chosen[kind][name] ?? false]),
          );
      }
      application.capabilityOverrides = document;
    }
    return application;
  };
  return {
    settingsFor,
    applyProfile: (input) => apply(input),
    getAppliedProfile(id) {
      if (!cache.has(id)) {
        const path = paths(id).applied;
        cache.set(
          id,
          existsSync(path)
            ? appliedAgentProfileSchema.parse(
                JSON.parse(readFileSync(path, "utf8")),
              )
            : null,
        );
      }
      const profile = cache.get(id)!;
      return profile ? structuredClone(profile) : null;
    },
    async persistApplication(id, application) {
      const files = paths(id);
      const updates: [string, unknown][] = [
        ...(application.compaction
          ? [
              [files.harness, { compaction: application.compaction }] as [
                string,
                unknown,
              ],
            ]
          : []),
        ...(application.capabilityOverrides
          ? [
              [files.capabilities, application.capabilityOverrides] as [
                string,
                unknown,
              ],
            ]
          : []),
        [files.applied, appliedAgentProfileSchema.parse(application.applied)],
      ];
      const backups = await Promise.all(
        updates.map(async ([path]) => {
          try {
            return await readFile(path, "utf8");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
          }
        }),
      );
      const written: number[] = [];
      try {
        for (let i = 0; i < updates.length; i++) {
          await atomicWriteJson(updates[i][0], updates[i][1]);
          written.push(i);
        }
        cache.set(id, structuredClone(application.applied));
      } catch (error) {
        const failures: unknown[] = [];
        for (const i of written.reverse()) {
          try {
            if (backups[i] === null) await rm(updates[i][0], { force: true });
            else await atomicWriteFile(updates[i][0], backups[i]);
          } catch (rollbackError) {
            failures.push(rollbackError);
          }
        }
        if (failures.length)
          throw new AggregateError(
            [error, ...failures],
            "Profile application failed and file rollback was incomplete",
            { cause: error },
          );
        throw error;
      }
    },
  };
}
