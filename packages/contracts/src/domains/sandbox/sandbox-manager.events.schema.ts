import { z } from "zod";
import { definePublicEvent } from "../events/event-definition.schema.js";
import {
  managedContainerRefSchema,
  managedSandboxLifecycleStateSchema,
  managedSandboxObservedStateSchema,
  sandboxActivitySummarySchema,
} from "./sandbox.manager.schema.js";

const managerRoles = ["sandbox_manager"] as const;

export const sandboxManagerEventDefinitions = [
  definePublicEvent(
    "sandbox.lifecycle.changed",
    z.object({
      sandboxId: z.string().min(1),
      previous: managedSandboxLifecycleStateSchema.optional(),
      current: managedSandboxLifecycleStateSchema,
      changedAt: z.string().datetime(),
      reason: z.string().max(1_024).optional(),
    }),
    { allowedSourceRoles: managerRoles, scope: ["sandboxId"] },
  ),
  definePublicEvent(
    "container.lifecycle.changed",
    z.object({
      sandboxId: z.string().min(1),
      container: managedContainerRefSchema.optional(),
      previous: managedSandboxObservedStateSchema.optional(),
      current: managedSandboxObservedStateSchema,
      changedAt: z.string().datetime(),
      reason: z.string().max(1_024).optional(),
    }),
    { allowedSourceRoles: managerRoles, scope: ["sandboxId"] },
  ),
  definePublicEvent(
    "sandbox.daemon.connection_changed",
    z.object({
      sandboxId: z.string().min(1),
      previous: z.enum(["connected", "disconnected"]).optional(),
      current: z.enum(["connected", "disconnected"]),
      changedAt: z.string().datetime(),
      reason: z.string().max(1_024).optional(),
    }),
    { allowedSourceRoles: managerRoles, scope: ["sandboxId"] },
  ),
  definePublicEvent("sandbox.activity.changed", sandboxActivitySummarySchema, {
    allowedSourceRoles: managerRoles,
    delivery: "ephemeral",
    coalescing: "latest_by_scope",
    scope: ["sandboxId"],
  }),
];
