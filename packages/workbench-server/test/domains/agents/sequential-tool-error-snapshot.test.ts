import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { agent, buildToolService } from "../tools/tool-service-test-fixture.js";

test("provider staging failures retain genuine originating actor/authority rather than the newly accepted actor", async () => {
  const home = await mkdtemp(
    join(tmpdir(), "nerve-sequential-error-snapshot-"),
  );
  const cwd = join(home, "original");
  await mkdir(cwd);
  const current = {
    ...agent("supervised"),
    projectDir: cwd,
    workspaceScope: { roots: [cwd] },
    permissionRuleSetId: "supervised",
    model: { provider: "nerve-faux", modelId: "faux-fast" },
    thinkingLevel: "off" as const,
    tools: ["write"],
    skills: [],
    instructions: "",
    systemPrompt: "Original composed prompt",
    configurationRevision: 3,
  };
  const fixture = buildToolService(home, current);
  try {
    const agentSnapshot = structuredClone(current);
    const permissionContext =
      await fixture.service.capturePermissionContext(agentSnapshot);
    const toolAuthority = await fixture.service.captureToolAuthority(
      agentSnapshot,
      permissionContext,
      { configurationProvenance: "resolved" },
    );
    Object.assign(current, {
      projectDir: home,
      mode: "planning",
      permissionLevel: "read_only",
      permissionRuleSetId: "read_only",
      model: { provider: "new-provider", modelId: "new-model" },
      configurationRevision: 4,
    });
    const failed = await fixture.service.recordProviderToolCallError(
      current,
      "write",
      { path: "invalid.txt" },
      "Invalid original provider arguments",
      {
        agentSnapshot,
        permissionContext,
        toolAuthority,
        providerToolCallId: "original_failed_call",
      },
    );
    assert.equal(failed.status, "failed");
    assert.equal(failed.cwd, cwd);
    assert.ok(failed.authoritySnapshot);
    const { cwd: pinnedCallCwd, ...savedAuthority } = failed.authoritySnapshot;
    assert.deepEqual(savedAuthority, toolAuthority);
    assert.deepEqual(pinnedCallCwd, { path: cwd, physicalPath: cwd });
    assert.equal(failed.authoritySnapshot?.configurationRevision, 3);
    assert.equal(
      failed.authoritySnapshot?.configuration?.model?.modelId,
      "faux-fast",
    );
  } finally {
    await fixture.journal.close();
    await rm(home, { recursive: true, force: true });
  }
});
