import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  agentPreferencesSchema,
  conversationDefaultsSchema,
  profileDefinitionSchema,
  leadConversationAgentSchema,
  childConversationAgentSchema,
  completeChildSettingsSchema,
  leadSettingsOverridesSchema,
} from "@nervekit/contracts/agent-configuration";
import releasedDefaults from "./released-baseline.json" with { type: "json" };
import bundledAgentProfiles from "./converted-mode-profiles.json" with { type: "json" };

// These are release-boundary shapes, NOT the evolving harness/profile schemas.
// Value validation is performed by the strict target contract after conversion.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Data = Record<string, any>;
const object = z.record(z.string(), z.unknown());
const selection = z
  .object({
    mode: z.enum(["planning", "coding"]).optional(),
    permissionRuleSetId: z.string().optional(),
    model: object.optional(),
    thinkingLevel: z
      .enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
      .optional(),
  })
  .strict();
const harness = z
  .object({
    version: z.literal(3),
    defaults: selection.optional(),
    lastSelection: selection.optional(),
    rememberLastSelection: z.boolean().optional(),
    compaction: object.optional(),
    retry: object.optional(),
    execution: z
      .object({
        pythonExecutablePath: z.string().optional(),
        shellPath: z.string().optional(),
      })
      .strict()
      .optional(),
    tools: z
      .object({
        disabled: z
          .array(
            z.enum([
              "python_exec",
              "web_search",
              "web_fetch",
              "explain_image",
              "generate_image",
              "kroki_export",
              "subagent_prompt",
              "subagent_status",
              "subagent_stop",
              "subagent_new",
              "subagent_list",
              "explore",
            ]),
          )
          .optional(),
        bash: object.optional(),
        imageExplanation: object.optional(),
        imageGeneration: object.optional(),
        kroki: object.optional(),
      })
      .strict()
      .optional(),
    skills: z
      .object({
        disabled: z.array(z.string()).optional(),
        nerve: z
          .object({ enabled: z.array(z.string()) })
          .strict()
          .optional(),
        agentBrowser: z
          .object({ enabled: z.array(z.string()) })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    scopedModels: z.array(object).optional(),
  })
  .strict();
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
const releasedIntegrations = z
  .object({
    version: z.literal(1),
    profiles: z
      .object({
        atlassian: z.array(
          z
            .object({
              id: z.string().min(1),
              name: z.string().min(1),
              siteUrl: z.string().url().optional(),
              email: z.string().email().optional(),
              defaultProjectKey: z.string().min(1).optional(),
              defaultSpaceKey: z.string().min(1).optional(),
              credential: z.string().min(1),
            })
            .strict(),
        ),
        tavily: z.array(
          z
            .object({
              id: z.string().min(1),
              name: z.string().min(1),
              credential: z.string().min(1),
            })
            .strict(),
        ),
      })
      .strict(),
    tools: z
      .object({
        jira: z
          .object({ enabled: z.boolean(), profileId: z.string().optional() })
          .strict(),
        confluence: z
          .object({ enabled: z.boolean(), profileId: z.string().optional() })
          .strict(),
        web: z.object({ tavilyProfileId: z.string().optional() }).strict(),
      })
      .strict(),
  })
  .strict();
const entry = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().min(1).max(200).optional(),
    enabled: z.boolean().optional(),
    model: z
      .union([z.literal("lead"), z.string().regex(/^[^/\s]+\/\S+$/)])
      .optional(),
    thinking: z
      .union([
        z.literal("lead"),
        z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]),
      ])
      .optional(),
    permission: z.enum(["read_only", "autonomous"]).optional(),
    compaction: z
      .union([
        z.literal("inherit"),
        z
          .object({
            auto: z.boolean().optional(),
            profile: z.enum([
              "aggressive",
              "balanced",
              "conservative",
              "custom",
            ]),
            triggerPercent: z.number().int().min(60).max(90).optional(),
            keepRecentPercent: z.unknown().optional(),
          })
          .strict(),
      ])
      .optional(),
    tools: z.record(z.string(), z.union([z.boolean(), object])).optional(),
    skills: z
      .union([
        z.literal("inherit"),
        z.literal("none"),
        z.record(z.string(), z.boolean()),
      ])
      .optional(),
    instructions: z
      .string()
      .refine((value) => Buffer.byteLength(value) <= 16 * 1024)
      .optional(),
  })
  .strict();
