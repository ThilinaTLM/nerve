import { z } from "zod";
import { definePublicEvent } from "../../events/definition.js";

const workbenchRoles = ["workbench_server"] as const;

export const daemonEventDefinitions = [
  definePublicEvent(
    "daemon.started",
    z.object({
      daemonId: z.string().startsWith("daemon_"),
      pid: z.number().int().positive().safe(),
      host: z.string().min(1).max(253),
      port: z.number().int().positive().max(65_535),
      dataDir: z.string().min(1).max(4_096),
    }),
    { allowedSourceRoles: workbenchRoles, scope: ["daemonId"] },
  ),
  definePublicEvent(
    "daemon.stopped",
    z.object({
      daemonId: z.string().startsWith("daemon_"),
      signal: z.string().min(1).max(32),
    }),
    { allowedSourceRoles: workbenchRoles, scope: ["daemonId"] },
  ),
];
