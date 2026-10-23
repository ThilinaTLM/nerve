import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { conversationChannelEventSchemas } from "@nervekit/contracts/core";
import { AgentConfigurationService } from "../../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import { subscribeConfigurationNotifications } from "./configuration-notifications.js";

void test("every configuration notification from profile and agent publication parses its strict public schema", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "nerve-notifications-"));
  const projectDirectory = path.join(home, "project");
  await mkdir(projectDirectory);
  const service = new AgentConfigurationService({
    home,
    projectDirectory: () => projectDirectory,
    conversationOwner: () => ({ projectId: "p", role: "lead" }),
    builtins: {},
    isProfileTrusted: () => true,
    captureResources: () => ({ options: {}, isCurrent: () => true }),
  });
  t.after(async () => {
    await service.flushSummaries();
    await rm(home, { recursive: true, force: true });
  });
  const notices: { type: string; data: unknown }[] = [];
  const stop = subscribeConfigurationNotifications(service, (type, data) => {
    notices.push({ type, data });
  });
  const profile = {
    schemaVersion: 1,
    name: "coding",
    description: "Coding",
    instructions: "Short",
    usableBy: "lead",
  };
  for (const scope of [
    { scope: "user" },
    { scope: "project", projectId: "p" },
  ] as const) {
    const saved = await service.profiles.save(
      scope,
      "coding",
      "missing",
      profile,
    );
    await service.profiles.reload(scope, "coding");
    await service.profiles.deleteLocal(scope, "coding", saved.digest);
    await service.ensureLoaded(scope);
    await service.save(scope, {
      expectedRevision: 0,
      expectedDigest: "missing",
      changes: { reasoningLevel: "off" },
      resets: [],
    });
  }
  assert.ok(notices.length >= 8);
  for (const notice of notices) {
    assert.ok(
      notice.type === "agentConfiguration.changed" ||
        notice.type === "conversationDefaults.changed",
    );
    const payload = conversationChannelEventSchemas[notice.type].parse(
      notice.data,
    );
    assert.ok(!("name" in payload.scope));
  }
  assert.ok(
    notices.some(
      (notice) => JSON.stringify(notice.data) === '{"scope":{"scope":"user"}}',
    ),
  );
  stop();
  const count = notices.length;
  await service.reload({ scope: "user" });
  assert.equal(notices.length, count);
});
