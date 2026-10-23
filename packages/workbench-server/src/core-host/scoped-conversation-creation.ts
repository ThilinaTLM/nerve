import {
  childLaunchOverridesSchema,
  freezeChildPreferences,
  resolveAgentConfiguration,
  type AppliedProfile,
  type LeadSettingsOverrides,
  leadSettingsOverridesSchema,
} from "@nervekit/contracts/agent-configuration";
import type {
  AgentConfigurationPort,
  AgentProfileApplication,
  SubagentHost,
} from "@nervekit/conversation-core";
import type { AgentConfigurationService } from "../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import { requireReady } from "./scoped-agent-configuration.js";

/** Preflight advertises names; new-child creation revalidates them at the actual launch boundary. */
export function scopedConversationCreation(
  service: AgentConfigurationService,
  validateChildPermission: (id: string) => Promise<void>,
) {
  const launches = new WeakMap<
    Pick<AgentProfileApplication, "config">,
    { parentId: string; profile: string }
  >();
  async function resolve(
    projectId: string,
    name: string,
    parentId?: string,
    choices?: LeadSettingsOverrides,
    targetDigest?: string,
  ) {
    while (true) {
      const defaults = await service.captureDefaults(projectId);
      const profile = await service.profiles.get(
        name,
        projectId,
        parentId ? "child" : "lead",
      );
      if (profile.status !== "available")
        throw new Error(`Profile unavailable: ${name}`);
      if (targetDigest && profile.digest !== targetDigest)
        throw new Error("Selected creation profile changed; refresh selection");
      const applied: AppliedProfile = {
        name,
        source: profile.source,
        sourceDigest: profile.digest,
        instructions: profile.definition.instructions,
        recommendations: profile.definition.recommendations ?? {},
        requirements: profile.definition.requirements ?? {},
      };
      let launch;
      let currentParent: (() => boolean) | undefined;
      if (parentId) {
        const parent = await service.captureEffective(parentId);
        if (parent.view.status !== "available" || parent.view.role !== "lead")
          throw new Error("Children cannot delegate");
        const selected = parent.view.resolution.settings.subagents?.[name];
        if (
          !selected ||
          selected.enabled === false ||
          parent.view.resolution.settings.tools?.subagents?.enabled !== true
        )
          throw new Error(`Sub-agent profile disabled: ${name}`);
        const choices = { ...selected };
        delete choices.enabled;
        launch = childLaunchOverridesSchema.parse(choices);
        currentParent = parent.isCurrent;
      }
      const resolution = resolveAgentConfiguration({
        ...defaults.options,
        role: parentId ? "child" : "lead",
        appliedProfile: applied,
        ...(!parentId && choices ? { conversation: choices } : {}),
        ...(launch ? { launch } : {}),
      });
      requireReady(resolution);
      if (parentId)
        await validateChildPermission(resolution.settings.permissionRuleSetId!);
      const frozenDefaults = parentId
        ? freezeChildPreferences({
            ...defaults.options,
            appliedProfile: applied,
            launch,
          })
        : undefined;
      if (!defaults.isCurrent() || (currentParent && !currentParent()))
        continue;
      return {
        applied,
        resolution,
        frozenDefaults,
        isCurrent: () =>
          defaults.isCurrent() && (!currentParent || currentParent()),
      };
    }
  }
  const childHost: SubagentHost = {
    async usableProfiles(parentId) {
      const capture = await service.captureEffective(parentId);
      if (capture.view.status !== "available" || capture.view.role !== "lead")
        throw new Error("Children cannot delegate");
      const owner = capture.view.sources.find(
        (source) => source.scope.scope === "project",
      )?.scope;
      if (!owner || owner.scope !== "project")
        throw new Error("Project configuration unavailable");
      const usable: string[] = [];
      for (const name of Object.keys(
        capture.view.resolution.settings.subagents ?? {},
      )) {
        try {
          await resolve(owner.projectId, name, parentId);
          usable.push(name);
        } catch {
          /* Isolated unavailable candidates do not hide usable profiles. */
        }
      }
      return usable;
    },
    async resolveProfile({ parentId, profile }) {
      const capture = await service.captureEffective(parentId);
      if (capture.view.status !== "available" || capture.view.role !== "lead")
        throw new Error("Children cannot delegate");
      const scope = capture.view.sources.find(
        (source) => source.scope.scope === "project",
      )?.scope;
      if (!scope || scope.scope !== "project")
        throw new Error("Project configuration unavailable");
      const resolved = await resolve(scope.projectId, profile, parentId);
      const settings = resolved.resolution.settings;
      const application: Pick<AgentProfileApplication, "config"> = {
        config: {
          agentProfile: profile,
          model: settings.model!,
          reasoningLevel: settings.reasoningLevel!,
          permissionRuleSetId: settings.permissionRuleSetId!,
        },
      };
      launches.set(application, { parentId, profile });
      return { name: profile, application };
    },
  };
  const initializeConversation: AgentConfigurationPort["initializeConversation"] =
    async (input) => {
      const child = Boolean(input.parentConversationId);
      const selection = input.application && launches.get(input.application);
      if (
        child &&
        (!selection || selection.parentId !== input.parentConversationId)
      )
        throw new Error("Child creation requires a trusted launch selection");
      const creation = child
        ? undefined
        : await service.getCreationPreferences(input.projectId);
      if (creation?.status === "unavailable")
        throw new Error("Creation preferences unavailable");
      const name = child
        ? selection!.profile
        : (input.agentProfile?.name ?? creation!.overrides.defaultAgentProfile);
      const resolved = await resolve(
        input.projectId,
        name,
        input.parentConversationId ?? undefined,
        !child
          ? leadSettingsOverridesSchema.parse(input.overrides ?? {})
          : undefined,
        !child ? input.agentProfile?.digest : undefined,
      );
      const context = {
        ...(input.config?.instructions != null
          ? { instructions: input.config.instructions }
          : {}),
        ...(input.config?.systemPrompt != null
          ? { systemPrompt: input.config.systemPrompt }
          : {}),
      };
      await service.createConversation(
        input.id,
        {
          schemaVersion: 1,
          revision: 1,
          overrides: child
            ? {}
            : leadSettingsOverridesSchema.parse(input.overrides ?? {}),
          appliedProfile: resolved.applied,
          ...(Object.keys(context).length ? { context } : {}),
          ...(child ? { frozenDefaults: resolved.frozenDefaults } : {}),
        },
        resolved.isCurrent,
      );
    };
  return {
    childHost,
    initializeConversation,
    async prepareCreation(
      input:
        | Parameters<AgentConfigurationPort["initializeConversation"]>[0]
        | Omit<
            Parameters<AgentConfigurationPort["initializeConversation"]>[0],
            "id"
          >,
    ) {
      const child = Boolean(input.parentConversationId);
      const selection = input.application && launches.get(input.application);
      if (
        child &&
        (!selection || selection.parentId !== input.parentConversationId)
      )
        throw new Error("Child creation requires a trusted launch selection");
      const creation = child
        ? undefined
        : await service.getCreationPreferences(input.projectId);
      if (creation?.status === "unavailable")
        throw new Error("Creation preferences unavailable");
      const name = child
        ? selection!.profile
        : (input.agentProfile?.name ?? creation!.overrides.defaultAgentProfile);
      const resolved = await resolve(
        input.projectId,
        name,
        input.parentConversationId ?? undefined,
        child
          ? undefined
          : leadSettingsOverridesSchema.parse(input.overrides ?? {}),
        child ? undefined : input.agentProfile?.digest,
      );
      return {
        model: resolved.resolution.settings.model!,
        reasoningLevel: resolved.resolution.settings.reasoningLevel!,
        permissionRuleSetId: resolved.resolution.settings.permissionRuleSetId!,
        agentProfile: resolved.applied.name,
        systemPrompt: input.config?.systemPrompt ?? null,
        instructions: input.config?.instructions ?? null,
        workingDirectory:
          input.config?.workingDirectory ??
          service.paths.locations.projectDirectory(input.projectId)!,
      };
    },
    async defaults(projectId: string) {
      const creation = await service.getCreationPreferences(projectId);
      if (creation.status !== "available")
        throw new Error("Creation preferences unavailable");
      const resolved = await resolve(
        projectId,
        creation.overrides.defaultAgentProfile,
      );
      return {
        settings: resolved.resolution.settings,
        profile: resolved.applied.name,
      };
    },
  };
}
