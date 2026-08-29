import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";
import { availableSkillsResponseSchema } from "./skill.js";

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
