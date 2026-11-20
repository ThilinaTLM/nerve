import assert from "node:assert/strict";
import test from "node:test";
import { productionAdmissionFixture } from "../permissions/execution-admission/production-admission-fixture.js";
import { createConversationView } from "./conversation-view.js";

void test(
  "describe, tools and explain report this conversation's rule set, tool names and decisions",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await productionAdmissionFixture(t);
    await f.save({ permissionRuleSetId: "read_only" });
    const view = createConversationView({
      agentConfiguration: f.runtime.agentConfiguration,
      policy: f.runtime.admissionPolicy,
      home: f.home,
      conversationId: "c",
      projectDirectory: f.project,
      cwd: f.project,
      availableModels: () => [{ provider: "openai", modelId: "gpt" }],
    });

    const described = await view.describe();
    assert.equal(described.ruleSet?.id, "read_only");
    assert.equal(described.projectDirectory, f.project);
    assert.deepEqual(described.availableModels, [
      { provider: "openai", modelId: "gpt" },
    ]);

    const { tools } = await view.tools();
    const bash = tools.find((tool) => tool.name === "bash");
    assert.deepEqual(bash?.groups, ["shell"]);
    assert.deepEqual(bash?.primaryArguments, ["command"]);

    const write = await view.explain({
      tool: "write",
      args: { path: "a.txt", content: "x" },
    });
    assert.equal(write.decision, "deny");
    assert.equal((write as { ruleSetId?: string }).ruleSetId, "read_only");
    assert.equal(
      (await view.explain({ tool: "read", args: { path: "a.txt" } })).decision,
      "allow",
    );
    await assert.rejects(
      view.explain({ tool: "Bash", args: { command: "ls" } }),
      /case-sensitive\. Use "bash"/,
    );
  },
);
