import assert from "node:assert/strict";
import { z } from "zod";
const object = z.record(z.string(), z.unknown());
// Frozen source shapes for same-file version bumps only.
const capabilities = z
  .object({
    schemaVersion: z.literal(2),
    tools: z
      .record(
        z.string(),
        z
          .object({
            enabled: z.boolean().optional(),
            profileId: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    toolSettings: z
      .object({
        explain_image: object.optional(),
        generate_image: object.optional(),
        kroki_export: object.optional(),
      })
      .strict()
      .optional(),
    skills: z
      .object({
        file: z.record(z.string(), z.boolean()).optional(),
        nerve: z.record(z.string(), z.boolean()).optional(),
        agentBrowser: z.record(z.string(), z.boolean()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export function migrateCapabilitiesV2(value: unknown): unknown {
  const raw = capabilities.parse(value);
  const tools: Record<
    string,
    {
      enabled?: boolean;
      profileId?: string;
      settings?: Record<string, unknown>;
    }
  > = {};
  for (const [name, entry] of Object.entries(raw.tools ?? {})) {
    const key =
      name === "plan_mode_present"
        ? "plan_present"
        : name === "explore" || name.startsWith("subagent_")
          ? "subagents"
          : name;
    assert(!Object.hasOwn(tools, key), `Duplicate renamed tool: ${key}`);
    Object.defineProperty(tools, key, {
      value: entry,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  for (const [name, settings] of Object.entries(raw.toolSettings ?? {}))
    tools[name] = { ...tools[name], settings };
  return {
    schemaVersion: 3,
    overrides: {
      ...(Object.keys(tools).length ? { tools } : {}),
      ...(Object.keys(raw.skills ?? {}).length ? { skills: raw.skills } : {}),
    },
  };
}
