import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { agentConfigurationOperations } from "../../infrastructure/configuration/agent-configuration/scoped-configuration-operations.js";
import { projectPermissionsConfiguration } from "../project-permission-migrations.js";
import {
  productionAdmissionFixture,
  until,
} from "./production-admission-fixture.js";

for (const [filename, type] of [
  ["agent.json", "agent-settings"],
  ["capabilities.json", "capabilities"],
  ["integrations.json", "integrations"],
  ["conversation-defaults.json", "conversation-defaults"],
] as const) {
  void test(
    `corrupted ${filename}: creation, model/tool runs, subagent launch and settings use lower-precedence configuration`,
    { skip: process.platform === "win32" },
    async (t) => {
      const f = await productionAdmissionFixture(t, [
        { type: "assistantText", text: "FALLBACK_OK" },
      ]);
      const service = f.runtime.agentConfiguration;
      const scope = { scope: "project" as const, projectId: "proj_admission" };
      const file = join(f.project, ".nerve", "config", filename);
      const original = "{bad scoped settings";
      await mkdir(join(f.project, ".nerve", "config"), { recursive: true });
      await writeFile(file, original);
      await service.reload(scope);
      await service.reloadCreation(scope);
      assert.equal(
        (await service.projectDefaults.get({ projectId: scope.projectId }))
          .status,
        "available",
      );

      // Exercise the same host creation boundary used by conversation.create, not
      // only the defaults preview that already passed QA.
      await f.runtime.core.createConversation({
        id: "fallback",
        projectId: scope.projectId,
      });
      const effective = await service.getEffective("fallback");
      assert.equal(effective.status, "available");
      if (effective.status !== "available")
        assert.fail("Expected lower-precedence configuration");
      assert.equal(effective.resolution.settings.model?.modelId, "test");
      assert.equal(
        (
          await agentConfigurationOperations(service).get({
            scope: "conversation",
            conversationId: "fallback",
          })
        ).status,
        "available",
      );
      const inherited = await service.getInheritedSettings({
        scope: "conversation",
        conversationId: "fallback",
      });
      assert.equal(inherited.model?.modelId, "test");
      const conversation = {
        scope: "conversation" as const,
        conversationId: "fallback",
      };
      const state = await service.ensureLoaded(conversation);
      if (state.status === "unavailable")
        assert.fail("Expected writable conversation settings");
      const saved = await service.save(conversation, {
        expectedRevision: state.value.revision,
        expectedDigest: state.value.digest,
        changes: { reasoningLevel: "off" },
        resets: [],
      });
      const preview = await service.repairResolution(
        conversation,
        saved.value.document,
      );
      assert.equal(preview.settings.model?.modelId, "test");

      await f.runtime.core.start();
      await f.runtime.core.submitInput({
        conversationId: "fallback",
        inputId: "fallback-input",
        text: "Reply using the defaults.",
        source: "user",
      });
      await until(() =>
        f.runtime.storage.events
          .since("fallback", 0)
          .some(
            (event) =>
              event.type === "assistant_message" &&
              JSON.stringify(event.payload).includes("FALLBACK_OK"),
          ),
      );
      await f.command("echo fallback", "fallback");
      assert.equal(f.spawns.length, 1);

      // Ownership must not depend on the presence of an applicable project layer
      // in the parent's resolution sources.
      assert.ok(
        (await f.runtime.subagentHost.usableProfiles("c")).includes("worker"),
      );
      await f.createChild();
      assert.equal((await service.getEffective("child")).status, "available");
      assert.equal(await readFile(file, "utf8"), original);
      assert.ok(
        service.projectMigration
          .health(scope.projectId)
          .issues.some(
            (issue) =>
              issue.type === type &&
              issue.path === file &&
              issue.classification === "corrupted",
          ),
        "successful fallback must not clear the health notice",
      );
      if (filename === "agent.json") {
        assert.equal((await service.ensureLoaded(scope)).status, "unavailable");
        await assert.rejects(
          service.save(scope, {
            expectedRevision: 0,
            expectedDigest: "missing",
            changes: {},
            resets: [],
          }),
          /unavailable/,
        );
      } else {
        assert.notEqual(
          (await service.ensureLoaded(scope)).status,
          "unavailable",
          "independent corrupt resources must not poison the agent file",
        );
      }
    },
  );
}

void test(
  "invalid project permissions allow model-only replies but block tools, with matching health/reset wording",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await productionAdmissionFixture(t, [
      { type: "assistantText", text: "MODEL_ONLY_OK" },
    ]);
    const file = join(f.project, ".nerve", "config", "permissions.json");
    await mkdir(join(f.project, ".nerve", "config"), { recursive: true });
    await writeFile(file, "{bad overlay");
    const migrations = f.runtime.agentConfiguration.projectMigration;
    await migrations.load(
      { projectId: "proj_admission", directory: f.project },
      projectPermissionsConfiguration,
    );
    const issue = migrations
      .health("proj_admission")
      .issues.find((issue) => issue.type === "permission-overlay");
    assert.ok(issue);
    assert.match(issue.message, /Tool execution is blocked/);
    assert.match(issue.resetDescription, /blocking tool execution/);
    assert.match(issue.resetDescription, /Model-only replies remain available/);
    await f.runtime.core.createConversation({
      id: "model-only",
      projectId: "proj_admission",
    });
    await f.runtime.core.start();
    await f.runtime.core.submitInput({
      conversationId: "model-only",
      inputId: "model-input",
      text: "Reply without tools.",
      source: "user",
    });
    await until(() =>
      f.runtime.storage.events
        .since("model-only", 0)
        .some(
          (event) =>
            event.type === "assistant_message" &&
            JSON.stringify(event.payload).includes("MODEL_ONLY_OK"),
        ),
    );
    const call = await f.command("echo blocked", "model-only");
    if (call === "delivered" || !("toolName" in call))
      assert.fail("Expected tool call");
    assert.equal(
      f.runtime.storage.toolCalls.get(call.id)?.interaction?.kind,
      "configuration_blocked",
    );
    assert.equal(f.spawns.length, 0);
  },
);
