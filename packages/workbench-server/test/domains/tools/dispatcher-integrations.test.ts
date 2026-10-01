import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import type { CapabilitySelection } from "@nervekit/contracts/capabilities";
import { defaultSettings } from "@nervekit/contracts/settings";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import { OrchestrationToolDispatcher } from "../../../src/domains/tools/orchestration/dispatcher.js";
import { effectiveIntegrations } from "../../../src/domains/tools/execution/integration-profile-resolution.js";
import { userCapabilitySelection } from "../../../src/domains/capabilities/user-capability-selection.js";

const root = await mkdtemp(join(tmpdir(), "nerve-dispatcher-integrations-"));
after(() => rm(root, { recursive: true, force: true }));
const originalFetch = globalThis.fetch;

// The user default leaves Jira disabled; only the conversation enables it.
const settings = {
  ...defaultSettings,
  providers: {
    atlassianProfiles: [
      {
        id: "pplied",
        name: "Pplied",
        siteUrl: "https://auto-apply.atlassian.net",
        email: "dev@example.com",
      },
    ],
    tavilyProfiles: [],
  },
  tools: { ...defaultSettings.tools, jira: { enabled: false } },
};
const conversationSelection: CapabilitySelection = {
  disabledTools: ["confluence"],
  toolProfiles: { jira: "pplied" },
  toolSettings: {
    ...userCapabilitySelection(defaultSettings).toolSettings,
    kroki_export: { url: "http://127.0.0.1:9080/conversation/" },
  },
  disabledFileSkills: [],
  enabledNerveSkills: [],
  enabledAgentBrowserSkills: [],
};

function dispatcher(outcomes: unknown[]) {
  const resolved: string[] = [];
  const imageSettings: unknown[] = [];
  const instance = new OrchestrationToolDispatcher({
    storage: { paths: { home: root }, settings },
    events: { publish: async () => undefined },
    conversationRuntime: {
      toolOutputOffset: () => 0,
      applyToolOutputDelta: (data: unknown) => data,
    },
    getApiKey: async (provider: string) =>
      provider === "atlassian:pplied" ? "token" : undefined,
    resolveToolScope: async (projectId: string, conversationId: string) => {
      resolved.push(`${projectId}/${conversationId}`);
      return {
        integrations: effectiveIntegrations(settings, conversationSelection),
        toolSettings: conversationSelection.toolSettings,
      };
    },
    explainImage: async (_request: unknown, toolSettings: unknown) => {
      imageSettings.push(toolSettings);
      return { explanation: "ok", model: { provider: "p", modelId: "m" } };
    },
    recordIntegrationOutcome: async (input: unknown) => {
      outcomes.push(input);
    },
  } as never);
  return { instance, resolved, imageSettings };
}

function toolCall(toolName: string): ToolCallRecord {
  return {
    id: `tool_${toolName}`,
    agentId: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    toolName,
    risk: "read",
    args: {},
    cwd: root,
    status: "running",
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
  } as ToolCallRecord;
}

describe("dispatcher integration resolution", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses the conversation's integration settings for execution", async () => {
    const { instance, resolved } = dispatcher([]);
    const context = instance.executionContext(toolCall("jira_get_issue"));
    assert.deepEqual(await context.getProviderConfig?.("jira"), {
      enabled: true,
      siteUrl: "https://auto-apply.atlassian.net",
      email: "dev@example.com",
      defaultProjectKey: undefined,
    });
    assert.equal(await context.getApiKey?.("jira"), "token");
    assert.equal(
      (
        (await context.getProviderConfig?.("confluence")) as {
          enabled: boolean;
        }
      ).enabled,
      false,
    );
    assert.deepEqual(resolved, ["proj_test/conv_test"]);
  });

  it("passes the conversation's tool settings to image explanation", async () => {
    const { instance, imageSettings } = dispatcher([]);
    const context = instance.executionContext(toolCall("explain_image"));
    await context.explainImage?.({
      data: new Uint8Array(),
      mimeType: "image/png",
      prompt: "describe",
    } as never);
    assert.deepEqual(imageSettings, [
      conversationSelection.toolSettings.explain_image,
    ]);
  });

  it("renders Kroki diagrams with the conversation's server", async () => {
    const { instance } = dispatcher([]);
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
      requested.push(String(input));
      return new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
        headers: { "content-type": "image/svg+xml" },
      });
    };
    await instance
      .execute(toolCall("kroki_export"), {
        diagram_type: "mermaid",
        source: "graph TD; A-->B",
      })
      .catch(() => undefined);
    assert.ok(
      requested[0]?.startsWith("http://127.0.0.1:9080/conversation/"),
      requested[0],
    );
  });

  it("reports Jira outcomes with the profile that was used", async () => {
    const outcomes: Array<{ errorCode?: string; profile: { id: string } }> = [];
    const { instance } = dispatcher(outcomes);
    globalThis.fetch = async () => new Response("{}", { status: 401 });
    await assert.rejects(
      instance.execute(toolCall("jira_get_issue"), { issue_key: "NER-1" }),
    );
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0]?.errorCode, "JIRA_UNAUTHORIZED");
    assert.equal(outcomes[0]?.profile.id, "pplied");
    assert.equal(outcomes[0]?.token, "token");

    globalThis.fetch = async () =>
      Response.json({ key: "NER-1", fields: { summary: "Ok" } });
    await instance.execute(toolCall("jira_get_issue"), { issue_key: "NER-1" });
    assert.equal(outcomes.length, 2);
    assert.equal(outcomes[1]?.errorCode, undefined);
  });
});
