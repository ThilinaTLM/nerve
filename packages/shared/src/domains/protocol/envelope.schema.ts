import { z } from "zod";

export const protocolVersionSchema = z.literal(1);

export const peerRoleSchema = z.enum([
  "orchestrator",
  "ui",
  "desktop",
  "cli",
  "agent",
  "unknown",
]);
export type PeerRole = z.infer<typeof peerRoleSchema>;

export const peerDescriptorSchema = z.object({
  role: peerRoleSchema,
  id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  instanceId: z.string().min(1).optional(),
});
export type PeerDescriptor = z.infer<typeof peerDescriptorSchema>;

export const messageKindSchema = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*$/);
export type NerveMessageKind = z.infer<typeof messageKindSchema>;

export const nerveMessageSchema = z.object({
  protocol: z.literal("nerve"),
  version: protocolVersionSchema,
  id: z.string().min(1),
  kind: messageKindSchema,
  ts: z.string().datetime(),
  source: peerDescriptorSchema.optional(),
  target: peerDescriptorSchema.optional(),
  correlationId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  replyTo: z.string().min(1).optional(),
  requiresAck: z.boolean().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  data: z.unknown(),
});
export type NerveMessage<TData = unknown> = Omit<
  z.infer<typeof nerveMessageSchema>,
  "data"
> & {
  data: TData;
};

export function typedMessageSchema<TSchema extends z.ZodType>(
  kind: string,
  dataSchema: TSchema,
) {
  return nerveMessageSchema.extend({
    kind: z.literal(kind),
    data: dataSchema,
  });
}
