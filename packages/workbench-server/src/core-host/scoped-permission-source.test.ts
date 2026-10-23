import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CoreStorage } from "@nervekit/conversation-core";
import type { AgentConfigurationService } from "../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import { createScopedPermissionSource } from "./scoped-permission-source.js";
import { createExecutionAdmission } from "./execution-admission/admission.js";

void test("admission reads live selection, blocks invalid policy, and reloads only after explicit publication", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-policy-source-"));
  await mkdir(join(home, "config"));
  let generation = 1;
  let selection = "autonomous";
  const storage = {
    conversations: {
      get: (id: string) => ({ id, projectId: "p", parentConversationId: null }),
    },
    projects: { get: () => ({ id: "p", directory: home }) },
    trustedResources: { find: () => undefined },
  } as unknown as CoreStorage;
  const agents = {
    async captureEffective() {
      const captured = generation;
      return {
        view: {
          status: "available",
          resolution: { settings: { permissionRuleSetId: selection } },
          sources: [{ path: "agent.json", generation: captured }],
        },
        isCurrent: () => captured === generation,
      };
    },
  } as unknown as AgentConfigurationService;
  const source = createScopedPermissionSource({
    home,
    storage,
    agents,
    trustGeneration: () => 0,
    requestGenerations: () => ({ advertised: 3 }),
  });
  const prepare = createExecutionAdmission(source);
  const input = {
    toolCallId: "call",
    conversationId: "c",
    projectDir: home,
    toolName: "write",
    origin: "model" as const,
    args: { path: "file.txt", content: "hello" },
    cwd: home,
    target: {},
    requestCaptureId: "capture",
  };
  try {
    const first = await prepare(input);
    const allowed = first.check();
    assert.equal(allowed.kind, "policy");
    if (allowed.kind !== "policy") return;
    assert.equal(allowed.supervision.decision, "allow");
    const previousFind = storage.trustedResources.find;
    storage.trustedResources.find = () => {
      throw new Error("Final checks must not query storage");
    };
    assert.equal(first.check().kind, "policy");
    storage.trustedResources.find = previousFind;
    await source.validateChildPermission("read_only");
    await assert.rejects(
      source.validateChildPermission("supervised"),
      /not sub-agent safe/,
    );
    selection = "read_only";
    generation++;
    assert.equal(first.check().kind, "stale");
    const next = await prepare(input);
    const denied = next.check();
    assert.equal(denied.kind, "policy");
    if (denied.kind !== "policy") return;
    assert.equal(denied.supervision.decision, "deny");
    assert.notEqual(
      allowed.evidence.binding.policyAuthorityDigest,
      denied.evidence.binding.policyAuthorityDigest,
    );
    assert.deepEqual(denied.evidence.requestGenerations, { advertised: 3 });
    const path = join(home, "config", "permissions.json");
    await writeFile(path, "broken");
    assert.equal(
      (await prepare(input)).check().kind,
      "policy",
      "external files are not polled",
    );
    source.invalidate();
    assert.equal(
      (await prepare({ ...input, conversationId: "fresh" })).check().kind,
      "policy",
      "a new policy derivation must reuse the published user document",
    );
    assert.equal((await prepare(input)).check().kind, "policy");
    await source.reload([path]);
    assert.equal(next.check().kind, "stale");
    const blocked = (await prepare(input)).check();
    assert.equal(blocked.kind, "blocked");
    if (blocked.kind === "blocked")
      assert.equal(blocked.request.diagnostics[0].path, path);
    await writeFile(path, JSON.stringify({ schemaVersion: 2, overlays: [] }));
    assert.equal((await prepare(input)).check().kind, "blocked");
    await source.reload([path]);
    assert.equal((await prepare(input)).check().kind, "policy");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
