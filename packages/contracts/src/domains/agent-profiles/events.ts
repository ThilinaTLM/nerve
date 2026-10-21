import { z } from "zod";
import { definePublicEvent } from "../../events/definition.js";

/** Scoped profile document changed; clients refetch the affected configuration. */
export const agentProfilesChangedEventSchema = z.object({
  /** Absent when user-level or built-in profiles changed. */
  projectId: z.string().startsWith("proj_").optional(),
  /** Present only for conversation-local changes. */
  conversationId: z.string().min(1).optional(),
});
export type AgentProfilesChangedEvent = z.infer<
  typeof agentProfilesChangedEventSchema
>;

export const agentProfileEventDefinitions = [
  definePublicEvent("agentProfiles.changed", agentProfilesChangedEventSchema, {
    allowedSourceRoles: ["workbench_server"] as const,
  }),
];
