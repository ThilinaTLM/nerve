import assert from "node:assert/strict";
import { z } from "zod";

// Frozen storage-boundary shapes. Never import the evolving runtime contracts/parser.
export const profileName = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
// Validate dictionaries through own entry tuples: z.record's plain-object
// check mistakes an own "constructor" key for the object's prototype identity.
// Every key/value still passes the frozen schemas; arrays/non-records fail.
function dictionary<K extends z.ZodString, V extends z.ZodType>(
  key: K,
  value: V,
) {
  return z.preprocess(
    (input) => {
      if (
        input &&
        typeof input === "object" &&
        !Array.isArray(input) &&
        (Object.getPrototypeOf(input) === Object.prototype ||
          Object.getPrototypeOf(input) === null)
      )
        return Object.entries(input);
      return undefined;
    },
    z.array(z.tuple([key, value])).transform((entries) => {
      const record: Record<string, z.output<V>> = Object.fromEntries(entries);
      return record;
    }),
  );
}
const selections = dictionary(z.string().min(1).max(256), z.boolean());
const scalar = <T extends z.ZodType>(value: T) =>
  z.union([
    z.literal("inherit"),
    z.literal("default"),
    value,
    z.object({ lock: z.union([z.literal("default"), value]) }).strict(),
  ]);
export const profileEntry = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().min(1).max(200).optional(),
    enabled: z.boolean().optional(),
    usableBy: z.enum(["lead", "subagent", "both"]).optional(),
    model: scalar(z.string().regex(/^[^/\s]+\/\S+$/)).optional(),
    thinking: scalar(
      z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]),
    ).optional(),
    permission: scalar(
      z
        .string()
        .trim()
        .min(1)
        .max(128)
        .regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/),
    ).optional(),
    compaction: scalar(
      z
        .object({
          auto: z.boolean().optional(),
          profile: z.enum(["aggressive", "balanced", "conservative", "custom"]),
          triggerPercent: z.number().int().min(60).max(90).optional(),
        })
        .strict(),
    ).optional(),
    tools: dictionary(
      z.string().min(1).max(64),
      z.union([z.boolean(), dictionary(z.string(), z.unknown())]),
    ).optional(),
    skills: z
      .union([z.literal("inherit"), z.literal("none"), selections])
      .optional(),
    instructions: z
      .string()
      .refine((value) => Buffer.byteLength(value) <= 16 * 1024)
      .optional(),
  })
  .strict();
export const profilesDocument = z
  .object({
    schemaVersion: z.literal(1),
    profiles: dictionary(profileName, profileEntry),
  })
  .strict();
export const enabledPreferences = z
  .object({ enabled: dictionary(profileName, z.boolean()) })
  .strict();
export type ProfileEntry = z.infer<typeof profileEntry>;
export const profileConversionReceipt = z
  .object({
    document: profilesDocument,
    sources: dictionary(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
  })
  .strict();

/** Normalize only named historical profile fields; never rewrite instructions or plugin data. */
export function convertProfileEntry(raw: unknown): ProfileEntry {
  assert(
    raw && typeof raw === "object" && !Array.isArray(raw),
    "Expected profile entry",
  );
  const entry = { ...raw } as Record<string, unknown>;
  entry.usableBy ??= "subagent";
  for (const key of ["model", "thinking"])
    if (entry[key] === "lead") entry[key] = "inherit";
  if (entry.compaction && typeof entry.compaction === "object") {
    entry.compaction = { ...entry.compaction };
    delete (entry.compaction as Record<string, unknown>).keepRecentPercent;
  }
  if (entry.tools && typeof entry.tools === "object") {
    const tools = { ...entry.tools } as Record<string, unknown>;
    if (Object.hasOwn(tools, "plan_mode_present")) {
      tools.plan_present ??= tools.plan_mode_present;
      delete tools.plan_mode_present;
    }
    entry.tools = tools;
  }
  return profileEntry.parse(entry);
}
export function convertProfilesDocument(raw: unknown) {
  assert(raw && typeof raw === "object" && !Array.isArray(raw));
  const document = raw as Record<string, unknown>;
  assert(
    document.profiles &&
      typeof document.profiles === "object" &&
      !Array.isArray(document.profiles),
  );
  return profilesDocument.parse({
    ...document,
    profiles: Object.fromEntries(
      Object.entries(document.profiles).map(([name, entry]) => [
        name,
        convertProfileEntry(entry),
      ]),
    ),
  });
}
