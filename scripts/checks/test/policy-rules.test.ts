import assert from "node:assert/strict";
import test from "node:test";
import { policyRules } from "../policy-rules.ts";
import type { PolicyRule, SourceInventory } from "../policy.ts";

/** In-memory inventory: only files and their text; rules that need the disk are skipped. */
function inventory(files: Record<string, string>): SourceInventory {
  return {
    repoRoot: "/nonexistent",
    files: Object.keys(files).sort(),
    read: (file) => files[file] ?? "",
  };
}

const rule = (id: string): PolicyRule => {
  const found = policyRules.find((candidate) => candidate.id === id);
  assert.ok(found, `rule ${id} is registered`);
  return found;
};

// One passing and one failing in-memory fixture per rule that works on text alone.
const cases: Record<
  string,
  {
    pass: Record<string, string>;
    fail: Record<string, string>;
    message: RegExp;
  }
> = {
  "contracts-source": {
    pass: { "packages/contracts/src/a.ts": 'import { x } from "./b.js";' },
    fail: {
      "packages/contracts/src/a.ts": 'import { x } from "./domain/index.js";',
    },
    message: /owning file/,
  },
  "server-test-runtime": {
    pass: { "packages/workbench-server/test/a.test.ts": "const runtime = 1;" },
    fail: {
      "packages/workbench-server/test/a.test.ts": "createTestServerRuntime();",
    },
    message: /RuntimeFixture/,
  },
  "source-naming": {
    pass: { "packages/tools/src/git/git-status.ts": "" },
    fail: { "packages/tools/src/git/helpers.ts": "" },
    message: /generic production source name/,
  },
  "ui-style": {
    pass: { "packages/ui-kit/src/Button.svelte": "<button></button>" },
    fail: {
      "packages/ui-kit/src/Button.svelte":
        "<button></button><style>@keyframes spin {}</style>",
    },
    message: /@keyframes/,
  },
  "workbench-layers": {
    pass: { "packages/workbench-app/src/lib/features/chat/a.ts": "" },
    fail: { "packages/workbench-app/src/lib/stores/a.ts": "" },
    message: /legacy workbench-app/,
  },
  "retired-surfaces": {
    pass: { "package.json": "{}" },
    fail: { "package.json": '{ "name": "class ' + 'TaskManager" }' },
    message: /retired identifier/,
  },
};

for (const [id, { pass, fail, message }] of Object.entries(cases)) {
  test(`${id}: accepts a conforming inventory and reports a violation`, () => {
    assert.deepEqual(rule(id).check(inventory(pass)), []);
    const violations = rule(id).check(inventory(fail));
    assert.ok(violations.length > 0);
    for (const violation of violations) {
      assert.equal(violation.rule, id);
      assert.match(violation.message, message);
    }
  });
}

test("registry ids are unique and every rule is described", () => {
  const ids = policyRules.map((candidate) => candidate.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const candidate of policyRules) assert.ok(candidate.description);
});
