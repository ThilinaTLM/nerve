import assert from "node:assert/strict";
import test from "node:test";
import {
  permissionOverlayDocumentForOriginSchema,
  permissionOverlayDocumentSchema,
  permissionOverlayForOriginSchema,
  permissionOverlaySchema,
  permissionRuleSchema,
  permissionRuleSetSchema,
  permissionTargetSchema,
} from "../../src/domains/permissions/index.js";

const rule = {
  id: "allow-read",
  enabled: true,
  priority: 10,
  enforcement: "overridable" as const,
  when: { baseRisks: ["read" as const] },
  decision: "allow" as const,
};

test("permission rule schemas enforce priorities and guardrail decisions", () => {
  assert.equal(permissionRuleSchema.parse(rule).id, "allow-read");
  assert.throws(() =>
    permissionRuleSchema.parse({
      ...rule,
      enforcement: "guardrail",
      decision: "allow",
    }),
  );
  assert.throws(() =>
    permissionOverlaySchema.parse({
      ruleSetId: "planning",
      rules: [rule, { ...rule, id: "other" }],
    }),
  );
  assert.throws(() =>
    permissionOverlaySchema.parse({
      ruleSetId: "planning",
      rules: [rule, { ...rule, priority: 11 }],
    }),
  );
});

test("overlay documents require one bounded group per rule set", () => {
  assert.deepEqual(
    permissionOverlayDocumentSchema
      .parse({
        schemaVersion: 2,
        overlays: [
          { ruleSetId: "planning", rules: [rule] },
          {
            ruleSetId: "supervised",
            rules: [{ ...rule, id: "allow-read", priority: 10 }],
          },
        ],
      })
      .overlays.map((overlay) => overlay.ruleSetId),
    ["planning", "supervised"],
  );
  assert.throws(() =>
    permissionOverlayDocumentSchema.parse({
      schemaVersion: 2,
      overlays: [
        { ruleSetId: "planning", rules: [] },
        { ruleSetId: "planning", rules: [] },
      ],
    }),
  );
  assert.throws(() =>
    permissionOverlayDocumentSchema.parse({
      schemaVersion: 2,
      overlays: [{ ruleSetId: "planning", rules: Array(257).fill(rule) }],
    }),
  );
});

test("rule sets reject guardrails and unsafe IDs", () => {
  assert.throws(() =>
    permissionRuleSetSchema.parse({
      schemaVersion: 1,
      id: "Unsafe ID",
      name: "Unsafe",
      source: "user",
      enabled: true,
      rules: [rule],
    }),
  );
  assert.throws(() =>
    permissionRuleSetSchema.parse({
      schemaVersion: 1,
      id: "custom",
      name: "Custom",
      source: "user",
      enabled: true,
      rules: [{ ...rule, enforcement: "guardrail", decision: "deny" }],
    }),
  );
});

test("project and conversation sources reject forbidden authority", () => {
  assert.throws(() =>
    permissionOverlayForOriginSchema("conversation").parse({
      ruleSetId: "planning",
      rules: [{ ...rule, enforcement: "guardrail", decision: "deny" }],
    }),
  );
  assert.throws(() =>
    permissionOverlayDocumentForOriginSchema("project").parse({
      schemaVersion: 2,
      overlays: [
        {
          ruleSetId: "planning",
          rules: [
            {
              ...rule,
              when: {
                targets: {
                  quantifier: "all",
                  matcher: {
                    kind: "path",
                    root: "nerve_data",
                    pattern: "**",
                  },
                },
              },
            },
          ],
        },
      ],
    }),
  );
});

test("permission targets distinguish portable rooted and external paths", () => {
  assert.deepEqual(
    permissionTargetSchema.parse({
      kind: "path",
      access: "read",
      scope: "exact",
      root: "project",
      relativePath: "src/index.ts",
    }),
    {
      kind: "path",
      access: "read",
      scope: "exact",
      root: "project",
      relativePath: "src/index.ts",
    },
  );
  assert.deepEqual(
    permissionTargetSchema.parse({
      kind: "path",
      access: "read",
      scope: "tree",
      absolutePath: "/tmp/external",
    }),
    {
      kind: "path",
      access: "read",
      scope: "tree",
      absolutePath: "/tmp/external",
    },
  );
  assert.throws(() =>
    permissionTargetSchema.parse({
      kind: "path",
      access: "read",
      scope: "exact",
      root: "project",
      relativePath: "src/index.ts",
      absolutePath: "/tmp/external",
    }),
  );
  assert.throws(() =>
    permissionTargetSchema.parse({
      kind: "path",
      access: "read",
      scope: "tree",
      absolutePath: "relative/path",
    }),
  );
});

test("path matchers reject traversal and platform-dependent forms", () => {
  for (const pattern of ["../secret", "a\\b", "/absolute", "C:/absolute"]) {
    assert.throws(() =>
      permissionRuleSchema.parse({
        ...rule,
        when: {
          targets: {
            quantifier: "all",
            matcher: { kind: "path", root: "project", pattern },
          },
        },
      }),
    );
  }
});
