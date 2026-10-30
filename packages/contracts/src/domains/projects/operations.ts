import {
  projectInstructionsListParamsSchema,
  projectInstructionsListResultSchema,
} from "./project-instructions.js";
import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";
import {
  openProjectInEditorRequestSchema,
  openProjectInEditorResponseSchema,
  openProjectInTerminalRequestSchema,
  openProjectInTerminalResponseSchema,
} from "./project.js";
import {
  projectConfigurationHealthSchema,
  resolveProjectConfigurationSchema,
} from "./configuration-health.js";

const projectId = z.object({ projectId: z.string() });
export const projectsOperationDefinitions = [
  defineOperation(
    "project.configuration.health",
    projectId,
    projectConfigurationHealthSchema,
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.project.configuration.health",
  ),
  defineOperation(
    "project.configuration.resolve",
    projectId.and(resolveProjectConfigurationSchema),
    projectConfigurationHealthSchema,
    "mutation",
    "none",
    ["workbench_server"] as const,
    "operation.project.configuration.resolve",
  ),
  defineOperation(
    "projectInstructions.list",
    projectInstructionsListParamsSchema,
    projectInstructionsListResultSchema,
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.projectInstructions.list",
  ),
  defineOperation(
    "project.openEditor",
    projectId.merge(openProjectInEditorRequestSchema),
    openProjectInEditorResponseSchema,
    "mutation",
    "none",
    ["workbench_server"] as const,
    "operation.project.openEditor",
  ),
  defineOperation(
    "project.openTerminal",
    projectId.merge(openProjectInTerminalRequestSchema),
    openProjectInTerminalResponseSchema,
    "mutation",
    "none",
    ["workbench_server"] as const,
    "operation.project.openTerminal",
  ),
] as const;
