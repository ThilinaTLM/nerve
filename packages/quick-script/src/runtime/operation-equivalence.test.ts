import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { toolNameSchema } from "@nervekit/contracts/tools";
import {
  builtInPermissionRuleSets,
  composeEffectivePermissionPolicy,
  evaluatePermissionRequest,
  normalizeOperationRequest,
  normalizePermissionRequest,
} from "@nervekit/tools/policy";
import legacy from "./legacy-authorization.fixture.json" with { type: "json" };
import { SAMPLES } from "./method-samples.js";
import { createSdkEnvironment, findSdkMethod } from "./sdk.js";
import { isOperationCheck } from "./sdk-types.js";

/**
 * Step 4 of the extensions proposal: SDK calls are checked as operations
 * (`jira.issues.create`) instead of as the equivalent direct tool. For every
 * built-in rule set and every SDK method with representative arguments, the
 * decision through the old identity (recorded in the fixture) must equal the
 * decision through the operation. The old path and this file go away with the
 * direct Jira/Confluence/diagram tools in step 5.
 *
 * `legacy-authorization.fixture.json` holds, per method and sample call, the
 * checks the pre-operation code produced: `{ toolName, args, approvalRequired? }`.
 *
 * Intentional differences, none of which changes a built-in rule set's decision:
 *
 * - Raw requests (`jira.request`, `confluence.request`): the old check borrowed
 *   a manage tool (`jira_manage_comment` / `confluence_manage_page`) and set
 *   `approvalRequired`, so an allow rule never admitted it. Now a non-GET raw
 *   request is the destructive operation `*.request` with a
 *   `<system>:request/<METHOD> <path>` target; a rule matching method and path
 *   admits it, otherwise it prompts as destructive (broker tests cover this).
 * - `jira.issues.delete` had the same `approvalRequired` special case; it is
 *   now the destructive operation `jira.issues.delete`.
 * - Calls that used to run several checks for one effect (attaching files while
 *   creating an issue or page, a comment inside a transition, moving open
 *   issues while closing a sprint, labels one by one, a purge's extra trash
 *   check, the Atlassian defaults' two product reads) are one check on the
 *   operation. The built-in comparison therefore uses the strictest decision
 *   over a call's checks. File reads stay separate direct `read` checks.
 * - External writes carry base risk `unknown` (effective risk `command`) where
 *   the direct tools used `write` or `destructive`; no built-in rule matches
 *   those categories for these tools, and `write` is never used for them.
 */

const roots = {
  project: process.cwd(),
  nerve_home: join(process.cwd(), ".nerve-home"),
  nerve_data: join(process.cwd(), ".nerve-home", "data"),
  plans: join(process.cwd(), ".nerve-home", "data", "plans"),
};
const base = { conversationId: "conv_1", projectId: "proj_1" };

const env = createSdkEnvironment({
  cwd: process.cwd(),
  conversationDir: "/tmp/quick-script",
  web: { enabled: true, search: true },
});

type Legacy = {
  toolName: string;
  args: Record<string, unknown>;
  approvalRequired?: boolean;
};
const fixture = legacy as unknown as Record<string, Legacy[][]>;

const STRICTNESS = { allow: 0, prompt: 1, deny: 2 } as const;

function strictest(decisions: readonly (keyof typeof STRICTNESS)[]) {
  return decisions.reduce<keyof typeof STRICTNESS>(
    (worst, next) => (STRICTNESS[next] > STRICTNESS[worst] ? next : worst),
    "allow",
  );
}

void test("the fixture covers every sample call", () => {
  assert.deepEqual(Object.keys(fixture).sort(), Object.keys(SAMPLES).sort());
  for (const [name, calls] of Object.entries(SAMPLES))
    assert.equal(fixture[name]!.length, calls.length, name);
});

void test("every built-in rule set decides each SDK call the same through the old tool identity and the operation", () => {
  let compared = 0;
  for (const ruleSet of builtInPermissionRuleSets) {
    for (const subagent of [false, true]) {
      const policy = composeEffectivePermissionPolicy({
        selectedRuleSet: ruleSet,
        subagent,
      });
      const decide = (
        request: Parameters<typeof evaluatePermissionRequest>[0]["request"],
      ) => evaluatePermissionRequest({ policy, request }).decision;
      for (const [name, calls] of Object.entries(SAMPLES)) {
        const method = findSdkMethod(name)!;
        calls.forEach((args, index) => {
          const before = fixture[name]![index]!.map((check) =>
            decide(
              normalizePermissionRequest({
                ...base,
                toolName: toolNameSchema.parse(check.toolName),
                args: check.args,
                roots,
              }),
            ),
          );
          const prepared = method.prepare(args, env);
          const after = [
            ...(prepared.authorization ? [prepared.authorization] : []),
            ...(prepared.additionalAuthorizations ?? []),
          ].map((check) =>
            decide(
              isOperationCheck(check)
                ? normalizeOperationRequest({
                    ...base,
                    operation: check.operation,
                    targets: check.targets.map((target) => target.value),
                    risk: check.risk,
                  })
                : normalizePermissionRequest({
                    ...base,
                    toolName: toolNameSchema.parse(check.toolName),
                    args: check.args,
                    roots,
                  }),
            ),
          );
          assert.equal(
            strictest(after),
            strictest(before),
            `${ruleSet.id}${subagent ? " (subagent)" : ""}: ${name} ${JSON.stringify(args)}`,
          );
          compared += 1;
        });
      }
    }
  }
  assert.ok(compared > 500, `compared ${compared} decisions`);
});

void test("methods keep the direct-tool route only for web and files; everything else is an operation", () => {
  for (const [name, calls] of Object.entries(SAMPLES)) {
    const method = findSdkMethod(name)!;
    for (const args of calls) {
      const prepared = method.prepare(args, env);
      const checks = [
        ...(prepared.authorization ? [prepared.authorization] : []),
        ...(prepared.additionalAuthorizations ?? []),
      ];
      const first = checks[0];
      if (!first) continue;
      const direct = !isOperationCheck(first);
      assert.equal(
        direct,
        ["web", "files", "image"].includes(method.product),
        `${name} ${JSON.stringify(args)}`,
      );
    }
  }
});

void test("raw requests: the old check carried approvalRequired; the operation is destructive for non-GET", () => {
  for (const product of ["jira", "confluence"]) {
    const name = `${product}.request`;
    assert.ok(
      (SAMPLES[name] as unknown[][]).some((args) => args[0] !== "GET") &&
        (SAMPLES[name] as unknown[][]).some((args) => args[0] === "GET"),
    );
    for (const [args, check] of (SAMPLES[name] as unknown[][]).map(
      (args, index) => [args, fixture[name]![index]![0]!] as const,
    )) {
      const now = findSdkMethod(name)!.prepare(args, env).authorization!;
      assert.ok(isOperationCheck(now));
      assert.equal(now.risk, args[0] === "GET" ? "network" : "destructive");
      assert.equal(check.approvalRequired === true, args[0] !== "GET");
    }
  }
});
