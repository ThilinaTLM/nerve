import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  leadSettingsOverridesSchema,
  childConversationAgentSchema,
  leadConversationAgentSchema,
  configurationJSONSchemas,
  type LeadSettingsOverrides,
} from "../src/domains/agent-configuration/schemas.js";
import {
  applySettingsMutation,
  resolveAgentConfiguration,
  freezeChildPreferences,
} from "../src/domains/agent-configuration/resolver.js";

const modelA = { provider: "provider-a", modelId: "model-a" };
const modelB = { provider: "provider-b", modelId: "model-b" };
// These are the five object-valued canonical merge units, not containers.
const atomicPaths = new Set([
  "/model",
  "/tools/explain_image/settings/model",
  "/tools/generate_image/settings",
  "/tools/bash/settings/autoPromotion",
  "/subagents/coding/model",
]);
function unwrap(schema: z.ZodType): z.ZodType {
  return schema instanceof z.ZodOptional
    ? unwrap(schema.unwrap() as z.ZodType)
    : schema;
}
/** Enumerate every schema field, using one representative key for each record. */
function fields(
  schema: z.ZodType,
  path = "",
  stopAtAtomic = true,
): [string, z.ZodType][] {
  schema = unwrap(schema);
  if (stopAtAtomic && atomicPaths.has(path)) return [[path, schema]];
  if (schema instanceof z.ZodObject)
    return Object.entries(schema.shape).flatMap(([key, child]) =>
      fields(child as z.ZodType, `${path}/${key}`, stopAtAtomic),
    );
  if (schema instanceof z.ZodRecord)
    return fields(
      schema.valueType as z.ZodType,
      `${path}/${path === "/subagents" ? "coding" : "example"}`,
      stopAtAtomic,
    );
  return [[path, schema]];
}
const booleanPair = [true, false] as const;
// Each pair deliberately differs; atomic values differ in every variable member.
const cases: Record<string, readonly [unknown, unknown]> = {
  "/model": [modelA, modelB],
  "/reasoningLevel": ["low", "high"],
  "/permissionRuleSetId": ["planning", "autonomous"],
  "/compaction/auto": booleanPair,
  "/compaction/profile": ["balanced", "custom"],
  "/compaction/customTriggerPercent": [70, 85],
  "/retry/enabled": booleanPair,
  "/retry/maxRetries": [3, 0],
  "/retry/baseDelayMs": [1000, 2000],
  "/tools/python_exec/enabled": booleanPair,
  "/tools/python_exec/settings/interpreterPath": [
    "/lower/python",
    "/upper/python",
  ],
  "/tools/web_search/enabled": booleanPair,
  "/tools/web_search/profileId": ["lower-search", "upper-search"],
  "/tools/jira/enabled": booleanPair,
  "/tools/jira/profileId": ["lower-jira", "upper-jira"],
  "/tools/confluence/enabled": booleanPair,
  "/tools/confluence/profileId": ["lower-confluence", "upper-confluence"],
  "/tools/web_fetch/enabled": booleanPair,
  "/tools/plan_present/enabled": booleanPair,
  "/tools/plan_present/settings/approvalProfile": ["planning", "coding"],
  "/tools/explain_image/enabled": booleanPair,
  "/tools/explain_image/settings/model": [modelA, modelB],
  "/tools/explain_image/settings/thinkingLevel": ["low", "high"],
  "/tools/generate_image/enabled": booleanPair,
  "/tools/generate_image/settings": [
    {
      provider: "openai-codex",
      model: "gpt-image-2.5-flare",
      options: { quality: "low", size: "auto", background: "opaque" },
    },
    {
      provider: "openai-codex",
      model: "gpt-image-2.5-sunburst",
      options: {
        quality: "high",
        size: "1024x1024",
        background: "transparent",
      },
    },
  ],
  "/tools/kroki_export/enabled": booleanPair,
  "/tools/kroki_export/settings/url": [
    "https://lower.example/",
    "https://upper.example/",
  ],
  "/tools/bash/settings/shellPath": ["/lower/bash", "/upper/bash"],
  "/tools/bash/settings/autoPromotion": [
    { enabled: true, afterMs: 1000 },
    { enabled: false, afterMs: 2000 },
  ],
  "/tools/bash/settings/maxTimeoutMs": [1000, 2000],
  "/tools/subagents/enabled": booleanPair,
  "/skills/defaults/file": booleanPair,
  "/skills/defaults/nerve": booleanPair,
  "/skills/defaults/agentBrowser": booleanPair,
  "/skills/file/example": booleanPair,
  "/skills/nerve/example": booleanPair,
  "/skills/agentBrowser/example": booleanPair,
  "/subagents/coding/enabled": booleanPair,
  "/subagents/coding/model": [modelA, modelB],
  "/subagents/coding/reasoningLevel": ["low", "high"],
};
function sparse(path: string, value: unknown): LeadSettingsOverrides {
  const keys = path.slice(1).split("/");
  const input = keys.reduceRight<unknown>(
    (child, key) => ({ [key]: child }),
    value,
  );
  const parsed = leadSettingsOverridesSchema.parse(input);
  assert.deepEqual(
    parsed,
    input,
    `Sparse parsing must not materialize defaults: ${path}`,
  );
  return parsed;
}
function at(value: unknown, path: string): unknown {
  for (const key of path.slice(1).split("/")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key))
      return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
