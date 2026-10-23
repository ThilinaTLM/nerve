import {
  modelSelectionSchema,
  thinkingLevelSchema,
  type ModelSelection,
  type ThinkingLevel,
} from "../models/models.js";
import { z } from "zod";
import {
  capabilityToolsSchema,
  sameCapabilityToolSettings,
} from "../capabilities/capabilities.js";
import { permissionRuleSetIdSchema } from "../permissions/permission-rule-sets.js";
import { autoCompactionSettingsSchema } from "../settings/settings.js";
import type { ConversationConfig } from "../core/conversation.js";
import {
  agentProfileNameSchema,
  agentProfileInstructionsSchema,
} from "./constants.js";
import {
  agentProfileDraftSchema,
  agentProfileSkillsValueSchema,
  type AgentProfileDraft,
} from "./agent-profile.js";
import type { AgentProfileSetting } from "./scalar.js";

export const agentProfileSettingsSchema = z
  .object({
    model: modelSelectionSchema,
    thinking: thinkingLevelSchema,
    permission: permissionRuleSetIdSchema,
    compaction: autoCompactionSettingsSchema,
    tools: capabilityToolsSchema,
    skills: agentProfileSkillsValueSchema,
  })
  .strict();
export type AgentProfileSettings = z.infer<typeof agentProfileSettingsSchema>;
export const appliedAgentProfileLocksSchema =
  agentProfileSettingsSchema.partial();
export type AppliedAgentProfileLocks = z.infer<
  typeof appliedAgentProfileLocksSchema
>;
/** Apply-time policy only. Never resolve a source template to interpret this file. */
export const appliedAgentProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: agentProfileNameSchema,
    instructions: agentProfileInstructionsSchema,
    locked: appliedAgentProfileLocksSchema,
  })
  .strict();
