import { z } from "zod";

export const agentResultProfileIdSchema = z.enum([
  "source_text",
  "process_diagnostics",
  "search_matches",
  "file_listing",
  "search_summaries",
  "network_prose",
  "resource_detail",
  "mutation_acknowledgement",
  "lifecycle_state",
  "task_logs",
  "delegated_reports",
  "primary_file_result",
  "human_response",
  "vision_explanation",
  "terminal_outcome",
  "conservative_fallback",
]);
export type AgentResultProfileId = z.infer<typeof agentResultProfileIdSchema>;

export const agentResultStrategyIdSchema = z.enum([
  "unchanged",
  "head",
  "tail",
  "head_tail",
  "compact_diagnostic",
  "item_aware",
  "continuation_aware",
  "artifact_index",
  "compound_per_task",
  "terminal_outcome",
]);
export type AgentResultStrategyId = z.infer<typeof agentResultStrategyIdSchema>;

export const toolArtifactRoleSchema = z.enum([
  "primary_result",
  "supporting_data",
  "overflow_recovery",
]);
export type ToolArtifactRole = z.infer<typeof toolArtifactRoleSchema>;

export const toolArtifactAccessSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agent_file"), path: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("managed_reference"),
      logicalPath: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("metadata_only"),
      location: z.string().min(1).optional(),
    })
    .strict(),
]);
export type ToolArtifactAccess = z.infer<typeof toolArtifactAccessSchema>;

export const toolArtifactFormatSchema = z
  .object({
    kind: z.enum([
      "markdown",
      "text",
      "json",
      "jsonl",
      "image",
      "binary",
      "directory_manifest",
    ]),
    mediaType: z.string().min(1),
    encoding: z.literal("utf-8").optional(),
  })
  .strict();
export type ToolArtifactFormat = z.infer<typeof toolArtifactFormatSchema>;

export const validatedToolArtifactSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    role: toolArtifactRoleSchema,
    access: toolArtifactAccessSchema,
    availability: z.enum(["available", "unavailable"]),
    format: toolArtifactFormatSchema,
    size: z
      .object({
        bytes: z.number().int().nonnegative(),
        lines: z.number().int().nonnegative().optional(),
        items: z.number().int().nonnegative().optional(),
        itemKind: z.string().min(1).optional(),
      })
      .strict(),
    recommendedTools: z.array(z.enum(["read", "grep", "explain_image"])).max(3),
    label: z.string().min(1).max(256),
    unavailableReason: z
      .enum([
        "missing",
        "unsafe_path",
        "symlink",
        "not_regular",
        "unsupported_format",
        "validation_failed",
      ])
      .optional(),
  })
  .strict()
  .superRefine((artifact, context) => {
    if (
      artifact.availability === "unavailable" &&
      !artifact.unavailableReason
    ) {
      context.addIssue({
        code: "custom",
        path: ["unavailableReason"],
        message: "Unavailable artifacts require a reason.",
      });
    }
    if (artifact.availability === "available" && artifact.unavailableReason) {
      context.addIssue({
        code: "custom",
        path: ["unavailableReason"],
        message: "Available artifacts cannot have an unavailable reason.",
      });
    }
    if (
      artifact.format.encoding === "utf-8" &&
      !["markdown", "text", "json", "jsonl", "directory_manifest"].includes(
        artifact.format.kind,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["format", "encoding"],
        message: "UTF-8 encoding is valid only for readable text formats.",
      });
    }
    if (
      artifact.access.kind !== "agent_file" &&
      artifact.recommendedTools.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["recommendedTools"],
        message: "Only agent files may recommend inspection tools.",
      });
    }
  });
export type ValidatedToolArtifact = z.infer<typeof validatedToolArtifactSchema>;

export const projectionCountSchema = z.object({
  kind: z.enum(["line", "byte", "item", "event", "task"]),
  original: z.number().int().nonnegative(),
  displayed: z.number().int().nonnegative(),
  omitted: z.number().int().nonnegative(),
});
export type ProjectionCount = z.infer<typeof projectionCountSchema>;

export const exactContinuationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("line"),
    nextOffset: z.number().int().nonnegative(),
    displayedStart: z.number().int().nonnegative(),
    displayedEnd: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("byte"),
    nextByteOffset: z.number().int().nonnegative(),
    displayedStart: z.number().int().nonnegative(),
    displayedEnd: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("cursor"),
    cursorName: z.string().min(1),
    value: z.union([z.string(), z.number()]),
    direction: z.enum(["before", "after"]),
  }),
  z.object({
    kind: z.literal("page_token"),
    parameter: z.string().min(1),
    value: z.string(),
  }),
]);
export type ExactContinuation = z.infer<typeof exactContinuationSchema>;

export const agentProjectionSnapshotSchema = z
  .object({
    version: z.literal(1),
    profile: agentResultProfileIdSchema,
    strategy: agentResultStrategyIdSchema,
    terminalOutcomePrecedence: z.boolean(),
    fastPath: z.boolean(),
    recovery: z.enum(["none", "artifact", "complete_payload"]),
    artifactRoles: z.array(toolArtifactRoleSchema),
    counts: z.array(projectionCountSchema),
    originalTextBytes: z.number().int().nonnegative(),
    displayedTextBytes: z.number().int().nonnegative(),
    originalTextLines: z.number().int().nonnegative(),
    displayedTextLines: z.number().int().nonnegative(),
    perTask: z
      .array(
        z.object({
          index: z.number().int().nonnegative(),
          decision: z.enum(["inline", "index", "outcome"]),
          displayedBytes: z.number().int().nonnegative(),
          displayedLines: z.number().int().nonnegative(),
        }),
      )
      .optional(),
    continuation: z.array(exactContinuationSchema).optional(),
  })
  .strict();
export type AgentProjectionSnapshot = z.infer<
  typeof agentProjectionSnapshotSchema
>;
