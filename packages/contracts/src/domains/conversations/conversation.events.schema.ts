import { z } from "zod";
import { definePublicEvent } from "../events/event-definition.schema.js";
import { projectRecordSchema } from "../projects/project.schema.js";
import {
  conversationEntrySchema,
  conversationRecordSchema,
} from "./tree.schema.js";

const workbenchRoles = ["workbench_server"] as const;
const conversationIdSchema = z.string().startsWith("conv_");
const entryIdSchema = z.string().startsWith("entry_");

export const conversationLifecycleEventDefinitions = [
  definePublicEvent(
    "conversation.created",
    z.object({ conversation: conversationRecordSchema }),
    { allowedSourceRoles: workbenchRoles, scope: ["conversation.id"] },
  ),
  definePublicEvent(
    "conversation.updated",
    z.object({ conversation: conversationRecordSchema }),
    {
      allowedSourceRoles: workbenchRoles,
      coalescing: "latest_by_scope",
      scope: ["conversation.id"],
    },
  ),
  definePublicEvent(
    "conversation.deleted",
    z.object({
      conversationId: conversationIdSchema,
      projectId: z.string().startsWith("proj_"),
    }),
    { allowedSourceRoles: workbenchRoles, scope: ["conversationId"] },
  ),
  definePublicEvent(
    "conversation.navigated",
    z.object({
      conversationId: conversationIdSchema,
      activeEntryId: entryIdSchema.optional(),
      targetEntryId: entryIdSchema.optional(),
      summaryEntry: conversationEntrySchema.optional(),
    }),
    { allowedSourceRoles: workbenchRoles, scope: ["conversationId"] },
  ),
  definePublicEvent(
    "conversation.branch_summarized",
    z.object({
      conversationId: conversationIdSchema,
      fromEntryId: entryIdSchema.optional(),
      targetEntryId: entryIdSchema.optional(),
      entry: conversationEntrySchema,
    }),
    { allowedSourceRoles: workbenchRoles, scope: ["conversationId"] },
  ),
  definePublicEvent(
    "conversation.imported",
    z.object({
      project: projectRecordSchema,
      conversation: conversationRecordSchema,
      entryCount: z.number().int().nonnegative().safe(),
    }),
    { allowedSourceRoles: workbenchRoles, scope: ["conversation.id"] },
  ),
];
