import { z } from "zod";
import { extensionGrantSnapshotSchema } from "../extensions/catalog.js";
import { mcpGrantSnapshotSchema } from "../mcp/schemas.js";

/** See docs/architecture/trust.md. Kinds are validated here, not by SQL, so a new kind needs no table rebuild. */
export const trustedResourceKindSchema = z.enum([
  "prompt_suggestion",
  "permissions",
  "capabilities",
  "permission_rule_set",
  "agent_profile",
  "skill",
  "extension",
  "mcp_server",
]);
export const trustedResourceStatusSchema = z.enum(["trusted", "rejected"]);
/** `sha256:<hex>` of the approved content; the prefix lets the algorithm change later. */
export const trustedContentDigestSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]+$/, "Expected sha256:<hex>");

/** Prefixes a raw sha256 hex digest; an already prefixed digest is returned unchanged. */
export const toTrustedDigest = (hex: string): string =>
  hex.startsWith("sha256:") ? hex : `sha256:${hex}`;

/**
 * The `grants` of every kind but `extension` and `mcp_server`: the review items the user saw when
 * deciding (`ConfigurationReviewItem.text`), so the next review can mark what is new. A decision
 * made without a review (a save through Nerve's own UI) has none.
 */
export const configurationReviewSnapshotSchema = z.strictObject({
  items: z.array(z.string().max(2_048)).max(512),
});
export type ConfigurationReviewSnapshot = z.infer<
  typeof configurationReviewSnapshotSchema
>;

const trustedGrantsSchema = z
  .union([
    extensionGrantSnapshotSchema,
    mcpGrantSnapshotSchema,
    configurationReviewSnapshotSchema,
  ])
  .nullable();

/** The `grants` a kind stores: its own snapshot for `extension` and `mcp_server`, else the review snapshot. */
export function trustedResourceGrantsSchema(
  kind: z.infer<typeof trustedResourceKindSchema>,
) {
  return kind === "extension"
    ? extensionGrantSnapshotSchema.nullable()
    : kind === "mcp_server"
      ? mcpGrantSnapshotSchema.nullable()
      : configurationReviewSnapshotSchema.nullable();
}

const trustedResourceShape = z.object({
  id: z.string(),
  kind: trustedResourceKindSchema,
  projectId: z.string().nullable(),
  resourceKey: z.string(),
  name: z.string().nullable(),
  contentDigest: trustedContentDigestSchema,
  status: trustedResourceStatusSchema,
  grants: trustedGrantsSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const trustedResourceSchema = trustedResourceShape.superRefine(
  (value, context) => {
    const result = trustedResourceGrantsSchema(value.kind).safeParse(
      value.grants,
    );
    if (!result.success)
      context.addIssue({
        code: "custom",
        path: ["grants"],
        message: `Kind ${value.kind} does not take these grants`,
      });
  },
);
/** A user's decision about one resource; the service validates `grants` for the kind. */
export const trustDecisionSchema = z.object({
  kind: trustedResourceKindSchema,
  projectId: z.string().nullable(),
  resourceKey: z.string(),
  name: z.string().nullable(),
  contentDigest: trustedContentDigestSchema,
  status: trustedResourceStatusSchema,
  grants: trustedGrantsSchema.optional(),
});
export type TrustDecision = z.infer<typeof trustDecisionSchema>;
export type TrustedResourceKind = z.infer<typeof trustedResourceKindSchema>;
export type TrustedResourceStatus = z.infer<typeof trustedResourceStatusSchema>;
export type TrustedResource = z.infer<typeof trustedResourceSchema>;
export type TrustedResourceGrants = TrustedResource["grants"];
