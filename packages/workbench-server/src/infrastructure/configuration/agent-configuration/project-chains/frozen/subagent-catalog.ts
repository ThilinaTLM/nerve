import { z } from "zod";
// Frozen pre-JSON enablement and released catalog containers. Entry validation is
// deliberately deferred to each profile chain, so siblings cannot poison it.
const catalog = z
  .object({
    schemaVersion: z.literal(1),
    profiles: z.record(z.string(), z.unknown()),
  })
  .strict();
const enabled = z
  .object({ enabled: z.record(z.string(), z.boolean()) })
  .strict();
export function legacySubagentCatalog(value: unknown): {
  schemaVersion: 1;
  profiles: Record<string, unknown>;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected subagent catalog");
  const document = { ...(value as Record<string, unknown>) };
  delete document.version;
  if ((value as Record<string, unknown>).version === 2)
    return catalog.parse(document);
  if (!Object.hasOwn(document, "schemaVersion")) {
    const old = enabled.parse(document);
    return {
      schemaVersion: 1,
      profiles: Object.fromEntries(
        Object.entries(old.enabled).map(([name, enabled]) => [
          name,
          { enabled },
        ]),
      ),
    };
  }
  return catalog.parse(document);
}
