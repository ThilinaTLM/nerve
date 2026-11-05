import { z } from "zod";
import { definePublicEvent } from "../../events/definition.js";
import { deviceSchema } from "./access.js";

const workbenchRoles = ["workbench_server"] as const;

export const accessEventDefinitions = [
  /** A device redeemed a pairing code or signed in with a passkey. */
  definePublicEvent(
    "access.device_paired",
    z.object({ device: deviceSchema }),
    {
      allowedSourceRoles: workbenchRoles,
      scope: ["device.id"],
    },
  ),
  definePublicEvent(
    "access.device_revoked",
    z.object({
      deviceId: z.string(),
      reason: z.enum(["revoked", "logout", "all"]),
    }),
    { allowedSourceRoles: workbenchRoles, scope: ["deviceId"] },
  ),
  /** Passkey list or enrollment state changed. */
  definePublicEvent(
    "access.passkeys_changed",
    z.object({ count: z.number().int() }),
    {
      allowedSourceRoles: workbenchRoles,
    },
  ),
];
