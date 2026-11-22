import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionResolution } from "@nervekit/contracts/extensions";
import { ExtensionUiService } from "../../../src/core-host/extensions/extension-ui/extension-ui-service.js";
import { ExtensionUiError } from "../../../src/core-host/extensions/extension-ui/extension-ui-error.js";

const page = { kind: "page" as const, id: "main" };

function setup(
  options: {
    capabilities?: string[];
    values?: Record<string, unknown>;
    profile?: { digest: string; leadUsable: boolean };
  } = {},
) {
  const created: unknown[] = [];
  const submitted: unknown[] = [];
  const settingTypes = {
    fast: "model",
    persona: "agentProfile",
    rules: "permissionRuleSet",
    name: "string",
  };
  const resolution = {
    extensions: {
      probe: {
        id: "probe",
        enabled: { value: true },
        fields: Object.fromEntries(
          Object.entries(options.values ?? {}).map(([key, value]) => [
            key,
            { value, visible: true },
          ]),
        ),
      },
    },
  } as unknown as ExtensionResolution;
  const service = new ExtensionUiService({
    catalog: {
      installedUi: async () => [
        {
          id: "probe",
          name: "Probe",
          source: "user",
          dist: "/dist",
          ui: {
            pages: [{ id: "main", label: "Main", icon: "x", newMenu: false }],
          },
          manifest: {
            permissions: {
              capabilities: options.capabilities ?? ["conversations.start"],
            },
            settings: {
              version: 1,
              fields: Object.fromEntries(
                Object.entries(settingTypes).map(([key, type]) => [
                  key,
                  { type },
                ]),
              ),
            },
          },
          themes: [],
        },
      ],
    } as never,
    extensions: { resolve: async () => resolution },
    accounts: {} as never,
    store: {} as never,
    errors: { record() {} },
    project: (id) => ({ id, name: "P", directory: "/p" }),
    conversations: {
      create: async (input) => void created.push(input),
      submit: (input) => void submitted.push(input),
      profile: async () => options.profile,
    },
  });
  const start = (params: Record<string, unknown>) =>
    service.bridge("conversations.start", {
      projectId: "p1",
      extensionId: "probe",
      contribution: page,
      params: { prompt: "hello", ...params },
    });
  return { start, created, submitted };
}

const rejects = (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error) => {
    assert.ok(error instanceof ExtensionUiError, String(error));
    assert.equal(error.bridgeCode, code, error.message);
    return true;
  });

void test("conversations.start needs the manifest capability", async () => {
  const w = setup({ capabilities: [] });
  await rejects(w.start({}), "not_allowed");
  assert.deepEqual(w.created, []);
});

void test("conversations.start creates in the frame's project and sends the prompt", async () => {
  const w = setup();
  const { conversationId } = await w.start({ title: "Review" });
  assert.deepEqual(w.created, [
    {
      id: conversationId,
      projectId: "p1",
      title: "Review",
      config: {},
    },
  ]);
  assert.equal(w.submitted.length, 1);
  assert.deepEqual(w.submitted[0], {
    conversationId,
    inputId: (w.submitted[0] as { inputId: string }).inputId,
    text: "hello",
    source: "user",
  });
});

void test("conversations.start maps the named settings to overrides and the profile", async () => {
  const w = setup({
    values: {
      fast: { provider: "p", modelId: "m", reasoningLevel: "high" },
      persona: "reviewer",
      rules: "strict",
    },
    profile: { digest: "d1", leadUsable: true },
  });
  await w.start({
    model: "fast",
    agentProfile: "persona",
    permissionRuleSet: "rules",
  });
  assert.deepEqual(w.created[0], {
    id: (w.created[0] as { id: string }).id,
    projectId: "p1",
    title: "New Conversation",
    config: {},
    overrides: {
      model: { provider: "p", modelId: "m" },
      reasoningLevel: "high",
      permissionRuleSetId: "strict",
    },
    agentProfile: { name: "reviewer", digest: "d1" },
  });
});

void test("conversations.start uses defaults for unset settings", async () => {
  const w = setup();
  await w.start({
    model: "fast",
    agentProfile: "persona",
    permissionRuleSet: "rules",
  });
  const input = w.created[0] as Record<string, unknown>;
  assert.equal("overrides" in input, false);
  assert.equal("agentProfile" in input, false);
});

void test("conversations.start rejects unknown keys and keys of another type", async () => {
  const w = setup({ values: { name: "x" } });
  await rejects(w.start({ model: "missing" }), "invalid_request");
  await rejects(w.start({ model: "name" }), "invalid_request");
  await rejects(w.start({ agentProfile: "fast" }), "invalid_request");
  await rejects(w.start({ permissionRuleSet: "persona" }), "invalid_request");
  assert.deepEqual(w.created, []);
});

void test("conversations.start refuses an unavailable profile", async () => {
  const w = setup({ values: { persona: "gone" } });
  await rejects(w.start({ agentProfile: "persona" }), "invalid_request");
  assert.deepEqual(w.created, []);
});

void test("conversations.start with send false leaves the prompt unsent", async () => {
  const w = setup();
  await w.start({ send: false });
  assert.equal(w.created.length, 1);
  assert.deepEqual(w.submitted, []);
});
