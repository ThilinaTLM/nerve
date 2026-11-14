import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTENSION_NAMING_EXCEPTIONS,
  extensionNamingViolations,
} from "../extension-naming-policy.ts";

test("code outside an extension's folder may not name it", () => {
  const violations = extensionNamingViolations(
    "packages/tools/src/quick-script/example.ts",
    'const risky = new Set(["jira.request"]);',
  );
  assert.equal(violations.length, 1);
});

test("comments, tests, the extension's folder, the registry list and frozen steps are exempt", () => {
  const code = "const x = new Set(['jira.request']);";
  for (const file of [
    "packages/extensions/src/atlassian/jira/methods.ts",
    "packages/extensions/src/index.ts",
    "packages/tools/src/example.test.ts",
    "packages/workbench-server/src/infrastructure/migrations/steps/0005-x/step.ts",
    "packages/workbench-server/src/infrastructure/configuration/frozen/old.ts",
  ])
    assert.deepEqual(extensionNamingViolations(file, code), [], file);
  assert.deepEqual(
    extensionNamingViolations(
      "packages/tools/src/example.ts",
      "/** `jira.issues.get` */\n// confluence\n * tavily",
    ),
    [],
  );
});

test("generic image generation names are not extension names", () => {
  assert.deepEqual(
    extensionNamingViolations(
      "packages/tools/src/example.ts",
      "type ImageGenerateRequest = ImageGenerationService;",
    ),
    [],
  );
});

test("every reviewed leftover has a reason", () => {
  for (const reason of EXTENSION_NAMING_EXCEPTIONS.values())
    assert.ok(reason.length > 5);
});
