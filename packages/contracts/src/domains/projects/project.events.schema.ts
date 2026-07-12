import { z } from "zod";
import { definePublicEvent } from "../events/event-definition.schema.js";
import {
  projectRecordSchema,
  pruneProjectConversationsResponseSchema,
} from "./project.schema.js";

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
    "project.conversations.pruned",
    pruneProjectConversationsResponseSchema,
    { allowedSourceRoles: workbenchRoles, scope: ["projectId"] },
  ),
];