export type AppliedAgentProfile = z.infer<typeof appliedAgentProfileSchema>;
export interface ApplyAgentProfileOptions {
  lead?: AgentProfileSettings;
  /** Application settings values (project → user, no conversation layer) for "settings" mode. */
  settings?: AgentProfileSettings;
  /** Preserve each approved value independently unless the target Locks that field. */
  preserveModel?: boolean;
  preserveThinking?: boolean;
  /** Host model capabilities determine supported reasoning; runs after both settings resolve. */
  clampThinking: (
    model: ModelSelection,
    thinking: ThinkingLevel,
  ) => ThinkingLevel;
}
/** One materialization algorithm for initial creation, switching and child creation. */
export function applyAgentProfileTemplate(
  profile: AgentProfileDraft,
  current: AgentProfileSettings,
  options: ApplyAgentProfileOptions,
): { settings: AgentProfileSettings; applied: AppliedAgentProfile } {
  profile = agentProfileDraftSchema.parse(profile);
  const settings = structuredClone(agentProfileSettingsSchema.parse(current));
  const locked: AppliedAgentProfileLocks = {};
  function value<T>(
    setting: AgentProfileSetting<T> | undefined,
    field: keyof AgentProfileSettings,
    parent: T | undefined,
    fromSettings: T | undefined,
  ): { value: T; lock: boolean } | undefined {
    if (setting === undefined) return;
    if (setting === "lead") {
      if (!options.lead || parent === undefined)
        throw new Error(`Same as lead requires a lead context for ${field}`);
      return { value: structuredClone(parent), lock: false };
    }
    if (typeof setting === "object" && "lock" in setting)
      return { value: structuredClone(setting.lock), lock: true };
    if (
      (field === "model" && options.preserveModel) ||
      (field === "thinking" && options.preserveThinking)
    )
      return;
    if (setting === "settings") {
      if (!options.settings || fromSettings === undefined)
        throw new Error(`Reset to settings requires settings for ${field}`);
      return { value: structuredClone(fromSettings), lock: false };
    }
    return { value: structuredClone(setting.set), lock: false };
  }
  const model = value(
    profile.model,
    "model",
    options.lead?.model,
    options.settings?.model,
  );
  if (model) {
    settings.model = model.value;
    if (model.lock) locked.model = structuredClone(model.value);
  }
  const thinking = value(
    profile.thinking,
    "thinking",
    options.lead?.thinking,
    options.settings?.thinking,
  );
  if (thinking) {
    settings.thinking = thinking.value;
    if (thinking.lock) locked.thinking = thinking.value;
  }
  settings.thinking = options.clampThinking(settings.model, settings.thinking);
  if (thinking?.lock) locked.thinking = settings.thinking;
  const permission = value(
    profile.permission,
    "permission",
    options.lead?.permission,
    options.settings?.permission,
  );
  if (permission) {
    settings.permission = permission.value;
    if (permission.lock) locked.permission = permission.value;
  }
  const compaction = value(
    profile.compaction,
    "compaction",
    options.lead?.compaction,
    options.settings?.compaction,
  );
  if (compaction) {
    settings.compaction = compaction.value;
    if (compaction.lock) locked.compaction = structuredClone(compaction.value);
  }
  const skills = value(
    profile.skills,
    "skills",
    options.lead?.skills,
    options.settings?.skills,
  );
  if (skills) {
    settings.skills = skills.value;
    if (skills.lock) locked.skills = structuredClone(skills.value);
  }
  for (const [name, setting] of Object.entries(profile.tools ?? {})) {
    const key = name as keyof AgentProfileSettings["tools"];
    const change = value<
      NonNullable<AgentProfileSettings["tools"][typeof key]>
    >(setting, "tools", options.lead?.tools[key], options.settings?.tools[key]);
    if (!change) continue;
    const payload =
      setting === "lead" || setting === "settings"
        ? change.value
        : { ...settings.tools[key], ...change.value };
    Object.assign(settings.tools, { [name]: payload });
    if (change.lock) {
      locked.tools ??= {};
      Object.assign(locked.tools, { [name]: structuredClone(payload) });
    }
  }
  return {
    settings: agentProfileSettingsSchema.parse(settings),
    applied: appliedAgentProfileSchema.parse({
      schemaVersion: 1,
      name: profile.name,
      instructions: profile.instructions,
      locked,
    }),
  };
}
export function assertAppliedProfileConfigChange(
  applied: AppliedAgentProfile | null | undefined,
  patch: Partial<ConversationConfig>,
): void {
  if (!applied) return;
  const locks = applied.locked;
  if (
    locks.model &&
    patch.model !== undefined &&
    !sameCapabilityToolSettings(patch.model, locks.model)
  )
    throw new Error(`Model is locked by ${applied.name}`);
  if (
    locks.thinking !== undefined &&
    patch.reasoningLevel !== undefined &&
    patch.reasoningLevel !== locks.thinking
  )
    throw new Error(`Thinking is locked by ${applied.name}`);
  if (
    locks.permission !== undefined &&
    patch.permissionRuleSetId !== undefined &&
    patch.permissionRuleSetId !== locks.permission
  )
    throw new Error(`Permission is locked by ${applied.name}`);
}
/** Host mutation paths use this against the resulting effective settings, including resets. */
export function assertAppliedProfileSettingsChange(
  applied: AppliedAgentProfile | null | undefined,
  next: Partial<AgentProfileSettings>,
): void {
  if (!applied) return;
  for (const field of [
    "model",
    "thinking",
    "permission",
    "compaction",
    "skills",
  ] as const)
    if (
      applied.locked[field] !== undefined &&
      next[field] !== undefined &&
      !sameCapabilityToolSettings(applied.locked[field], next[field])
    )
      throw new Error(`${field} is locked by ${applied.name}`);
  for (const [name, locked] of Object.entries(applied.locked.tools ?? {})) {
    const candidate =
      next.tools?.[name as keyof NonNullable<typeof next.tools>];
    if (
      next.tools !== undefined &&
      !sameCapabilityToolSettings(locked, candidate)
    )
      throw new Error(`${name} is locked by ${applied.name}`);
  }
}
