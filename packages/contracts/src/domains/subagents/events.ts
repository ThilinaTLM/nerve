import { z } from "zod";
import { definePublicEvent } from "../../events/definition.js";

/** Profiles changed on disk or in preferences; clients refetch `subagentProfiles.list`. */
export const subagentProfilesChangedEventSchema = z.object({
  /** Absent when user-level or built-in profiles changed. */
  projectId: z.string().startsWith("proj_").optional(),
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
