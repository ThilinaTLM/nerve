import { z } from "zod";
import { definePublicEvent } from "../events/event-definition.schema.js";

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
];
