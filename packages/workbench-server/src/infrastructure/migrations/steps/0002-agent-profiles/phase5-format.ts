import assert from "node:assert/strict";
import { z } from "zod";
import defaultsJson from "./phase5-defaults.json" with { type: "json" };
import legacyBuiltins from "./legacy-builtins.json" with { type: "json" };

// Frozen phase-5 boundary. Do not import evolving runtime contracts here.
// Historical JSON is intentionally open until the frozen boundary validators run.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Data = Record<string, any>;
export const record = (value: unknown): Data => {
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    "Expected configuration object",
  );
  return value;
};
export const defaults = defaultsJson as Data;
export const oldBuiltins = Object.fromEntries(
  legacyBuiltins.map((profile) => [profile.name, profile]),
) as Record<string, Data>;
export const tools = [
  "python_exec",
  "web_search",
  "web_fetch",
  "explain_image",
  "generate_image",
  "kroki_export",
  "plan_present",
  "subagents",
  "jira",
  "confluence",
  "bash",
] as const;
export function merge(base: Data, override: Data): Data {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override))
    Object.defineProperty(result, key, {
      value:
        value && typeof value === "object" && !Array.isArray(value)
          ? merge(
              result[key] && typeof result[key] === "object" ? result[key] : {},
              value,
            )
          : structuredClone(value),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return result;
}
export function convertCapabilities(value: unknown): Data {
  const input = record(structuredClone(value));
  if (input.schemaVersion === 3) {
    assert(
      !input.toolSettings,
      "Detached toolSettings remain in v3 capabilities",
    );
    return input;
  }
  assert(
    input.schemaVersion === 2 || input.schemaVersion === 1,
    "Unknown capability document version",
  );
  const result: Data = {
    schemaVersion: 3,
    tools: {},
    skills: input.skills ?? { file: {}, nerve: {}, agentBrowser: {} },
  };
  for (const [oldName, change] of Object.entries(input.tools ?? {})) {
    const name =
      oldName === "plan_mode_present"
        ? "plan_present"
        : oldName.startsWith("subagent_") || oldName === "explore"
          ? "subagents"
          : oldName;
    assert(
      (tools as readonly string[]).includes(name),
      `Unsupported capability tool: ${name}`,
    );
    result.tools[name] =
      typeof change === "boolean"
        ? { enabled: change }
        : structuredClone(change);
  }
  for (const [name, settings] of Object.entries(input.toolSettings ?? {}))
    result.tools[name] = { ...result.tools[name], settings };
  if (result.tools.plan_present?.enabled && !result.tools.plan_present.settings)
    result.tools.plan_present.settings = { approvalProfile: "coding" };
  assert(!("enabled" in (result.tools.bash ?? {})), "Bash cannot be disabled");
  return result;
}
export function convertHarness(value: unknown, integrations?: unknown): Data {
  const raw = record(structuredClone(value));
  if (raw.version === 4) {
    assert(
      !raw.execution && !raw.tools?.disabled,
      "Detached execution fields remain in v4 harness",
    );
    return raw;
  }
  assert(raw.version === 3, "Unknown harness document version");
  const result = merge(defaults, raw);
  const old = raw.tools ?? {};
  const canonical = structuredClone(defaults.tools);
  const disabled = new Set(
    (old.disabled ?? []).map((name: string) =>
      name === "plan_mode_present"
        ? "plan_present"
        : name === "explore" || name.startsWith("subagent_")
          ? "subagents"
          : name,
    ),
  );
  if (old.disabled)
    for (const name of tools)
      if (name !== "bash")
        canonical[name] = {
          ...canonical[name],
          enabled: !disabled.has(name) && name !== "plan_present",
        };
  const direct: Data = {
    imageExplanation: "explain_image",
    imageGeneration: "generate_image",
    kroki: "kroki_export",
  };
  for (const [field, name] of Object.entries(direct))
    if (old[field])
      canonical[name as string] = {
        ...canonical[name as string],
        settings: old[field],
      };
  if (old.bash)
    canonical.bash = { settings: { ...canonical.bash.settings, ...old.bash } };
  if (raw.execution?.pythonExecutablePath)
    canonical.python_exec.settings.interpreterPath =
      raw.execution.pythonExecutablePath;
  if (raw.execution?.shellPath)
    canonical.bash.settings.shellPath = raw.execution.shellPath;
  const accounts = integrations ? record(integrations) : {};
  for (const name of ["jira", "confluence"])
    if (accounts.tools?.[name])
      canonical[name] = { ...canonical[name], ...accounts.tools[name] };
  if (accounts.tools?.web?.tavilyProfileId)
    canonical.web_search.profileId = accounts.tools.web.tavilyProfileId;
  result.version = 4;
  result.tools = canonical;
  delete result.execution;
  delete result.mode;
  for (const selection of [
    result.defaults,
    result.lastSelection,
    result.lastAgentSelection,
  ])
    if (selection) delete selection.mode;
  return result;
}
export function convertIntegrations(value: unknown): Data {
  const result = record(structuredClone(value));
  assert(
    result.version === 1 || result.version === 2,
    "Unknown integrations document version",
  );
  result.version = 2;
  delete result.tools;
  return result;
}
export function projectToolOverrides(harness: Data, integrations?: Data): Data {
  const result: Data = {
    schemaVersion: 3,
    tools: {},
    skills: { file: {}, nerve: {}, agentBrowser: {} },
  };
  const source = harness.tools ?? {};
  for (const [old, name] of Object.entries({
    imageExplanation: "explain_image",
    imageGeneration: "generate_image",
    kroki: "kroki_export",
  }))
    if (source[old]) result.tools[name] = { settings: source[old] };
  if (source.bash || harness.execution?.shellPath)
    result.tools.bash = {
      settings: {
        ...defaults.tools.bash.settings,
        ...source.bash,
        ...(harness.execution?.shellPath
          ? { shellPath: harness.execution.shellPath }
          : {}),
      },
    };
  if (harness.execution?.pythonExecutablePath)
    result.tools.python_exec = {
      settings: { interpreterPath: harness.execution.pythonExecutablePath },
    };
  for (const name of ["jira", "confluence"])
    if (integrations?.tools?.[name])
      result.tools[name] = integrations.tools[name];
  if (integrations?.tools?.web?.tavilyProfileId)
    result.tools.web_search = {
      profileId: integrations.tools.web.tavilyProfileId,
    };
  for (const name of harness.skills?.disabled ?? [])
    result.skills.file[name] = false;
  for (const name of harness.skills?.nerve?.enabled ?? [])
    result.skills.nerve[name] = true;
  for (const name of harness.skills?.agentBrowser?.enabled ?? [])
    result.skills.agentBrowser[name] = true;
  return result;
}
export function legacyProfile(name: string, layers: readonly Data[]): Data {
  let profile = structuredClone(oldBuiltins[name] ?? { name });
  for (const entries of layers)
    if (Object.hasOwn(entries, name)) {
      const entry = record(entries[name]);
      profile = {
        ...profile,
        ...entry,
        tools: { ...profile.tools, ...entry.tools },
        ...(entry.skills && typeof entry.skills === "object"
          ? {
              skills: {
                ...(typeof profile.skills === "object" ? profile.skills : {}),
                ...entry.skills,
              },
            }
          : {}),
      };
    }
  return profile;
}
const unwrap = (value: Data[string]) =>
  value && typeof value === "object" && "lock" in value ? value.lock : value;
const locked = (value: Data[string]) =>
  value && typeof value === "object" && "lock" in value;
export function convertProfile(
  profile: Data,
  harness: Data,
  skillKinds: Record<string, string> = {},
  options: { inheritedCodingPermission?: boolean } = {},
): Data {
  assert(
    typeof profile.name === "string" &&
      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(profile.name),
    "Invalid profile name",
  );
  assert(
    typeof profile.description === "string" && profile.description.trim(),
    `Profile ${profile.name} needs a description before conversion`,
  );
  const subagent = profile.usableBy === "subagent";
  const result: Data = {
    schemaVersion: 2,
    name: profile.name,
    label: profile.label ?? profile.name,
    description: profile.description,
    enabled: profile.enabled ?? true,
    usableBy: profile.usableBy ?? "subagent",
    instructions: profile.instructions ?? "",
  };
  const mode = (value: Data[string], fallback: Data[string]) => {
    if (value === undefined || value === "inherit")
      return subagent ? "lead" : undefined;
    return {
      [locked(value) ? "lock" : "set"]:
        unwrap(value) === "default" ? fallback : unwrap(value),
    };
  };
  if (profile.usableBy === "both")
    assert(
      ![
        profile.model,
        profile.thinking,
        profile.permission,
        profile.compaction,
      ].includes("inherit"),
      `Profile ${profile.name}: ambiguous legacy inheritance for both lead and sub-agent use; review its modes`,
    );
  const model = mode(profile.model, harness.defaults?.model);
  if (model === "lead") result.model = "lead";
  else if (model !== undefined) {
    const selected =
      unwrap(profile.model) === "default"
        ? harness.defaults?.model
        : unwrap(profile.model);
    const slash = typeof selected === "string" ? selected.indexOf("/") : -1;
    const selection =
      typeof selected === "string"
        ? {
            provider: selected.slice(0, slash),
            modelId: selected.slice(slash + 1),
          }
        : selected;
    assert(
      selection?.provider &&
        selection?.modelId &&
        (typeof selected !== "string" || slash > 0),
      `Profile ${profile.name}: no concrete default model`,
    );
    result.model = { [locked(profile.model) ? "lock" : "set"]: selection };
  }
  const thinking = mode(profile.thinking, harness.defaults?.thinkingLevel);
  if (thinking !== undefined) result.thinking = thinking;
  const permission = mode(
    profile.permission,
    harness.defaults?.permissionRuleSetId,
  );
  if (permission !== undefined) result.permission = permission;
  const compaction = mode(profile.compaction, harness.compaction);
  if (compaction !== undefined) {
    if (compaction === "lead") result.compaction = "lead";
    else {
      const key = Object.keys(compaction)[0];
      const value = compaction[key];
      result.compaction = {
        [key]: {
          auto: value.auto ?? true,
          profile: value.profile,
          customTriggerPercent:
            value.triggerPercent ?? value.customTriggerPercent ?? 80,
        },
      };
    }
  }
  for (const [name, value] of Object.entries(profile.tools ?? {})) {
    assert(
      (tools as readonly string[]).includes(name) && name !== "bash",
      `Profile ${profile.name}: unsupported legacy tool ${name}`,
    );
    const payload: Data =
      typeof value === "boolean" ? { enabled: value } : { settings: value };
    if (name === "plan_present")
      payload.settings = { approvalProfile: "coding", ...payload.settings };
    (result.tools ??= {})[name] = { set: payload };
  }
  if (profile.skills === "inherit" || profile.skills === undefined) {
    if (subagent) result.skills = "lead";
  } else if (profile.skills === "none") result.skills = { set: "none" };
  else {
    const buckets: Data = { file: {}, nerve: {}, agentBrowser: {} };
    for (const [name, enabled] of Object.entries(profile.skills))
      buckets[
        skillKinds[name] ??
          (name === "planning" ||
          name === "team-lead" ||
          name === "skill-creator"
            ? "nerve"
            : "file")
      ][name] = enabled;
    result.skills = { set: buckets };
  }
  // Coding's new template is a no-op; existing conversations are materialized separately.
  if (
    options.inheritedCodingPermission &&
    profile.name === "coding" &&
    profile.permission === "default"
  )
    delete result.permission;
  return result;
}
const nameSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const thinkingSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const modelSchema = z
  .object({ provider: z.string().min(1), modelId: z.string().min(1) })
  .strict();
const compactionSchema = z
  .object({
    auto: z.boolean(),
    profile: z.enum(["aggressive", "balanced", "conservative", "custom"]),
    customTriggerPercent: z.number().int().min(60).max(90),
  })
  .strict();
const skillOverrides = z
  .record(z.string().trim().min(1).max(256), z.boolean())
  .refine((value) => Object.keys(value).length <= 512);
const skillsSchema = z
  .object({
    file: skillOverrides,
    nerve: skillOverrides,
    agentBrowser: skillOverrides,
  })
  .strict();
const permissionSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/);
const instructionsSchema = z
  .string()
  .refine((value) => Buffer.byteLength(value) <= 16 * 1024);
