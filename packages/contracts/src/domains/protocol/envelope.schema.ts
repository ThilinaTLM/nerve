import { z } from "zod";

export const protocolVersionSchema = z.literal(1);

export const peerRoleSchema = z.enum([
  "workbench_server",
  "ui",
  "desktop_shell",
  "cli",
  "sandbox_manager",
  "sandbox_agent",
]);
export type PeerRole = z.infer<typeof peerRoleSchema>;

export const peerDescriptorSchema = z
  .object({
    role: peerRoleSchema,
    id: z.string().min(1).max(256).optional(),
    name: z.string().min(1).max(256).optional(),
    instanceId: z.string().min(1).max(256).optional(),
  })
  .strict();
export type PeerDescriptor = z.infer<typeof peerDescriptorSchema>;

export const messageKindSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*$/);
export type NerveMessageKind = z.infer<typeof messageKindSchema>;

const secretLikeKey =
  /(?:^|[_-])(authorization|cookie|credential|password|passwd|secret|token|api[_-]?key|private[_-]?key)(?:$|[_-])/i;
const maximumMetadataEntries = 32;

export const safeMetadataSchema = z
  .record(
    z.string().min(1).max(64),
    z.union([
      z.string().max(1_024),
      z.number().finite(),
      z.boolean(),
      z.null(),
    ]),
  )
  .superRefine((metadata, context) => {
    const entries = Object.entries(metadata);
    if (entries.length > maximumMetadataEntries) {
      context.addIssue({
        code: "custom",
        message: `metadata may contain at most ${maximumMetadataEntries} entries`,
      });
    }
    for (const [key] of entries) {
      if (secretLikeKey.test(key)) {
        context.addIssue({
          code: "custom",
          message: "secret-like metadata keys are forbidden",
          path: [key],
        });
      }
    }
  });
export type SafeMetadata = z.infer<typeof safeMetadataSchema>;

export const nerveMessageSchema = z
  .object({
    protocol: z.literal("nerve"),
    version: protocolVersionSchema,
    id: z.string().min(1).max(256),
    kind: messageKindSchema,
    ts: z.string().datetime(),
    source: peerDescriptorSchema,
    target: peerDescriptorSchema,
    correlationId: z.string().min(1).max(256).optional(),
    causationId: z.string().min(1).max(256).optional(),
    traceId: z.string().min(1).max(256).optional(),
    replyTo: z.string().min(1).max(256).optional(),
    requiresAck: z.boolean().optional(),
    meta: safeMetadataSchema.optional(),
    data: z.unknown(),
  })
  .strict();
export type NerveMessage<TData = unknown> = Omit<
  z.infer<typeof nerveMessageSchema>,
  "data"
> & {
  data: TData;
};

export function typedMessageSchema<
  const TKind extends string,
  TSchema extends z.ZodType,
>(kind: TKind, dataSchema: TSchema) {
  return nerveMessageSchema.extend({
    kind: z.literal(kind),
    data: dataSchema,
  });
}
