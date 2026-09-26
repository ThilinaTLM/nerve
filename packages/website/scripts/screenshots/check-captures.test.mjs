import assert from "node:assert/strict";
import { test } from "node:test";
import { findViolations, isAllowedProjectName } from "./check-captures.mjs";

test("accepts a clean demo capture snapshot", () => {
  const text = [
    "aurora",
    "Add rate limiting to the booking API",
    "src/middleware/rate-limit.ts",
    "POST /bookings",
    "/tmp/nerve-demo-workspace/aurora/aurora-api",
    "demo@aurora.example",
  ].join("\n");
  assert.deepEqual(findViolations(text), []);
});

test("rejects credentials", () => {
  for (const token of [
    "sk-ant-api03-abcdefgh",
    "nt_9f2c1ab77cde",
    "ghp_abcdefghijkl",
  ]) {
    const violations = findViolations(`token ${token} shown`);
    assert.equal(violations.length, 1, token);
    assert.match(violations[0], /^credential:/);
  }
});

test("rejects a real email address but allows the seeded demo author", () => {
  assert.match(
    findViolations("contact someone@example.com")[0] ?? "",
    /^email:/,
  );
  assert.deepEqual(findViolations("author demo@aurora.example"), []);
});

test("rejects private network addresses", () => {
  for (const address of ["192.168.1.24", "10.0.0.7", "172.20.4.9"]) {
    assert.match(findViolations(`host ${address}`)[0] ?? "", /^private-ip:/);
  }
});

test("rejects real home directory paths", () => {
  assert.match(
    findViolations("/home/alice/Projects/secret")[0] ?? "",
    /^home-path:/,
  );
  assert.match(
    findViolations("/Users/alice/Projects/secret")[0] ?? "",
    /^home-path:/,
  );
});

test("rejects absolute paths outside the throwaway capture directories", () => {
  const violations = findViolations("opened /srv/company/internal/app");
  assert.equal(violations.length, 1);
  assert.match(violations[0], /^path:/);
});

test("allows only the synthetic demo project and repository names", () => {
  for (const name of [
    "Aurora",
    "aurora-api",
    "Northstar Journal",
    "northstar-journal",
    "Relayboard",
    "relayboard-cli",
    "nerve",
  ]) {
    assert.ok(isAllowedProjectName(name), name);
  }
  assert.ok(!isAllowedProjectName("acme-internal"));
});
