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
    ["workbench_server"] as const,
    "operation.project.configuration.health",
  ),
  defineOperation(
    "project.configuration.resolve",
    projectId.and(resolveProjectConfigurationSchema),
    projectConfigurationHealthSchema,
    "mutation",
    ["workbench_server"] as const,
    "operation.project.configuration.resolve",
  ),
  defineOperation(
    "project.openEditor",
    projectId.merge(openProjectInEditorRequestSchema),
    openProjectInEditorResponseSchema,
    "mutation",
    ["workbench_server"] as const,
    "operation.project.openEditor",
  ),
  defineOperation(
    "project.openTerminal",
    projectId.merge(openProjectInTerminalRequestSchema),
    openProjectInTerminalResponseSchema,
    "mutation",
    ["workbench_server"] as const,
    "operation.project.openTerminal",
  ),
] as const;
