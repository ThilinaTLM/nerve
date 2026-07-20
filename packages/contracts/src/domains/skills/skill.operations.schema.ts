import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";
import { availableSkillsResponseSchema } from "./skill.schema.js";

const listSkillsParamsSchema = z
  .object({
    projectId: z.string().startsWith("proj_").optional(),
  })
  .optional();

export const skillOperationDefinitions = [
  defineOperation(
    "skill.list",
    listSkillsParamsSchema,
    availableSkillsResponseSchema,
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.skill.list",
  ),
] as const;
