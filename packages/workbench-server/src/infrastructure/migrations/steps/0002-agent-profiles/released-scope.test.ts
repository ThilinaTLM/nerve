import assert from "node:assert/strict";
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
import { convertPreferencesV037 } from "./released-format.js";
const context = {
  builtins: releasedBuiltins,
  skillSources: {},
  report: () => {},
};
for (const scope of ["user", "project"] as const) {
  await test(`D12 ${scope} source inspection isolates malformed/unsupported files without changing bytes or other scopes`, () => {
    const files = new Map([
        ["/bad/config/harness.json", "{bad JSON\n"],
        ["/bad/config/capabilities.json", '{"schemaVersion":3}'],
        [
          "/good/config/capabilities.json",
          '{"schemaVersion":2,"tools":{"jira":{"enabled":true}}}',
        ],
        ["/bad/config/integrations.json", '{"version":2,"profiles":{}}'],
      ]),
      before = new Map(files),
      io = { read: (path: string) => files.get(path) };
    const bad = readReleasedScope("/bad", io, scope, context);
    assert.equal(bad.issues.length, 2);
    assert.deepEqual(
      bad.issues.map((issue) => issue.path),
      ["/bad/config/harness.json", "/bad/config/capabilities.json"],
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
  assert.equal(input.issues[0].path, "/project/config/subagents.json");
  assert.match(input.issues[0].reason, /skill source identity/);
});

await test("D12 existing canonical targets isolate the scoped export without overwriting either file", () => {
  const source = '{"schemaVersion":2,"tools":{"jira":{"enabled":true}}}';
  const files = new Map([
    ["/project/config/capabilities.json", source],
    ["/project/config/agent.json", "existing bytes"],
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
  assert.equal(input.issues[0].path, "/project/config/capabilities.json");
  assert.match(input.issues[0].reason, /Existing conversion target/);
  assert.equal(files.get("/project/config/capabilities.json"), source);
  assert.equal(files.get("/project/config/agent.json"), "existing bytes");
});