const schemaFields = fields(leadSettingsOverridesSchema);
test(`field coverage is exhaustive: ${schemaFields.length} canonical units, ${fields(leadSettingsOverridesSchema, "", false).length} leaf fields`, () => {
  assert.deepEqual(
    Object.keys(cases).sort(),
    schemaFields.map(([path]) => path).sort(),
  );
  // Also ensure atomic fixture pairs cover every inner schema member, so an added
  // model/union option cannot escape coverage merely because its parent is atomic.
  for (const [path, schema] of schemaFields)
    if (atomicPaths.has(path)) {
      for (const [inner] of fields(schema, "", false)) {
        for (const value of cases[path])
          assert.notEqual(at(value, inner), undefined, `${path}${inner}`);
      }
    }
});
for (const [path, schema] of schemaFields) {
  test(`${path}: independent omission, override, reset${schema instanceof z.ZodBoolean ? ", false" : ""}${atomicPaths.has(path) ? ", atomic replacement" : ""}`, () => {
    const pair = cases[path];
    assert.ok(pair, `Missing fixture: ${path}`);
    const [lower, upper] = pair;
    assert.notDeepEqual(lower, upper);
    const user = sparse(path, lower);
    const conversation = sparse(path, upper);
    const resolve = (choice: LeadSettingsOverrides) =>
      resolveAgentConfiguration({
        role: "lead",
        user,
        conversation: choice,
        eligibleSkills: {
          file: ["example"],
          nerve: ["example"],
          agentBrowser: ["example"],
        },
      });
    assert.deepEqual(leadSettingsOverridesSchema.parse({}), {});
    const omitted = resolve({});
    assert.deepEqual(at(omitted.settings, path), lower);
    assert.equal(omitted.provenance[path]?.source, "user");
    assert.deepEqual(
      leadSettingsOverridesSchema.parse(conversation),
      conversation,
    );
    const explicit = resolve(conversation);
    assert.deepEqual(at(explicit.settings, path), upper);
    assert.equal(explicit.provenance[path]?.source, "conversation");
    const reset = applySettingsMutation(conversation, {
      expectedRevision: 0,
      expectedDigest: "missing",
      changes: {},
      resets: [`/overrides${path}`],
    });
    assert.equal(at(reset, path), undefined);
    assert.deepEqual(reset, {}, "Reset prunes all emptied containers");
    const inherited = resolve(reset);
    assert.deepEqual(at(inherited.settings, path), lower);
    assert.equal(inherited.provenance[path]?.source, "user");
    if (path.startsWith("/skills/defaults/")) {
      const namedPath = `/skills/${path.split("/").at(-1)}/example`;
      assert.equal(
        at(omitted.settings, namedPath),
        lower,
        "Omitted source defaults inherit the lower-layer named decision",
      );
      assert.equal(
        at(explicit.settings, namedPath),
        upper,
        "Explicit false source defaults disable discovered skills",
      );
      assert.equal(
        at(inherited.settings, namedPath),
        lower,
        "Reset source defaults restore inherited named decisions",
      );
    }
    if (schema instanceof z.ZodBoolean) {
      assert.equal(lower, true);
      assert.equal(
        at(explicit.settings, path),
        false,
        "False must beat true, not inherit it",
      );
    }
    if (atomicPaths.has(path)) {
      const upperObject = upper as Record<string, unknown>;
      for (const [innerPath] of fields(schema, "", false)) {
        const partial = structuredClone(upperObject);
        const keys = innerPath.slice(1).split("/");
        let parent = partial;
        for (const key of keys.slice(0, -1))
          parent = parent[key] as Record<string, unknown>;
        delete parent[keys.at(-1)!];
        assert.throws(
          () => sparse(path, partial),
          `Incomplete atomic input: ${path}${innerPath}`,
        );
        assert.throws(
          () =>
            applySettingsMutation(conversation, {
              expectedRevision: 0,
              expectedDigest: "missing",
              changes: {},
              resets: [`/overrides${path}${innerPath}`],
            }),
          "Cannot reset inside atomic values",
        );
      }
      if ("enabled" in upperObject)
        assert.equal(
          (at(explicit.settings, path) as { enabled: boolean }).enabled,
          false,
        );
    }
  });
}

test("persisted child documents require a complete frozen baseline, never a lead-schema fallback", () => {
  const document = {
    schemaVersion: 1,
    revision: 0,
    overrides: {},
    appliedProfile: null,
  };
  assert.equal(leadConversationAgentSchema.safeParse(document).success, true);
  const missing = childConversationAgentSchema.safeParse(document);
  assert.equal(missing.success, false);
  if (!missing.success)
    assert.ok(
      missing.error.issues.some((issue) => issue.path[0] === "frozenDefaults"),
    );
  for (const frozenDefaults of [undefined, null, {}])
    assert.equal(
      childConversationAgentSchema.safeParse({ ...document, frozenDefaults })
        .success,
      false,
    );
  const frozenDefaults = freezeChildPreferences({});
  assert.deepEqual(
    childConversationAgentSchema.parse({ ...document, frozenDefaults }),
    { ...document, frozenDefaults },
  );
  assert.equal(
    leadConversationAgentSchema.safeParse({ ...document, frozenDefaults })
      .success,
    false,
  );
  assert.equal(
    childConversationAgentSchema.safeParse({ ...document, role: "lead" })
      .success,
    false,
    "Editable role cannot select a permissive schema",
  );
  const exported = configurationJSONSchemas().childConversationAgent;
  assert.ok(exported.required?.includes("frozenDefaults"));
  assert.equal(exported.additionalProperties, false);
});
