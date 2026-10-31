import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  Conversation,
  ConversationConfig,
} from "@nervekit/contracts/core";
import type { ConversationTitlesSettings } from "@nervekit/contracts/settings";
import { ConversationService } from "./conversation.service.js";

async function setup({
  enabled = true,
  parent = false,
  prompt = "Fix the settings focus regression",
  title = undefined as string | undefined,
} = {}) {
  const rows = new Map<string, Conversation>();
  const configs = new Map<string, ConversationConfig>();
  let setting: ConversationTitlesSettings = {
    enabled,
    model: { provider: "test", modelId: "small" },
  };
  const pending: Array<(title: string) => void> = [];
  const published: unknown[] = [];
  const serviceOptions = {
    storage: {
      projects: { get: () => ({ id: "p" }) },
      conversations: {
        get: (id: string) => rows.get(id),
        getContext: (id: string) => configs.get(id),
        insert: (row: Conversation, config: ConversationConfig) => {
          rows.set(row.id, row);
          configs.set(row.id, config);
        },
        update: (id: string, patch: Partial<Conversation>) =>
          Object.assign(rows.get(id)!, patch),
        parentId: () => null,
        getSummary: (id: string) => rows.get(id),
        list: () => [],
        rawIdentity: (id: string) => rows.get(id),
        delete: (id: string) => rows.delete(id),
      },
      descendantConversationIds: () => [],
      events: {
        since: () => [
          {
            id: "first",
            type: "user_message",
            payload: { originalText: prompt },
          },
        ],
        lastSequence: () => 1,
      },
      toolCalls: { list: () => [] },
      inputs: { list: () => [] },
      asyncBash: { list: () => [] },
    },
    titles: {
      settings: () => setting,
      generateTitle: () =>
        new Promise<string>((resolve) => pending.push(resolve)),
    },
    assets: { deleteConversationFiles: async () => {} },
    discard: async (_ids: string[], remove: () => Promise<void>) => remove(),
    compactions: { get: () => null, delete: () => {} },
    status: { refresh: () => {} },
    emit: (event: unknown) => published.push(event),
    now: () => "2026-10-31T00:00:00Z",
  } as unknown as ConstructorParameters<typeof ConversationService>[0];
  const service = new ConversationService(serviceOptions);
  const config = {
    model: { provider: "test", modelId: "test" },
    reasoningLevel: "off" as const,
    systemPrompt: null,
    instructions: null,
    permissionRuleSetId: "autonomous",
    agentProfile: "coding" as const,
    workingDirectory: "/project",
  };
  await service.create(
    {
      id: "c",
      projectId: "p",
      parentConversationId: parent ? "root" : undefined,
      title,
    },
    config,
  );
  return {
    service,
    config,
    restart: () => new ConversationService(serviceOptions),
    rows,
    pending,
    published,
    set: (next: ConversationTitlesSettings) => {
      setting = next;
    },
  };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("one title request for a new root; apply changes only title metadata", async () => {
  const { service, rows, pending } = await setup();
  service.autoTitle("c");
  service.autoTitle("c");
  assert.equal(pending.length, 1);
  const before = { ...rows.get("c")! };
  pending[0]!("Fix settings keyboard focus regression");
  await flush();
  assert.deepEqual(rows.get("c"), {
    ...before,
    title: "Fix settings keyboard focus regression",
  });
});
for (const scenario of [
  "rename",
  "same rename",
  "delete",
  "disable",
  "model change",
] as const) {
  test(`${scenario} wins over a background result`, async () => {
    const { service, rows, pending, set } = await setup();
    service.autoTitle("c");
    if (scenario === "rename") service.update("c", { title: "My title" });
    if (scenario === "same rename")
      service.update("c", { title: rows.get("c")!.title });
    if (scenario === "delete") await service.delete("c");
    if (scenario === "disable")
      set({ enabled: false, model: { provider: "test", modelId: "small" } });
    if (scenario === "model change")
      set({ enabled: true, model: { provider: "test", modelId: "other" } });
    const before = rows.get("c")?.title;
    pending[0]!("Background title must not win");
    await flush();
    assert.equal(rows.get("c")?.title, before);
  });
}
test("clients creating with the placeholder title still get an AI title", async () => {
  const { service, pending } = await setup({ title: "New Conversation" });
  service.autoTitle("c");
  assert.equal(pending.length, 1);
});
test("an explicit title at creation prevents generation", async () => {
  const { service, pending } = await setup({ title: "Release notes" });
  service.autoTitle("c");
  assert.equal(pending.length, 0);
});
test("disabled, children and meaningless prompts skip generation", async () => {
  for (const options of [
    { enabled: false },
    { parent: true },
    { prompt: "hello" },
    { prompt: "@/a.png" },
  ]) {
    const { service, pending } = await setup(options);
    service.autoTitle("c");
    assert.equal(pending.length, 0);
  }
});
test("manually naming a new conversation before its first prompt prevents generation", async () => {
  const { service, pending } = await setup();
  service.update("c", { title: "New Conversation" });
  service.autoTitle("c");
  assert.equal(pending.length, 0);
});

test("existing conversations after restart are not candidates", async () => {
  const { restart, pending } = await setup();
  restart().autoTitle("c");
  assert.equal(pending.length, 0);
});
test("out-of-order results cannot overwrite a newer title generation", async () => {
  const { service, config, rows, pending } = await setup();
  service.autoTitle("c");
  await service.delete("c");
  await service.create({ id: "c", projectId: "p" }, config);
  service.autoTitle("c");
  pending[1]!("Fix newer settings focus regression");
  await flush();
  pending[0]!("Fix older settings focus regression");
  await flush();
  assert.equal(rows.get("c")?.title, "Fix newer settings focus regression");
});
