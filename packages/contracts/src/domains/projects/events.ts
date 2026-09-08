import { z } from "zod";
import { capabilityOriginSchema } from "../capabilities/capabilities.js";
import { definePublicEvent } from "../../events/definition.js";
import {
  projectRecordSchema,
  projectPermissionsSchema,
  pruneProjectConversationsSummarySchema,
} from "./project.js";

const workbenchRoles = ["workbench_server"] as const;

export const projectEventDefinitions = [
  definePublicEvent(
    "project.created",
    z.object({ project: projectRecordSchema }),
    { allowedSourceRoles: workbenchRoles, scope: ["project.id"] },
  ),
  definePublicEvent(
    "project.deleted",
    z.object({ projectId: z.string().startsWith("proj_") }),
    { allowedSourceRoles: workbenchRoles, scope: ["projectId"] },
  ),
  definePublicEvent(
    "project.permissions.updated",
    z.object({
      projectId: z.string().startsWith("proj_"),
      permissions: projectPermissionsSchema,
    }),
    { allowedSourceRoles: workbenchRoles, scope: ["projectId"] },
  ),
  definePublicEvent(
    "project.capabilities.changed",
    z.object({
      projectId: z.string().startsWith("proj_"),
      conversationId: z.string().startsWith("conv_").optional(),
      origin: capabilityOriginSchema,
    }),
    {
      allowedSourceRoles: workbenchRoles,
      scope: ["projectId", "conversationId"],
    },
  ),
  definePublicEvent(
    "project.conversations.pruned",
    pruneProjectConversationsSummarySchema,
    { allowedSourceRoles: workbenchRoles, scope: ["projectId"] },
  ),
];