const imageSizeSchema = z.union([
  z.literal("auto"),
  z
    .string()
    .regex(/^\d+x\d+$/)
    .refine((value) => {
      const [width, height] = value.split("x").map(Number);
      if (!width || !height || width % 16 || height % 16) return false;
      return (
        Math.max(width, height) <= 3840 &&
        Math.max(width, height) / Math.min(width, height) <= 3 &&
        width * height >= 655_360 &&
        width * height <= 8_294_400
      );
    }),
]);
const krokiUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  })
  .transform((value) => {
    const url = new URL(value);
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return url.href;
  });
const settingsByTool = {
  python_exec: z
    .object({ interpreterPath: z.string().trim().min(1).optional() })
    .strict(),
  bash: z
    .object({
      shellPath: z.string().trim().min(1).optional(),
      maxTimeoutMs: z.number().int().min(1000).max(3_600_000).default(900_000),
      autoPromotion: z
        .object({
          enabled: z.boolean(),
          afterMs: z.number().int().positive().max(86_400_000),
        })
        .strict(),
    })
    .strict(),
  plan_present: z.object({ approvalProfile: nameSchema }).strict(),
  explain_image: z.object({
    model: modelSchema.optional(),
    thinkingLevel: thinkingSchema,
  }),
  generate_image: z.object({
    provider: z.literal("openai-codex"),
    model: z.enum(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]),
    options: z.object({
      quality: z.enum(["auto", "low", "medium", "high", "xhigh", "max"]),
      size: imageSizeSchema,
      background: z.enum(["auto", "opaque", "transparent"]),
    }),
  }),
  kroki_export: z.object({ url: krokiUrlSchema }).strict(),
};
const payload = (settings?: z.ZodType) =>
  z
    .object({
      enabled: z.boolean().optional(),
      ...(settings ? { settings: settings.optional() } : {}),
    })
    .strict();
