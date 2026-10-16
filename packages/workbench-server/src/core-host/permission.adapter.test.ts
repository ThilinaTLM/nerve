import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CoreStorage } from "@nervekit/conversation-core";
import { createPermissionPort } from "./permission.adapter.js";
import { mutatePermissionOverlay } from "./permission-overlays.js";

void test("invalid user permissions use defaults for evaluation but reject writes", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-invalid-permissions-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, "config"));
  const path = join(home, "config", "permissions.json");
  await writeFile(path, "broken");
  const storage = {
    conversations: { get: () => ({ projectId: "project" }) },
    trustedResources: { find: () => undefined },
  } as unknown as CoreStorage;
  const port = createPermissionPort(home, storage);
  const result = await port.evaluate({
    conversationId: "conversation",
    projectDir: home,
    cwd: home,
    ruleSetId: "supervised",
    toolName: "bash",
    args: { command: "pwd" },
    origin: "user",
  });
  assert.equal(result.decision, "approval");
  await assert.rejects(
    mutatePermissionOverlay("user", path, () => undefined),
    /Reset to defaults.*Reload/,
  );
  assert.equal(await readFile(path, "utf8"), "broken");
});

void test("user-origin bash permission validation omits timeout while model calls require it", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-bash-permission-"));
  try {
    const storage = {
      conversations: { get: () => ({ projectId: "project" }) },
      trustedResources: { find: () => undefined },
    } as unknown as CoreStorage;
    const port = createPermissionPort(home, storage, async () => ({
      autoPromotion: { enabled: false, afterMs: 120000 },
      maxTimeoutMs: 2001,
    }));
    const input = {
      conversationId: "conversation",
      projectDir: home,
      cwd: home,
      ruleSetId: "supervised",
      toolName: "bash",
      args: { command: "pwd" },
    };
    const result = await port.evaluate({ ...input, origin: "user" });
    assert.equal(result.decision, "approval");
    await assert.rejects(
      port.evaluate({ ...input, origin: "model" }),
      /Invalid validated arguments/,
    );
    assert.equal(
      (
        await port.evaluate({
          ...input,
          origin: "model",
          args: { command: "pwd", timeout: 2 },
        })
      ).decision,
      "approval",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

void test("invalid harness or permissions override autonomous authorization until explicit resolution", async (t) => {
  const {
    initializeHomeConfiguration,
    readHomeConfiguration,
    reloadHomeConfigurationDocument,
    resetHomeConfigurationDocument,
  } = await import("../infrastructure/configuration/home-configuration.js");
  const { storagePaths } =
    await import("../infrastructure/storage-bootstrap/paths.js");
  for (const id of ["harness", "permissions"] as const) {
    const home = await mkdtemp(join(tmpdir(), "nerve-recovery-authorization-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    const paths = storagePaths(home);
    await initializeHomeConfiguration(paths);
    const file = join(paths.configPath, `${id}.json`);
    const original = await readFile(file, "utf8");
    const storage = {
      conversations: { get: () => ({ projectId: "project" }) },
      trustedResources: { find: () => undefined },
    } as unknown as CoreStorage;
    const port = createPermissionPort(home, storage);
    const input = {
      conversationId: "conversation",
      projectDir: home,
      cwd: home,
      ruleSetId: "autonomous",
      toolName: "bash",
      args: { command: "pwd" },
      origin: "user" as const,
    };
    assert.equal((await port.evaluate(input)).decision, "allow");
    const read = {
      ...input,
      ruleSetId: "supervised",
      toolName: "read",
      args: { path: "README.md" },
      origin: "model" as const,
    };
    assert.equal((await port.evaluate(read)).decision, "allow");
    await writeFile(file, '{ "restrictive-rules": [');
    await readHomeConfiguration(paths);
    const recovery = await port.evaluate(input);
    assert.equal(recovery.decision, "approval");
    assert.match(recovery.reason ?? "", /Explicit approval/);
    assert.deepEqual(recovery.suggestedRules, []);
    assert.equal((await port.evaluate(read)).decision, "approval");
    // Hand repair alone must not bypass the explicit Reload gate.
    await writeFile(file, original);
    assert.equal((await port.evaluate(input)).decision, "approval");
    await reloadHomeConfigurationDocument(paths, id);
    assert.equal((await port.evaluate(input)).decision, "allow");
    await writeFile(file, "broken again");
    await readHomeConfiguration(paths);
    await resetHomeConfigurationDocument(paths, id);
    assert.equal((await port.evaluate(input)).decision, "allow");
  }
});

void test("resolving only one damaged authorization document keeps recovery approval active", async (t) => {
  const {
    initializeHomeConfiguration,
    readHomeConfiguration,
    resetHomeConfigurationDocument,
  } = await import("../infrastructure/configuration/home-configuration.js");
  const { storagePaths } =
    await import("../infrastructure/storage-bootstrap/paths.js");
  const home = await mkdtemp(join(tmpdir(), "nerve-recovery-both-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = storagePaths(home);
  await initializeHomeConfiguration(paths);
  await writeFile(paths.harnessConfigPath, "broken harness");
  await writeFile(paths.permissionsConfigPath, "broken permissions");
  await readHomeConfiguration(paths);
  const port = createPermissionPort(home, {
    conversations: { get: () => ({ projectId: "project" }) },
    trustedResources: { find: () => undefined },
  } as unknown as CoreStorage);
  const input = {
    conversationId: "conversation",
    projectDir: home,
    cwd: home,
    ruleSetId: "autonomous",
    toolName: "bash",
    args: { command: "pwd" },
    origin: "user" as const,
  };
  await resetHomeConfigurationDocument(paths, "permissions");
  assert.equal((await port.evaluate(input)).decision, "approval");
  await resetHomeConfigurationDocument(paths, "harness");
  assert.equal((await port.evaluate(input)).decision, "allow");
});
