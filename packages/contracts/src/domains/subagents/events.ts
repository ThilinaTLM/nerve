import { z } from "zod";
import { definePublicEvent } from "../../events/definition.js";

/** Scoped profile document changed; clients refetch the affected configuration. */
export const subagentProfilesChangedEventSchema = z.object({
  /** Absent when user-level or built-in profiles changed. */
  projectId: z.string().startsWith("proj_").optional(),
  /** Present only for conversation-local changes. */
  conversationId: z.string().min(1).optional(),
});
export type SubagentProfilesChangedEvent = z.infer<
  typeof subagentProfilesChangedEventSchema
>;

export const subagentProfileEventDefinitions = [
  definePublicEvent(
    "subagentProfiles.changed",
    subagentProfilesChangedEventSchema,
    { allowedSourceRoles: ["workbench_server"] as const },
  ),
];