const accountPayload = z
  .object({
    enabled: z.boolean().optional(),
    profileId: z.string().trim().min(1).max(256).optional(),
  })
  .strict();
const toolPayloads = {
  python_exec: payload(settingsByTool.python_exec),
  web_search: accountPayload,
  web_fetch: payload(),
  explain_image: payload(settingsByTool.explain_image),
  generate_image: payload(settingsByTool.generate_image),
  kroki_export: payload(settingsByTool.kroki_export),
  plan_present: payload(settingsByTool.plan_present),
  subagents: payload(),
  jira: accountPayload,
  confluence: accountPayload,
  bash: z.object({ settings: settingsByTool.bash }).strict(),
};
const capabilityTools = z.object(toolPayloads).partial().strict();
export const frozenCapabilitiesSchema = z
  .object({
    schemaVersion: z.literal(3),
    tools: capabilityTools,
    skills: skillsSchema,
  })
  .strict();
const setting = <T extends z.ZodType>(value: T) =>
  z.union([
    z.literal("lead"),
    z.object({ set: value }).strict(),
    z.object({ lock: value }).strict(),
  ]);
const profileTools = z
  .object({
    python_exec: setting(toolPayloads.python_exec).optional(),
    web_search: setting(toolPayloads.web_search).optional(),
    web_fetch: setting(toolPayloads.web_fetch).optional(),
    explain_image: setting(toolPayloads.explain_image).optional(),
    generate_image: setting(toolPayloads.generate_image).optional(),
    kroki_export: setting(toolPayloads.kroki_export).optional(),
    plan_present: setting(toolPayloads.plan_present).optional(),
    subagents: setting(toolPayloads.subagents).optional(),
    jira: setting(toolPayloads.jira).optional(),
    confluence: setting(toolPayloads.confluence).optional(),
    bash: setting(toolPayloads.bash).optional(),
  })
  .strict();
