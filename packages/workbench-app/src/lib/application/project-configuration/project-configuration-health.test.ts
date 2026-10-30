import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectConfigurationIssue } from "@nervekit/contracts/projects";
import {
  failingSignature,
  failingToastTitle,
  withHealth,
} from "./project-configuration-health";

const issue = (
  projectId: string,
  classification: ProjectConfigurationIssue["classification"],
  type = "launch-definitions",
): ProjectConfigurationIssue => ({
  projectId,
  type,
  label: "Launch definitions",
  resetDescription: "reset",
  path: "/p/.nerve/launches/definitions.json",
  classification,
  message: "x",
  resetOffered: classification === "corrupted",
});

test("signature ignores migrated notices and ordering, and changes with the failing set", () => {
  const a = { p1: [issue("p1", "corrupted")], p2: [issue("p2", "migrated")] };
  assert.equal(
    failingSignature(a),
    failingSignature({ p1: [issue("p1", "corrupted")] }),
  );
  assert.equal(failingSignature({ p2: [issue("p2", "migrated")] }), "");
  assert.notEqual(
    failingSignature(a),
    failingSignature({ p1: [issue("p1", "incompatible")] }),
  );
  assert.equal(
    failingToastTitle(a),
    "Project configuration needs attention · 1 file",
  );
});

test("event health replaces a project's issues and removes it when healthy", () => {
  const first = withHealth(
    {},
    { projectId: "p1", issues: [issue("p1", "corrupted")] },
  );
  assert.equal(first.p1?.length, 1);
  assert.deepEqual(withHealth(first, { projectId: "p1", issues: [] }), {});
});

test("an aggregate legacy issue counts files and changes its signature when the file set changes", () => {
  const legacy = {
    ...issue("p", "legacy", "legacy-files"),
    files: ["/p/.nerve/harness.json", "/p/.nerve/subagents/old.md"],
  };
  assert.equal(
    failingToastTitle({ p: [legacy] }),
    "Project configuration needs attention · 2 files",
  );
  assert.equal(
    failingSignature({ p: [legacy] }),
    failingSignature({
      p: [{ ...legacy, files: [...legacy.files].reverse() }],
    }),
  );
  assert.notEqual(
    failingSignature({ p: [legacy] }),
    failingSignature({ p: [{ ...legacy, files: legacy.files.slice(0, 1) }] }),
  );
});
