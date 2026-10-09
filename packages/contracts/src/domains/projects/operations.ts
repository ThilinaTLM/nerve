import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";
import {
  openProjectInEditorRequestSchema,
  openProjectInEditorResponseSchema,
  openProjectInTerminalRequestSchema,
  openProjectInTerminalResponseSchema,
} from "./project.js";
const projectId = z.object({ projectId: z.string() });
export const projectsOperationDefinitions = [
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
