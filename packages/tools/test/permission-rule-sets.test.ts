import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  permissionOverlayForOriginSchema,
  type PermissionOverlay,
  type PermissionRule,
} from "@nervekit/contracts";
import {
  builtInPermissionRuleSet,
  composeEffectivePermissionPolicy,
  evaluatePermissionRequest,
  normalizePermissionRequest,
  permissionMetadataForTool,
  toolManifest,
} from "../src/index.js";

const roots = {
  project: "/workspace",
  nerve_home: "/nerve",
  nerve_data: "/nerve/data",
  plans: "/nerve/data/plans",
};

function decision(
  selected: string,
  toolName: Parameters<typeof normalizePermissionRequest>[0]["toolName"],
  args: Record<string, unknown> = {},
  overlays: {
    userOverlay?: PermissionOverlay;
    projectOverlay?: PermissionOverlay;
    conversationOverlay?: PermissionOverlay;
  } = {},
) {
  const defaults: Record<string, unknown> =
    toolName === "write"
      ? { content: "" }
      : toolName === "edit"
        ? { edits: [{ oldText: "before", newText: "after" }] }
        : toolName === "grep"
          ? { pattern: "value" }
          : {};
  const request = normalizePermissionRequest({
    toolName,
    args: { ...defaults, ...args },
    roots,
    conversationId: "conv_test",
  });
  const policy = composeEffectivePermissionPolicy({
    selectedRuleSet: builtInPermissionRuleSet(selected),
    ...overlays,
  });
  return evaluatePermissionRequest({ request, policy });
}

function rule(
  id: string,
  priority: number,
  decision: PermissionRule["decision"],
  enforcement: PermissionRule["enforcement"] = "overridable",
): PermissionRule {
  return {
    id,
    enabled: true,
    priority,
    enforcement,
    when: { toolNames: ["write"] },
    decision,
  };
}

function overlay(...rules: PermissionRule[]): PermissionOverlay {
  return { schemaVersion: 1, rules };
}

test("catalog has complete static policy metadata", () => {
  assert.equal(toolManifest.length, 50);
  for (const definition of toolManifest) {
    const metadata = permissionMetadataForTool(definition.name);
    assert.ok(metadata.kind);
    assert.ok(metadata.groups.length > 0);
    assert.ok(metadata.baseRisk);
    assert.ok(metadata.targetKinds.length > 0);
  }
  assert.equal(permissionMetadataForTool("bash").baseRisk, "unknown");
  assert.equal(permissionMetadataForTool("python_exec").baseRisk, "unknown");
  assert.equal(
    permissionMetadataForTool("jira_manage_comment").baseRisk,
    "destructive",
  );
});

test("built-in coding rule sets implement their complete behavior", () => {
  assert.equal(
    decision("read_only", "read", { path: "README.md" }).decision,
    "allow",
  );
  assert.equal(
    decision("read_only", "web_fetch", { url: "https://example.com" }).decision,
    "deny",
  );
  assert.equal(decision("read_only", "write", { path: "x" }).decision, "deny");
  assert.equal(
    decision("read_only", "explore", {
      tasks: [{ task: "Inspect permission handling" }],
      context:
        "Inspect the current permission policy implementation and identify the relevant files.",
    }).decision,
    "allow",
  );
  assert.equal(
    decision("supervised", "read", { path: "README.md" }).decision,
    "allow",
  );
  assert.equal(
    decision("supervised", "bash", { command: "pwd" }).decision,
    "prompt",
  );
  assert.equal(
    decision("supervised", "web_fetch", { url: "https://example.com" })
      .decision,
    "prompt",
  );
  assert.equal(
    decision("autonomous", "bash", { command: "rm -rf x" }).decision,
    "allow",
  );
  assert.equal(
    decision("autonomous", "ask_user", { question: "Continue?" }).decision,
    "allow",
  );
});

test("planning allows reads, interaction, Explore, and exact plan writes", () => {
  assert.equal(
    decision("planning", "read", { path: "README.md" }).decision,
    "allow",
  );
  assert.equal(
    decision("planning", "write", { path: "/nerve/data/plans/a.md" }).decision,
    "allow",
  );
  assert.equal(
    decision("planning", "explore", {
      tasks: [{ task: "Research the implementation" }],
      context:
        "Research the current implementation paths and report the relevant code relationships.",
    }).decision,
    "allow",
  );
  assert.equal(
    decision("planning", "edit", { path: "/workspace/a.ts" }).decision,
    "deny",
  );
  assert.equal(
    decision("planning", "bash", { command: "pwd" }).decision,
    "deny",
  );
  assert.equal(
    decision("planning", "web_fetch", { url: "https://example.com" }).decision,
    "deny",
  );
});

