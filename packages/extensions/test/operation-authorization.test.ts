import assert from "node:assert/strict";
import { test } from "node:test";
import "./install.js";
import { SAMPLES } from "./method-samples.js";
import {
  createSdkEnvironment,
  findSdkMethod,
} from "@nervekit/tools/quick-script/runtime/sdk";
import { isOperationCheck } from "@nervekit/tools/quick-script/runtime/sdk-types";

/**
 * SDK calls are authorized as operations (`jira.issues.create`) with resource
 * targets; only `web.*`, `files.*` and `image.*` keep the direct tool whose
 * rules govern the same URL host or path. Built-in rule sets are covered in
 * `@nervekit/tools` (`operation-rules.test.ts`) and the broker tests.
 */

const env = createSdkEnvironment({
  cwd: process.cwd(),
  conversationDir: "/tmp/quick-script",
  web: { enabled: true, search: true },
});

const checksOf = (name: string, args: unknown[]) => {
  const prepared = findSdkMethod(name)!.prepare(args, env);
  return [
    ...(prepared.authorization ? [prepared.authorization] : []),
    ...(prepared.additionalAuthorizations ?? []),
  ];
};

void test("methods keep the direct-tool route only for web.fetch, files and image; everything else is an operation", () => {
  for (const [name, calls] of Object.entries(SAMPLES)) {
    const product = findSdkMethod(name)!.product;
    for (const args of calls) {
      const [first] = checksOf(name, args);
      if (!first) continue;
      assert.equal(
        !isOperationCheck(first),
        name === "web.fetch" || ["files", "image"].includes(product),
        `${name} ${JSON.stringify(args)}`,
      );
    }
  }
});

void test("raw requests are operations: GET is network, anything else destructive", () => {
  for (const product of ["jira", "confluence"]) {
    const name = `${product}.request`;
    const calls = SAMPLES[name] as unknown[][];
    assert.ok(
      calls.some((args) => args[0] !== "GET") &&
        calls.some((args) => args[0] === "GET"),
    );
    for (const args of calls) {
      const [check] = checksOf(name, args);
      assert.ok(check && isOperationCheck(check));
      assert.equal(check.operation, name);
      assert.equal(check.risk, args[0] === "GET" ? "network" : "destructive");
    }
  }
});

void test("web.search is a network operation named after the method, without targets", () => {
  const [check] = checksOf("web.search", ["nerve"]);
  assert.ok(check && isOperationCheck(check));
  assert.equal(check.operation, "web.search");
  assert.equal(check.risk, "network");
  assert.deepEqual(check.targets, []);
});

void test("imagegen.generate is a network operation without targets", () => {
  const [check] = checksOf("imagegen.generate", [{ prompt: "a red square" }]);
  assert.ok(check && isOperationCheck(check));
  assert.equal(check.operation, "imagegen.generate");
  assert.equal(check.risk, "network");
  assert.deepEqual(check.targets, []);
});
