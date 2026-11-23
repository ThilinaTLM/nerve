import assert from "node:assert/strict";
import { test } from "node:test";
import { registry } from "./registry.js";
import { SAMPLES, launchesAgentSample } from "./method-samples.js";
import {
  createSdkEnvironment,
  findSdkMethod,
} from "@nervekit/tools/quick-script/testing";
import { isOperationCheck } from "@nervekit/tools/quick-script/testing";

/**
 * SDK calls are authorized as operations (`jira.issues.create`) with resource
 * targets; only `web.*`, `files.*` and `image.*` keep the direct tool whose
 * rules govern the same URL host or path. Built-in rule sets are covered in
 * `@nervekit/tools` (`operation-rules.test.ts`) and the broker tests.
 */

const env = createSdkEnvironment({
  registry,
  cwd: process.cwd(),
  conversationDir: "/tmp/quick-script",
  web: { enabled: true, search: true },
  launchesAgent: launchesAgentSample,
});

const checksOf = async (name: string, args: unknown[]) => {
  const prepared = await findSdkMethod(name, registry)!.prepare(args, env);
  return [
    ...(prepared.authorization ? [prepared.authorization] : []),
    ...(prepared.additionalAuthorizations ?? []),
  ];
};

void test("methods keep the direct-tool route only for web.fetch, files, image and launch starts; everything else is an operation", async () => {
  for (const [name, calls] of Object.entries(SAMPLES)) {
    const product = findSdkMethod(name, registry)!.product;
    for (const args of calls) {
      const [first] = await checksOf(name, args);
      if (!first) continue;
      assert.equal(
        !isOperationCheck(first),
        name === "web.fetch" ||
          // Checked as the bash command the launch runs.
          name === "launches.start" ||
          name === "launches.restart" ||
          ["files", "image"].includes(product),
        `${name} ${JSON.stringify(args)}`,
      );
    }
  }
});

void test("raw requests are operations: GET is external_read, anything else destructive", async () => {
  for (const product of ["jira", "confluence"]) {
    const name = `${product}.request`;
    const calls = SAMPLES[name] as unknown[][];
    assert.ok(
      calls.some((args) => args[0] !== "GET") &&
        calls.some((args) => args[0] === "GET"),
    );
    for (const args of calls) {
      const [check] = await checksOf(name, args);
      assert.ok(check && isOperationCheck(check));
      assert.equal(check.operation, name);
      assert.equal(
        check.risk,
        args[0] === "GET" ? "external_read" : "destructive",
      );
    }
  }
});

void test("search.web is an external read named after the method, without targets", async () => {
  const [check] = await checksOf("search.web", ["nerve"]);
  assert.ok(check && isOperationCheck(check));
  assert.equal(check.operation, "search.web");
  assert.equal(check.risk, "external_read");
  assert.deepEqual(check.targets, []);
});

void test("imagegen.generate is an external write without targets", async () => {
  const [check] = await checksOf("imagegen.generate", [
    { prompt: "a red square" },
  ]);
  assert.ok(check && isOperationCheck(check));
  assert.equal(check.operation, "imagegen.generate");
  assert.equal(check.risk, "external_write");
  assert.deepEqual(check.targets, []);
});