test("guardrails and scope ranks precede numeric priority and decision kind", () => {
  const userOverlay = overlay(rule("user-deny", 1000, "deny"));
  const projectOverlay = overlay(rule("project-allow", -1000, "allow"));
  assert.equal(
    decision(
      "read_only",
      "write",
      { path: "a" },
      { userOverlay, projectOverlay },
    ).decision,
    "allow",
  );

  const guardrail = overlay(rule("never-write", -1000, "deny", "guardrail"));
  const conversationOverlay = overlay(
    rule("conversation-allow", 1000, "allow"),
  );
  const result = decision(
    "autonomous",
    "write",
    { path: "a" },
    {
      userOverlay: guardrail,
      conversationOverlay,
    },
  );
  assert.equal(result.decision, "deny");
  assert.equal(result.winningRuleId, "never-write");
});

test("greater priority wins only within the same enforcement and origin", () => {
  const projectOverlay = overlay(
    rule("lower-deny", 10, "deny"),
    rule("higher-prompt", 20, "prompt"),
  );
  const result = decision(
    "autonomous",
    "write",
    { path: "a" },
    { projectOverlay },
  );
  assert.equal(result.decision, "prompt");
  assert.equal(result.winningRuleId, "higher-prompt");
});

test("all target matcher rejects empty target collections and covers compound targets", () => {
  const allowPlans: PermissionRule = {
    id: "allow-plans",
    enabled: true,
    priority: 10,
    enforcement: "overridable",
    when: {
      targets: {
        quantifier: "all",
        matcher: { kind: "path", root: "plans", pattern: "**" },
      },
    },
    decision: "allow",
  };
  const projectOverlay = overlay(allowPlans);
  assert.equal(
    decision(
      "read_only",
      "grep",
      { paths: ["/nerve/data/plans/a", "/nerve/data/plans/sub/b"] },
      { projectOverlay },
    ).winningRuleId,
    "allow-plans",
  );
  assert.equal(
    decision(
      "read_only",
      "grep",
      { paths: ["/nerve/data/plans/a", "/workspace/src"] },
      { projectOverlay },
    ).winningRuleId,
    "allow-read",
  );
});

test("exact opaque suggestions use the complete primary argument", () => {
  const result = decision("supervised", "bash", {
    command: "git status && echo ok",
  });
  assert.equal(result.decision, "prompt");
  assert.deepEqual(result.suggestedRules[0]?.when.primaryArgument, {
    operator: "equals",
    value: "git status && echo ok",
  });
});

test("secret-bearing URLs never produce durable rule suggestions", () => {
  const result = decision("supervised", "web_fetch", {
    url: "https://example.com/data?token=secret",
  });
  assert.deepEqual(result.suggestedRules, []);
});

test("path suggestions use portable canonical targets", () => {
  const result = decision("supervised", "write", {
    path: "src/index.ts",
    content: "x",
  });
  assert.deepEqual(result.suggestedRules[0]?.when.targets, {
    quantifier: "all",
    matcher: {
      kind: "path",
      access: "write",
      scope: "exact",
      root: "project",
      pattern: "src/index.ts",
    },
  });
});

test("policy hash is deterministic and changes with effective policy", () => {
  const first = decision("supervised", "write", { path: "a" });
  const second = decision("supervised", "write", { path: "a" });
  assert.equal(first.policySnapshotHash, second.policySnapshotHash);
  const changed = decision(
    "supervised",
    "write",
    { path: "a" },
    {
      userOverlay: overlay(rule("allow-write", 1, "allow")),
    },
  );
  assert.notEqual(first.policySnapshotHash, changed.policySnapshotHash);
});

test("existing symlinks are canonicalized before path authorization", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-policy-symlink-"));
  try {
    const project = join(root, "project");
    const nerveHome = join(root, "nerve");
    await mkdir(project);
    await mkdir(nerveHome);
    const outside = join(root, "outside.txt");
    await writeFile(outside, "secret");
    const link = join(project, "linked.txt");
    await symlink(outside, link);
    assert.throws(() =>
      normalizePermissionRequest({
        toolName: "read",
        args: { path: link },
        roots: {
          project,
          nerve_home: nerveHome,
          nerve_data: join(nerveHome, "data"),
          plans: join(nerveHome, "data", "plans"),
        },
        conversationId: "conv_test",
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source schemas reject forbidden guardrails and broad project grants", () => {
  assert.throws(() =>
    permissionOverlayForOriginSchema("conversation").parse(
      overlay(rule("guard", 1, "deny", "guardrail")),
    ),
  );
  assert.throws(() =>
    permissionOverlayForOriginSchema("project").parse({
      schemaVersion: 1,
      rules: [
        {
          id: "broad-home",
          enabled: true,
          priority: 1,
          enforcement: "overridable",
          when: {
            targets: {
              quantifier: "all",
              matcher: { kind: "path", root: "nerve_home", pattern: "**" },
            },
          },
          decision: "allow",
        },
      ],
    }),
  );
});