export const releasedCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    profiles: z.record(
      z
        .string()
        .min(1)
        .max(32)
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
      entry,
    ),
  })
  .strict();
export const sha256 = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export const jsonBytes = (value: unknown) =>
  JSON.stringify(value, null, 2) + "\n";
export function merge(base: Data, patch: Data): Data {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    Object.defineProperty(result, key, {
      enumerable: true,
      configurable: true,
      writable: true,
      value:
        value && typeof value === "object" && !Array.isArray(value)
          ? merge(
              Object.hasOwn(result, key) &&
                result[key] &&
                typeof result[key] === "object" &&
                !Array.isArray(result[key])
                ? result[key]
                : {},
              value,
            )
          : structuredClone(value),
    });
  }
  return result;
}
const optionalTools = [
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
];
const rename = (name: string) =>
  name === "plan_mode_present"
    ? "plan_present"
    : name === "explore" || name.startsWith("subagent_")
      ? "subagents"
      : name;
export interface ConversionContext {
  documentPath?: string;
  inheritedSettings?: Data;
  report(message: string): void;
  /** Exact released discovery identities, including unavailable named references. Never guess a source. */
  skillSources: Readonly<
    Record<string, readonly ("file" | "nerve" | "agentBrowser")[]>
  >;
  builtins: Readonly<Record<string, Data>>;
}
export function compaction(
  value: Data,
  report: ConversionContext["report"],
): Data {
  const result = structuredClone(value);
  for (const key of ["customKeepRecentPercent", "keepRecentPercent"])
    if (key in result) {
      delete result[key];
      report(`Dropped legacy compaction field ${key}`);
    }
  if ("triggerPercent" in result) {
    result.customTriggerPercent = result.triggerPercent;
    delete result.triggerPercent;
  }
  return result;
}
function namedSkills(
  value: Record<string, boolean>,
  ctx: ConversionContext,
): Data {
  const result: Data = {};
  for (const [name, enabled] of Object.entries(value)) {
    const sources = Object.hasOwn(ctx.skillSources, name)
      ? ctx.skillSources[name]
      : undefined;
    if (!sources?.length)
      ctx.report(
        `Unmappable released skill source: ${ctx.documentPath ?? "subagents.json"} ${name}`,
      );
    assert(
      sources?.length,
      `Cannot establish released skill source identity: ${name}`,
    );
    for (const source of sources)
      Object.defineProperty((result[source] ??= {}), name, {
        value: enabled,
        enumerable: true,
        configurable: true,
        writable: true,
      });
  }
  return result;
}
export function convertCapabilitiesV037(input: unknown): Data {
  const raw = capabilities.parse(input);
  const result: Data = { tools: {}, skills: raw.skills ?? {} };
  for (const [name, value] of Object.entries(raw.tools ?? {})) {
    const key = rename(name);
    assert(!Object.hasOwn(result.tools, key), `Duplicate renamed tool: ${key}`);
    result.tools[key] = value;
  }
  for (const [name, settings] of Object.entries(raw.toolSettings ?? {}))
    result.tools[name] = { ...result.tools[name], settings };
  if (!Object.keys(result.tools).length) delete result.tools;
  if (!Object.keys(result.skills).length) delete result.skills;
  return leadSettingsOverridesSchema.parse(result);
}
export function convertPreferencesV037(
  input: {
    harness?: unknown;
    capabilities?: unknown;
    integrations?: unknown;
    scope?: "user" | "project";
  },
  ctx: ConversionContext,
) {
  const source = input.harness;
  if (source !== undefined)
    assert(
      source && typeof source === "object" && !Array.isArray(source),
      "Expected released harness object",
    );
  // Released project resolution deep-merged sparse JSON over the user v3 document.
  const raw: Data =
    source === undefined
      ? {}
      : harness.parse(
          input.scope === "project" ? { version: 3, ...source } : source,
        );
  let overrides: Data = {};
  const creation: Data = {};
  const chosen = raw.rememberLastSelection ? raw.lastSelection : raw.defaults;
  // Model/reasoning are independent. An absent remembered model replaces, not inherits, the same-scope default.
  for (const [old, key] of [
    ["model", "model"],
    ["permissionRuleSetId", "permissionRuleSetId"],
    ["thinkingLevel", "reasoningLevel"],
  ])
    if (chosen?.[old] !== undefined) overrides[key] = chosen[old];
  if (chosen?.mode !== undefined) creation.defaultAgentProfile = chosen.mode;
  if (raw.rememberLastSelection)
    ctx.report(
      "Folded remembered selection; removed remember-last option/state",
    );
  if (raw.scopedModels !== undefined) creation.scopedModels = raw.scopedModels;
  if (raw.compaction)
    overrides.compaction = compaction(raw.compaction, ctx.report);
  if (raw.retry) overrides.retry = raw.retry;
  const tools: Data = {};
  if (raw.tools?.disabled) {
    const disabled = new Set(
      raw.tools.disabled
        .filter((name: string) => name !== "explore")
        .map(rename),
    );
    for (const name of optionalTools.filter(
      (name) => name !== "jira" && name !== "confluence",
    ))
      tools[name] = { enabled: name !== "plan_present" && !disabled.has(name) };
  }
  for (const [old, name] of [
    ["imageExplanation", "explain_image"],
    ["imageGeneration", "generate_image"],
    ["kroki", "kroki_export"],
    ["bash", "bash"],
  ])
    if (raw.tools?.[old])
      tools[name] = { ...tools[name], settings: raw.tools[old] };
  if (raw.execution?.pythonExecutablePath)
    tools.python_exec = merge(tools.python_exec ?? {}, {
      settings: { interpreterPath: raw.execution.pythonExecutablePath },
    });
  if (raw.execution?.shellPath)
    tools.bash = merge(tools.bash ?? {}, {
      settings: { shellPath: raw.execution.shellPath },
    });
  const integration: Data | undefined =
    input.integrations === undefined
      ? undefined
      : releasedIntegrations.parse(input.integrations);
  if (integration) {
    if (input.scope === "project")
      assert(
        !integration.profiles.atlassian.length &&
          !integration.profiles.tavily.length,
        "Project-owned integration accounts require explicit user review before conversion",
      );
    assert(
      integration.version === 1,
      "Only released integrations v1 is a migration input",
    );
    for (const name of ["jira", "confluence"])
      if (integration.tools?.[name])
        tools[name] = merge(tools[name] ?? {}, integration.tools[name]);
    if (integration.tools?.web?.tavilyProfileId)
      tools.web_search = {
        ...tools.web_search,
        profileId: integration.tools.web.tavilyProfileId,
      };
  }
  if (Object.keys(tools).length) overrides.tools = tools;
  if (raw.skills)
    overrides.skills = {
      defaults: {
        ...(raw.skills.disabled ? { file: true } : {}),
        ...(raw.skills.nerve ? { nerve: false } : {}),
        ...(raw.skills.agentBrowser ? { agentBrowser: false } : {}),
      },
      file: Object.fromEntries(
        (raw.skills.disabled ?? []).map((name: string) => [name, false]),
      ),
      nerve: {
        ...Object.fromEntries(
          (raw.skills.nerve?.enabled ?? []).map((name: string) => [name, true]),
        ),
      },
      agentBrowser: {
        ...Object.fromEntries(
          (raw.skills.agentBrowser?.enabled ?? []).map((name: string) => [
            name,
            true,
          ]),
        ),
      },
    };
  if (input.capabilities !== undefined) {
    reportNewInheritance(
      merge(ctx.inheritedSettings ?? {}, overrides),
      input.capabilities,
      ctx,
    );
    const capabilities = convertCapabilitiesV037(input.capabilities);
    overrides = merge(overrides, capabilities);
    if (capabilities.tools?.generate_image?.settings)
      overrides.tools.generate_image.settings = structuredClone(
        capabilities.tools.generate_image.settings,
      );
  }
  if (input.scope === "project") {
    const lower = ctx.inheritedSettings ?? {};
    if (overrides.model)
      overrides.model = { ...lower.model, ...overrides.model };
    const generation = overrides.tools?.generate_image?.settings;
    if (
      generation &&
      raw.tools?.imageGeneration &&
      !(input.capabilities as Data | undefined)?.toolSettings?.generate_image
    )
      overrides.tools.generate_image.settings = merge(
        merge(
          releasedDefaults.harness.tools.imageGeneration,
          lower.tools?.generate_image?.settings ?? {},
        ),
        generation,
      );
    const promotion = overrides.tools?.bash?.settings?.autoPromotion;
    if (promotion)
      overrides.tools.bash.settings.autoPromotion = {
        ...releasedDefaults.harness.tools.bash.autoPromotion,
        ...lower.tools?.bash?.settings?.autoPromotion,
        ...promotion,
      };
    const explanation = overrides.tools?.explain_image?.settings;
    if (explanation?.model)
      explanation.model = {
        ...lower.tools?.explain_image?.settings?.model,
        ...explanation.model,
      };
  }
  const integrations: Data | undefined = integration
    ? { ...integration, version: 2 }
    : undefined;
  if (integrations) delete integrations.tools;
  return {
    agent: agentPreferencesSchema.parse({
      schemaVersion: 1,
      revision: 0,
      overrides,
    }),
    creation: conversationDefaultsSchema.parse({
      schemaVersion: 1,
      revision: 0,
      overrides: creation,
    }),
    integrations,
  };
}
export function splitCatalogV037(
  input: unknown,
  scope: "user" | "project" | "conversation",
  ctx: ConversionContext,
) {
  const catalog = releasedCatalogSchema.parse(input);
  const launches: Data = {},
    profiles: Data = {};
  for (const [name, value] of Object.entries(catalog.profiles)) {
    const raw: Data = value;
    const launch: Data = {};
    if (raw.enabled !== undefined) launch.enabled = raw.enabled;
    for (const [field, key] of [
      ["model", "model"],
      ["thinking", "reasoningLevel"],
    ]) {
      if (raw[field] === "lead")
        ctx.report(`Removed parent-copy behaviour: ${name}.${field}`);
      else if (raw[field] !== undefined) {
        if (field === "model") {
          const slash = raw.model.indexOf("/");
          assert(slash > 0, "Invalid released model reference");
          launch.model = {
            provider: raw.model.slice(0, slash),
            modelId: raw.model.slice(slash + 1),
          };
        } else launch[key] = raw[field];
      }
    }
    if (Object.keys(launch).length) launches[name] = launch;
    const other = Object.keys(raw).filter(
      (key) => !["enabled", "model", "thinking"].includes(key),
    );
    if (scope === "conversation") {
      if (other.length)
        ctx.report(
          `Dropped conversation sub-agent fields: ${name}: ${other.join(", ")}`,
        );
      continue;
    }
    if (!other.length) continue;
    const complete = merge(
      Object.hasOwn(ctx.builtins, name) ? ctx.builtins[name] : {},
      raw,
    );
    assert(
      complete.description &&
        complete.instructions !== undefined &&
        complete.model !== undefined &&
        complete.thinking !== undefined &&
        complete.permission !== undefined &&
        complete.compaction !== undefined &&
        complete.skills !== undefined,
      `Incomplete custom released profile: ${name}`,
    );
    const recommendations: Data = { ...launch };
    delete recommendations.enabled;
    if (complete.permission !== undefined)
      recommendations.permissionRuleSetId = complete.permission;
    if (complete.compaction && complete.compaction !== "inherit")
      recommendations.compaction = compaction(complete.compaction, ctx.report);
    for (const [tool, settings] of Object.entries(complete.tools ?? {}))
      (recommendations.tools ??= {})[rename(tool)] =
        typeof settings === "boolean" ? { enabled: settings } : { settings };
    if (
      complete.skills &&
      complete.skills !== "none" &&
      complete.skills !== "inherit"
    )
      recommendations.skills = namedSkills(complete.skills, ctx);
    profiles[name] = profileDefinitionSchema.parse({
      schemaVersion: 1,
      name,
      label: complete.label,
      whenToUse: complete.description,
      // Released enablement belongs only to the launch override; do not pin it
      // a second time in the catalog and make Use settings unable to re-enable.
      enabled: Object.hasOwn(ctx.builtins, name)
        ? ctx.builtins[name].enabled
        : undefined,
      usableBy: "subagent",
      instructions: complete.instructions,
      recommendations,
    });
  }
  return { launches, profiles };
}
export function modeSnapshot(mode: unknown) {
  assert(mode === "planning" || mode === "coding", "Invalid released mode");
  const bytes = bundledAgentProfiles[mode];
  const profile = profileDefinitionSchema.parse(JSON.parse(bytes));
  return {
    name: mode,
    source: "builtin" as const,
    sourceDigest: sha256(bytes),
    instructions: profile.instructions,
    recommendations: profile.recommendations ?? {},
    requirements: profile.requirements ?? {},
  };
}
export interface ReleasedConversation {
  conversation_id: string;
  model: string;
  reasoning_level: string;
  permission_rule_set_id: string;
  mode: string;
  system_prompt: string | null;
  instructions: string | null;
  working_directory: string;
  parent_conversation_id?: string | null;
  project_id?: string;
}
export function convertConversationV037(
  row: ReleasedConversation,
  input: {
    capabilities?: unknown;
    harness?: unknown;
    subagents?: unknown;
    childDefaults?: unknown;
  },
  ctx: ConversionContext,
) {
  const context = {
    ...(row.instructions !== null ? { instructions: row.instructions } : {}),
    ...(row.system_prompt !== null ? { systemPrompt: row.system_prompt } : {}),
  };
  const promptContext = Object.keys(context).length ? { context } : {};
  let overrides: Data = {
    model: JSON.parse(row.model),
    reasoningLevel: row.reasoning_level,
    permissionRuleSetId: row.permission_rule_set_id,
  };
  if (input.capabilities !== undefined) {
    if (input.childDefaults === undefined)
      reportNewInheritance(
        ctx.inheritedSettings ?? {},
        input.capabilities,
        ctx,
      );
    overrides = merge(overrides, convertCapabilitiesV037(input.capabilities));
  }
  if (input.harness !== undefined) {
    const own = z
      .object({ compaction: object.optional() })
      .strict()
      .parse(input.harness);
    if (own.compaction)
      overrides.compaction = compaction(own.compaction, ctx.report);
  }
  if (input.subagents !== undefined)
    overrides.subagents = splitCatalogV037(
      input.subagents,
      "conversation",
      ctx,
    ).launches;
  if (input.childDefaults !== undefined) {
    // Child effective values were materialized at creation; never reapply a live profile.
    const frozen: Data = merge(
      input.capabilities === undefined
        ? (input.childDefaults as Data)
        : applyReleasedCapabilities(
            input.childDefaults as Data,
            input.capabilities,
          ),
      { ...overrides, tools: {} },
    );
    delete frozen.subagents;
    if (frozen.tools) {
      delete frozen.tools.subagents;
      delete frozen.tools.plan_present;
    }
    return childConversationAgentSchema.parse({
      schemaVersion: 1,
      revision: 0,
      overrides: {},
      appliedProfile: null,
      frozenDefaults: completeChildSettingsSchema.parse(frozen),
      ...promptContext,
    });
  }
  return leadConversationAgentSchema.parse({
    schemaVersion: 1,
    revision: 0,
    overrides,
    appliedProfile: modeSnapshot(row.mode),
    ...promptContext,
  });
}

