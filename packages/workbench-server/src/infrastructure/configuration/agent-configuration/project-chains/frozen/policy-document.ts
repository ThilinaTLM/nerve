import { permissionOverlayDocumentSchema } from "@nervekit/contracts/permissions";

/** Only the named selector changes; instruction text and arguments are untouched. */
export function convertPermissionOverlayV1(value: unknown): unknown {
  const parsed = permissionOverlayDocumentSchema.safeParse(value);
  if (!parsed.success) return structuredClone(value);
  for (const overlay of parsed.data.overlays)
    for (const rule of overlay.rules)
      if (rule.when?.toolNames)
        rule.when.toolNames = rule.when.toolNames.map((name) =>
          name === "plan_mode_present" ? "plan_present" : name,
        );
  return parsed.data;
}
