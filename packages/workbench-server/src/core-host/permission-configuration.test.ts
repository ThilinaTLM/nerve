import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CoreStorage } from "@nervekit/conversation-core";
import type { PermissionRule } from "@nervekit/contracts/permissions";
import { createPermissionConfigurationService } from "./permission-configuration.js";

type Trust = {
  id: string;
  path: string;
  contentDigest: string;
  status: "trusted" | "rejected";
  updatedAt: string;
};

function rule(id: string, overrides: Partial<PermissionRule> = {}) {
  return {
    id,
    description: id,
    enabled: true,
    priority: 10,
    enforcement: "overridable",
    when: { toolNames: ["bash"] },
    decision: "prompt",
    ...overrides,
  } as PermissionRule;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "nerve-permission-config-"));
  const home = join(root, "home");
  const project = join(root, "project");
  await mkdir(join(home, "config"), { recursive: true });
  await mkdir(join(project, ".nerve", "config"), { recursive: true });
  const records: Trust[] = [];
  const storage = {
    trustedResources: {
      find: (_kind: string, _projectId: string, path: string) =>
        records.find((record) => record.path === path),
      insert: (record: Trust) => records.push(record),
      update: (id: string, patch: Partial<Trust>) =>
        Object.assign(records.find((record) => record.id === id)!, patch),
    },
  } as unknown as CoreStorage;
  const service = createPermissionConfigurationService({
    home,
    storage,
    projectDirectory: (id) => (id === "project" ? project : undefined),
  });
  return {
    service,
    records,
    userFile: join(home, "config", "permissions.json"),
    projectFile: join(project, ".nerve", "config", "permissions.json"),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

const overlay = (...rules: PermissionRule[]) =>
  JSON.stringify({
    schemaVersion: 2,
    overlays: [{ ruleSetId: "supervised", rules }],
  });

void test("reports missing files, built-in rule sets, and an unknown project", async () => {
  const f = await fixture();
  try {
    const configuration = await f.service.get("project");
    assert.ok(configuration.ruleSets.some((set) => set.id === "supervised"));
    assert.deepEqual(configuration.userOverlays.overlays, []);
    assert.equal(configuration.projectTrust.status, "missing");
    await assert.rejects(f.service.get("unknown"), /Project not found/);
  } finally {
    await f.cleanup();
  }
});

void test("project rules remain visible but untrusted until their exact bytes are trusted", async () => {
  const f = await fixture();
  try {
    await writeFile(f.projectFile, overlay(rule("allow-tests")));
    let configuration = await f.service.get("project");
    assert.equal(configuration.projectTrust.status, "untrusted");
    assert.equal(configuration.projectOverlays.overlays[0]?.rules.length, 1);

    configuration = await f.service.grantProjectTrust("project");
    assert.equal(configuration.projectTrust.status, "trusted");

    await writeFile(
      f.projectFile,
      overlay(rule("allow-tests", { priority: 11 })),
    );
    configuration = await f.service.get("project");
    assert.equal(configuration.projectTrust.status, "untrusted");
    assert.match(configuration.projectTrust.reason ?? "", /changed/);
  } finally {
    await f.cleanup();
  }
});

void test("invalid files produce diagnostics and are never overwritten", async () => {
  const f = await fixture();
  try {
    await writeFile(f.userFile, "{ nope");
    await writeFile(
      f.projectFile,
      overlay(rule("g", { enforcement: "guardrail" })),
    );
    const configuration = await f.service.get("project");
    assert.equal(configuration.projectTrust.status, "invalid");
    assert.equal(configuration.diagnostics.length, 2);
    await assert.rejects(
      f.service.saveRule({
        scope: "user",
        ruleSetId: "supervised",
        rule: rule("a"),
      }),
    );
    assert.equal(await readFile(f.userFile, "utf8"), "{ nope");
    await assert.rejects(f.service.grantProjectTrust("project"), /no valid/);
  } finally {
    await f.cleanup();
  }
});

void test("saves, edits, and deletes single user rules while preserving the others", async () => {
  const f = await fixture();
  try {
    // Startup initializes this document; a missing/invalid home file needs explicit resolution.
    await writeFile(f.userFile, overlay());
    await f.service.saveRule({
      scope: "user",
      ruleSetId: "supervised",
      rule: rule("a"),
    });
    await f.service.saveRule({
      scope: "user",
      ruleSetId: "supervised",
      rule: rule("b", { priority: 20 }),
    });
    await assert.rejects(
      f.service.saveRule({
        scope: "user",
        ruleSetId: "supervised",
        rule: rule("a", { priority: 30 }),
      }),
      /already exists/,
    );
    await assert.rejects(
      f.service.saveRule({
        scope: "user",
        ruleSetId: "supervised",
        rule: rule("c", { priority: 20 }),
      }),
      /unique/i,
    );
    let configuration = await f.service.saveRule({
      scope: "user",
      ruleSetId: "supervised",
      previousRuleId: "a",
      rule: rule("renamed", { decision: "deny" }),
    });
    assert.deepEqual(
      configuration.userOverlays.overlays[0]?.rules.map((r) => r.id),
      ["renamed", "b"],
    );
    await assert.rejects(
      f.service.deleteRule({
        scope: "user",
        ruleSetId: "supervised",
        ruleId: "gone",
      }),
      /no longer exists/,
    );
    await f.service.deleteRule({
      scope: "user",
      ruleSetId: "supervised",
      ruleId: "renamed",
    });
    configuration = await f.service.deleteRule({
      scope: "user",
      ruleSetId: "supervised",
      ruleId: "b",
    });
    assert.deepEqual(configuration.userOverlays.overlays, []);
    await assert.rejects(
      f.service.saveRule({
        scope: "user",
        ruleSetId: "missing-set",
        rule: rule("a"),
      }),
      /Unknown permission rule set/,
    );
  } finally {
    await f.cleanup();
  }
});

void test("project edits enforce project restrictions, trust state, and re-trust their own write", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.service.saveRule({
        scope: "project",
        projectId: "project",
        ruleSetId: "supervised",
        rule: rule("g", { enforcement: "guardrail" }),
      }),
    );
    let configuration = await f.service.saveRule({
      scope: "project",
      projectId: "project",
      ruleSetId: "supervised",
      rule: rule("a"),
    });
    assert.equal(configuration.projectTrust.status, "trusted");
    assert.equal(f.records.length, 1);

    await writeFile(
      f.projectFile,
      overlay(rule("a"), rule("external", { priority: 50 })),
    );
    await assert.rejects(
      f.service.saveRule({
        scope: "project",
        projectId: "project",
        ruleSetId: "supervised",
        previousRuleId: "a",
        rule: rule("a", { priority: 11 }),
      }),
      /not trusted/,
    );
    await assert.rejects(
      f.service.saveRule({
        scope: "project",
        ruleSetId: "supervised",
        rule: rule("z"),
      }),
      /project is required/,
    );

    await f.service.grantProjectTrust("project");
    configuration = await f.service.deleteRule({
      scope: "project",
      projectId: "project",
      ruleSetId: "supervised",
      ruleId: "external",
    });
    assert.equal(configuration.projectTrust.status, "trusted");
    assert.deepEqual(
      configuration.projectOverlays.overlays[0]?.rules.map((r) => r.id),
      ["a"],
    );
  } finally {
    await f.cleanup();
  }
});