/** Shared registered boundary for storage-wide upgrade and later first-use project conversion. */
export const releasedDocumentConverters = Object.freeze({
  release: "0.37.0",
  preferences: convertPreferencesV037,
  capabilities: convertCapabilitiesV037,
  catalog: splitCatalogV037,
  conversation: convertConversationV037,
});

/** D9 accepts target inheritance, but never silently: name the document/field. */
export function reportNewInheritance(
  lower: Data,
  input: unknown,
  ctx: ConversionContext,
): void {
  const raw = input as Data;
  const document = ctx.documentPath ?? "capabilities.json";
  for (const name of ["jira", "confluence", "web_search"]) {
    if (
      raw.tools?.[name] &&
      raw.tools[name].profileId === undefined &&
      lower.tools?.[name]?.profileId !== undefined
    )
      ctx.report(
        `D9 newly inherited account: ${document} /tools/${name}/profileId`,
      );
  }
  if (
    raw.toolSettings?.explain_image &&
    raw.toolSettings.explain_image.model === undefined &&
    lower.tools?.explain_image?.settings?.model !== undefined
  )
    ctx.report(
      `D9 newly inherited model: ${document} /tools/explain_image/settings/model`,
    );
}

/** Released children keep the released effective values, including absence.
 * Tool settings replace atomically; enabled-only account entries clear the ID. */
export function applyReleasedCapabilities(lower: Data, input: unknown): Data {
  const raw = input as Data;
  const converted = convertCapabilitiesV037(input);
  const result = merge(lower, converted);
  for (const name of ["jira", "confluence", "web_search"])
    if (raw.tools?.[name] && raw.tools[name].profileId === undefined)
      delete result.tools[name].profileId;
  for (const [name, settings] of Object.entries(raw.toolSettings ?? {}))
    result.tools[name].settings = structuredClone(settings);
  return result;
}
