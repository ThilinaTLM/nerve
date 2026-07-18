import type { z } from "zod";
import type { PeerRole } from "../protocol/envelope.schema.js";
import { publicEventDataGuardSchema } from "./bounded-public-data.schema.js";

export type EventCoalescing = "latest_by_scope" | "concat_delta";
export type EventDelivery = "sequenced" | "ephemeral";

export interface PublicEventDefinition {
  readonly name: string;
  readonly payloadSchema: z.ZodType;
  readonly delivery: EventDelivery;
  readonly supersedable: boolean;
  readonly allowedSourceRoles: readonly PeerRole[];
  readonly coalescing?: EventCoalescing;
  readonly scope: readonly string[];
}

const hostRoles = ["workbench_server", "sandbox_agent"] as const;

export function definePublicEvent(
  name: string,
  payloadSchema: z.ZodType,
  options: Partial<Omit<PublicEventDefinition, "name" | "payloadSchema">> = {},
): PublicEventDefinition {
  return {
    name,
    payloadSchema: publicEventDataGuardSchema.transform((value) =>
      payloadSchema.parse(value),
    ),
    delivery: options.delivery ?? "sequenced",
    supersedable: options.supersedable ?? false,
    allowedSourceRoles: options.allowedSourceRoles ?? hostRoles,
    coalescing:
      options.delivery === "ephemeral" ? options.coalescing : undefined,
    scope: options.scope ?? [],
  };
}
