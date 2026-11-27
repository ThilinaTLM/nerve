import { z } from "zod";
import { sourceSchema } from "../core/scope.js";
import { diagnosticSchema } from "./diagnostic.js";

export const configurationResourceKindSchema = z.enum([
  "agent-preferences",
  "agent-profile",
  "rule-set",
  "permission-overlay",
  "launch-catalog",
  "mcp-servers",
  "skill",
  "prompt-suggestion",
  "extension",
]);
export type ConfigurationResourceKind = z.infer<
  typeof configurationResourceKindSchema
>;

/**
 * One configurable thing as the agent and the user see it: what it is, where it comes
 * from, whether it is in effect and what is wrong with it. Each owner reports its own.
 */
export const configurationResourceSchema = z.strictObject({
  kind: configurationResourceKindSchema,
  /** Name or id within the kind; the file name for single-file kinds. */
  id: z.string().min(1),
  scope: z.enum(["builtin", "user", "project", "conversation"]),
  /** Absent for built-ins. */
  path: z.string().optional(),
  state: z.enum([
    "active",
    "disabled",
    "shadowed",
    "invalid",
    "incompatible",
    "needs_review",
    "declined",
  ]),
  /** For `needs_review` and `declined`: what the user decides and where. */
  approval: z
    .strictObject({
      kind: z.enum(["trust", "consent"]),
      where: z.string().min(1),
    })
    .optional(),
  /** For `shadowed`: the scope of the resource that wins. */
  shadowedBy: sourceSchema.optional(),
  /** The file on disk is invalid, so the version loaded before the edit stays in force. */
  previousVersionActive: z.literal(true).optional(),
  diagnostics: z.array(diagnosticSchema),
});
export type ConfigurationResource = z.infer<typeof configurationResourceSchema>;
