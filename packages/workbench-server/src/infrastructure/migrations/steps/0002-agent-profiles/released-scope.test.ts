import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import {
  releasedBuiltins,
  readReleasedScope,
  validateReleasedCatalog,
} from "./released-scope.js";
import {
  isolateScopeTargets,
  releasedScopeTargets,
} from "./released-scope-targets.js";
import {
  convertConversationV037,
  convertPreferencesV037,
} from "./released-format.js";
// Product code builds paths with the host separator; expectations must too.
const configFile = (root: string, name: string) => join(root, "config", name);
const context = {
  builtins: releasedBuiltins,
  skillSources: {},
  report: () => {},
};
for (const scope of ["user", "project"] as const) {
  await test(`D12 ${scope} source inspection isolates malformed/unsupported files without changing bytes or other scopes`, () => {
    const files = new Map([
        [configFile("/bad", "harness.json"), "{bad JSON\n"],
        [configFile("/bad", "capabilities.json"), '{"schemaVersion":3}'],
        [
          configFile("/good", "capabilities.json"),
          '{"schemaVersion":2,"tools":{"jira":{"enabled":true}}}',
        ],
        [
          configFile("/bad", "integrations.json"),
          '{"version":2,"profiles":{}}',
        ],
      ]),
      before = new Map(files),
      io = { read: (path: string) => files.get(path) };
    const bad = readReleasedScope("/bad", io, scope, context);
    assert.equal(bad.issues.length, 2);
    assert.deepEqual(
      bad.issues.map((issue) => issue.path),
      [
        configFile("/bad", "harness.json"),
        configFile("/bad", "capabilities.json"),
      ],
    );
    assert.deepEqual(bad.before, {});
    assert.equal(bad.snapshots.size, 0);
    const good = readReleasedScope("/good", io, scope, context);
    assert.deepEqual(good.issues, []);
    assert.equal(
      convertPreferencesV037({ ...good.before, scope }, context).agent.overrides
        .tools!.jira!.enabled,
      true,
    );
    assert.deepEqual(files, before);
  });
}
await test("D12 unconvertible catalog skill identities are scoped issues, not partial profile exports", () => {
  const source =
    '{"schemaVersion":1,"profiles":{"developer":{"skills":{"undiscovered":false}}}}';
  const input = readReleasedScope(
    "/project",
    { read: (file) => (file.endsWith("subagents.json") ? source : undefined) },
    "project",
    context,
  );
  assert.equal(input.issues.length, 0);
  validateReleasedCatalog(input, "/project", "project", context);
  assert.equal(input.before.subagents, undefined);
  assert.equal(input.issues[0].path, configFile("/project", "subagents.json"));
  assert.match(input.issues[0].reason, /skill source identity/);
});

await test("D12 existing canonical targets isolate the scoped export without overwriting either file", () => {
  const source = '{"schemaVersion":2,"tools":{"jira":{"enabled":true}}}';
  const files = new Map([
    [configFile("/project", "capabilities.json"), source],
    [configFile("/project", "agent.json"), "existing bytes"],
  ]);
  const io = { read: (path: string) => files.get(path) };
  const input = readReleasedScope("/project", io, "project", context);
  const result = convertPreferencesV037(
    { ...input.before, scope: "project" },
    context,
  );
  const targets = isolateScopeTargets(
    "/project",
    input,
    io,
    releasedScopeTargets("/project", "project", input.before, context, result),
  );
  assert.deepEqual(targets, {});
  assert.equal(
    input.issues[0].path,
    configFile("/project", "capabilities.json"),
  );
  assert.match(input.issues[0].reason, /Existing conversion target/);
  assert.equal(files.get(configFile("/project", "capabilities.json")), source);
  assert.equal(
    files.get(configFile("/project", "agent.json")),
    "existing bytes",
  );
});

await test("released conversation sources use their own sparse shapes, not user preferences", () => {
  const harness = {
    compaction: { auto: false, profile: "custom", customTriggerPercent: 63 },
  };
  const capabilities = {
    schemaVersion: 2,
    tools: { web_search: { enabled: false } },
  };
  // Conversation catalogs are launch overrides, not complete authored user profiles.
  const subagents = {
    schemaVersion: 1,
    profiles: { custom: { enabled: false, label: "Legacy label" } },
  };
  const files = new Map([
    [configFile("/conversation", "harness.json"), JSON.stringify(harness)],
    [
      configFile("/conversation", "capabilities.json"),
      JSON.stringify(capabilities),
    ],
    [configFile("/conversation", "subagents.json"), JSON.stringify(subagents)],
  ]);
  const io = {
    read(path: string) {
      assert(
        !path.endsWith("integrations.json"),
        "Conversation conversion must not inspect unrelated accounts",
      );
      return files.get(path);
    },
  };
  const input = readReleasedScope("/conversation", io, "conversation", context);
  validateReleasedCatalog(input, "/conversation", "conversation", context);
  assert.deepEqual(input.issues, []);
  assert.deepEqual(input.before, { harness, capabilities, subagents });
  assert.equal(input.snapshots.size, 3);
  const agent = convertConversationV037(
    {
      conversation_id: "c",
      model: '{"provider":"test","modelId":"model"}',
      reasoning_level: "high",
      permission_rule_set_id: "planning",
      mode: "coding",
      system_prompt: null,
      instructions: null,
      working_directory: "/project",
    },
    input.before,
    context,
  );
  assert(!("frozenDefaults" in agent), "Expected lead conversation overrides");
  assert.deepEqual(agent.overrides.compaction, harness.compaction);
  assert.equal(agent.overrides.tools!.web_search!.enabled, false);
  assert.equal(agent.overrides.subagents!.custom.enabled, false);
  // The fix does not relax the independently versioned home harness contract.
  const user = readReleasedScope(
    "/conversation",
    {
      read: (path) =>
        path.endsWith("harness.json") ? JSON.stringify(harness) : undefined,
    },
    "user",
    context,
  );
  assert.equal(user.issues.length, 1);
  assert.match(user.issues[0].reason, /version/);
});

for (const bytes of [
  "broken JSON",
  '{"compaction":"invalid"}',
  '{"compaction":[]}',
  '{"compaction":{},"unexpected":true}',
]) {
  await test(`conversation harness still isolates genuinely malformed input: ${bytes}`, () => {
    const input = readReleasedScope(
      "/conversation",
      { read: (path) => (path.endsWith("harness.json") ? bytes : undefined) },
      "conversation",
      context,
    );
    assert.equal(input.issues.length, 1);
    assert.equal(input.issues[0].file, "harness");
    assert.equal(input.before.harness, undefined);
  });
}