export const frozenProfileFileSchema = z
  .object({
    schemaVersion: z.literal(2),
    name: nameSchema,
    label: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().min(1).max(200),
    enabled: z.boolean().optional(),
    usableBy: z.enum(["lead", "subagent", "both"]),
    instructions: instructionsSchema,
    model: setting(modelSchema).optional(),
    thinking: setting(thinkingSchema).optional(),
    permission: setting(permissionSchema).optional(),
    compaction: setting(compactionSchema).optional(),
    tools: profileTools.optional(),
    skills: setting(z.union([z.literal("none"), skillsSchema])).optional(),
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (profile.usableBy !== "lead") return;
    for (const field of [
      "model",
      "thinking",
      "permission",
      "compaction",
      "skills",
    ] as const)
      if (profile[field] === "lead")
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Lead-only profiles cannot use Same as lead",
        });
    for (const [name, value] of Object.entries(profile.tools ?? {}))
      if (value === "lead")
        ctx.addIssue({
          code: "custom",
          path: ["tools", name],
          message: "Lead-only profiles cannot use Same as lead",
        });
  });
export const frozenAppliedSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: nameSchema,
    instructions: instructionsSchema,
    locked: z
      .object({
        model: modelSchema.optional(),
        thinking: thinkingSchema.optional(),
        permission: permissionSchema.optional(),
        compaction: compactionSchema.optional(),
        tools: capabilityTools.optional(),
        skills: z.union([z.literal("none"), skillsSchema]).optional(),
      })
      .strict(),
  })
  .strict();
