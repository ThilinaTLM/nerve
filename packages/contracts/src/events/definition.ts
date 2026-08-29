import type { z } from "zod";
import type { PeerRole } from "../wire/envelope.js";
import {
  boundedPublicContentJsonSchema,
  publicEventDataGuardSchema,
} from "./bounded-public-data.js";

export type EventCoalescing =
  | { strategy: "latest_by_scope" }
  | {
      strategy: "concat_delta";
      field: "delta" | "text";
      offsetField?: "offset";
      maxChars: number;
    };
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

const hostRoles = ["workbench_server"] as const;

function defineBoundedEvent(
  guard: z.ZodType,
  name: string,
  payloadSchema: z.ZodType,
  options: Partial<Omit<PublicEventDefinition, "name" | "payloadSchema">> = {},
): PublicEventDefinition {
  return {
    name,
    payloadSchema: guard.transform((value) => payloadSchema.parse(value)),
    delivery: options.delivery ?? "sequenced",
    supersedable: options.supersedable ?? false,
    allowedSourceRoles: options.allowedSourceRoles ?? hostRoles,
    coalescing:
      options.delivery === "ephemeral" ? options.coalescing : undefined,
    scope: options.scope ?? [],
  };
}

export function definePublicEvent(
  name: string,
  payloadSchema: z.ZodType,
  options: Partial<Omit<PublicEventDefinition, "name" | "payloadSchema">> = {},
): PublicEventDefinition {
  return defineBoundedEvent(
    publicEventDataGuardSchema,
    name,
    payloadSchema,
    options,
  );
}

/**
 * Variant of {@link definePublicEvent} for events whose payloads carry
 * authoritative, potentially large content (e.g. conversation entries with
 * message text and thinking blocks). The payload is validated with the
 * content-sized guard: a total byte ceiling for broadcast safety, but no
 * per-string length cap so model content is never rejected.
 */
export function defineContentEvent(
  name: string,
  payloadSchema: z.ZodType,
  options: Partial<Omit<PublicEventDefinition, "name" | "payloadSchema">> = {},
): PublicEventDefinition {
  return defineBoundedEvent(
    boundedPublicContentJsonSchema,
    name,
    payloadSchema,
    options,
  );
}
