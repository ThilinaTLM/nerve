import { z } from "zod";
import { userConfigurableToolNameSchema } from "../tools/tool-name.js";

const skillNameSchema = z.string().trim().min(1).max(256);
const skillOverridesSchema = z
  .record(skillNameSchema, z.boolean())
  .superRefine((value, context) => {
    if (Object.keys(value).length > 512)
      context.addIssue({
        code: "custom",
        message: "At most 512 skill overrides are allowed.",
      });
  });

export const capabilityOverridesDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    tools: z
      .partialRecord(userConfigurableToolNameSchema, z.boolean())
      .default({}),
    skills: z
      .object({
        file: skillOverridesSchema.default({}),
        agentBrowser: skillOverridesSchema.default({}),
      })
      .strict()
      .default({ file: {}, agentBrowser: {} }),
  })
  .strict();
export type CapabilityOverridesDocument = z.infer<
  typeof capabilityOverridesDocumentSchema
>;

export const emptyCapabilityOverrides = (): CapabilityOverridesDocument => ({
  schemaVersion: 1,
  tools: {},
  skills: { file: {}, agentBrowser: {} },
});

export const capabilityOriginSchema = z.enum(["project", "conversation"]);
export type CapabilityOrigin = z.infer<typeof capabilityOriginSchema>;

export const capabilityPatchSchema = z
  .object({
    tools: z
      .partialRecord(userConfigurableToolNameSchema, z.boolean().nullable())
      .optional(),
    skills: z
      .object({
        file: z.record(skillNameSchema, z.boolean().nullable()).optional(),
        agentBrowser: z
          .record(skillNameSchema, z.boolean().nullable())
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CapabilityPatch = z.infer<typeof capabilityPatchSchema>;

export const capabilityTrustSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("missing") }),
  z.object({ status: z.literal("invalid"), reason: z.string() }),
  z.object({
    status: z.literal("untrusted"),
    digest: z.string(),
    trustedDigest: z.string().optional(),
    trustedAt: z.string().datetime().optional(),
    reason: z.string(),
  }),
  z.object({
    status: z.literal("trusted"),
    digest: z.string(),
    trustedDigest: z.string(),
    trustedAt: z.string().datetime(),
  }),
]);
export type CapabilityTrust = z.infer<typeof capabilityTrustSchema>;

export const capabilitySelectionSchema = z.object({
  disabledTools: z.array(userConfigurableToolNameSchema),
  disabledFileSkills: z.array(skillNameSchema),
  enabledAgentBrowserSkills: z.array(skillNameSchema),
});
export type CapabilitySelection = z.infer<typeof capabilitySelectionSchema>;

export const capabilityConfigurationSchema = z.object({
  project: capabilityOverridesDocumentSchema,
  conversation: capabilityOverridesDocumentSchema.optional(),
  effective: capabilitySelectionSchema,
  trust: capabilityTrustSchema,
  projectDigest: z.string().optional(),
  conversationDigest: z.string().optional(),
});
export type CapabilityConfiguration = z.infer<
  typeof capabilityConfigurationSchema
>;

export function applyCapabilityPatch(
  document: CapabilityOverridesDocument,
  patch: CapabilityPatch,
): CapabilityOverridesDocument {
  const next = structuredClone(document);
  for (const [name, value] of Object.entries(patch.tools ?? {})) {
    if (value === null) delete next.tools[name as keyof typeof next.tools];
    else next.tools[name as keyof typeof next.tools] = value;
  }
  for (const kind of ["file", "agentBrowser"] as const) {
    for (const [name, value] of Object.entries(patch.skills?.[kind] ?? {})) {
      if (value === null) delete next.skills[kind][name];
      else next.skills[kind][name] = value;
    }
  }
  return capabilityOverridesDocumentSchema.parse(next);
}

export function resolveCapabilitySelection(input: {
  user: CapabilitySelection;
  project?: CapabilityOverridesDocument;
  conversation?: CapabilityOverridesDocument;
}): CapabilitySelection {
  const disabledTools = new Set(input.user.disabledTools);
  const disabledFileSkills = new Set(input.user.disabledFileSkills);
  const enabledAgentBrowserSkills = new Set(
    input.user.enabledAgentBrowserSkills,
  );
  for (const document of [input.project, input.conversation]) {
    if (!document) continue;
    for (const [name, enabled] of Object.entries(document.tools)) {
      if (enabled) disabledTools.delete(name as never);
      else disabledTools.add(name as never);
    }
    for (const [name, enabled] of Object.entries(document.skills.file)) {
      if (enabled) disabledFileSkills.delete(name);
      else disabledFileSkills.add(name);
    }
    for (const [name, enabled] of Object.entries(
      document.skills.agentBrowser,
    )) {
      if (enabled) enabledAgentBrowserSkills.add(name);
      else enabledAgentBrowserSkills.delete(name);
    }
  }
  return capabilitySelectionSchema.parse({
    disabledTools: [...disabledTools],
    disabledFileSkills: [...disabledFileSkills],
    enabledAgentBrowserSkills: [...enabledAgentBrowserSkills],
  });
}