export function canonicalCapabilities(base: Data, override: Data): Data {
  return {
    schemaVersion: 3,
    tools: merge(base.tools ?? {}, override.tools ?? {}),
    skills: merge(
      base.skills ?? { file: {}, nerve: {}, agentBrowser: {} },
      override.skills ?? {},
    ),
  };
}

export function applyLegacyLive(
  profile: Data,
  config: Data,
  compaction: Data,
  capabilities: Data,
  own: Data,
  kinds: Record<string, string>,
  harness: Data,
): { config: Data; compaction: Data; capabilities: Data; locked: Data } {
  const next = structuredClone(config);
  const lockedValues: Data = {};
  // Only Locks were live scalars. Never reapply Sets over a user's stored choice.
  for (const [field, column] of [
    ["model", "model"],
    ["thinking", "reasoning_level"],
    ["permission", "permission_rule_set_id"],
  ] as const) {
    const value = profile[field];
    if (!value || typeof value !== "object" || !("lock" in value)) continue;
    const setting =
      value.lock === "default"
        ? field === "model"
          ? harness.defaults?.model
          : field === "thinking"
            ? harness.defaults?.thinkingLevel
            : harness.defaults?.permissionRuleSetId
        : value.lock;
    assert(
      setting !== undefined,
      `Profile ${profile.name}: cannot resolve default Lock`,
    );
    if (field === "model") {
      if (typeof setting === "string") {
        const slash = setting.indexOf("/");
        assert(slash > 0, "Invalid locked model");
        next.model = JSON.stringify({
          provider: setting.slice(0, slash),
          modelId: setting.slice(slash + 1),
        });
      } else next.model = JSON.stringify(setting);
    } else next[column] = setting;
  }
  if (locked(profile.model)) lockedValues.model = JSON.parse(next.model);
  if (locked(profile.thinking)) lockedValues.thinking = next.reasoning_level;
  if (
    profile.permission &&
    typeof profile.permission === "object" &&
    "lock" in profile.permission
  )
    lockedValues.permission = next.permission_rule_set_id;
  if (
    profile.compaction &&
    typeof profile.compaction === "object" &&
    "lock" in profile.compaction
  ) {
    const value =
      profile.compaction.lock === "default"
        ? harness.compaction
        : profile.compaction.lock;
    compaction = {
      auto: value.auto ?? true,
      profile: value.profile,
      customTriggerPercent:
        value.triggerPercent ?? value.customTriggerPercent ?? 80,
    };
    lockedValues.compaction = compaction;
  }
  const delta: Data = {
    tools: {},
    skills: { file: {}, nerve: {}, agentBrowser: {} },
  };
  for (const [name, value] of Object.entries(profile.tools ?? {}))
    delta.tools[name] =
      typeof value === "boolean" ? { enabled: value } : { settings: value };
  if (profile.skills === "none") {
    for (const [name, kind] of Object.entries(kinds))
      delta.skills[kind][name] = false;
    for (const bucket of ["nerve", "agentBrowser", "file"])
      for (const name of Object.keys(capabilities.skills[bucket] ?? {}))
        delta.skills[bucket][name] = false;
  } else if (profile.skills && typeof profile.skills === "object")
    for (const [name, enabled] of Object.entries(profile.skills))
      delta.skills[kinds[name] ?? "file"][name] = enabled;
  capabilities = canonicalCapabilities(
    canonicalCapabilities(capabilities, delta),
    own,
  );
  if (capabilities.tools.plan_present?.enabled)
    capabilities.tools.plan_present.settings ??= { approvalProfile: "coding" };
  return { config: next, compaction, capabilities, locked: lockedValues };
}
