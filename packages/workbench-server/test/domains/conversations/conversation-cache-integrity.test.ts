import assert from "node:assert/strict";
import test from "node:test";
import { ConversationError } from "@nervekit/harness";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ConversationRecord } from "@nervekit/contracts/conversations";
import { ConversationService } from "../../../src/domains/conversations/conversation-service.js";
import { ModelHistoryInvalidError } from "../../../src/domains/conversations/model-history-navigation.js";

const project = { id: "proj_cache", dir: "/tmp" } as never;
const conversation = (id: string) =>
  ({ id, projectId: "proj_cache" }) as ConversationRecord;
const agent = (id: string, conversationId: string) =>
  ({ id, conversationId }) as AgentRecord;

function fixture() {
  const invalid = new Set<string>();
  const fallback = new Set<string>();
  const fallbackReads: string[] = [];
  const service = new ConversationService(
    {
      openStorage: async (selected: ConversationRecord) => ({
        getEntries: async () => [
          {
            id: "entry_valid",
            parentId: null,
            type: "message",
            timestamp: "2026-10-09T00:00:00.000Z",
            message: {
              role: "user",
              content: `model:${selected.id}`,
              timestamp: 1,
            },
          },
        ],
        getLeafId: async () =>
          invalid.has(selected.id) ? "entry_run_status_failed" : "entry_valid",
        buildContext: async () => {
          if (fallback.has(selected.id))
            throw new Error("derived mirror unavailable");
          return {
            messages: [
              { role: "user", content: `model:${selected.id}`, timestamp: 1 },
            ],
          };
        },
      }),
      warnMirror: () => {},
    } as unknown as ConstructorParameters<typeof ConversationService>[0],
    {
      activeBranchEntries: (
        _entries: unknown,
        selected: ConversationRecord,
      ) => {
        fallbackReads.push(selected.id);
        return [
          {
            role: "user",
            text: `fallback:${selected.id}`,
            createdAt: "2026-10-09T00:00:00.000Z",
          },
        ];
      },
    } as unknown as ConstructorParameters<typeof ConversationService>[1],
  );
  return { service, invalid, fallback, fallbackReads };
}

test("rebuildAll isolates invalid model history while caching valid and verified availability fallback contexts", async () => {
  const h = fixture();
  const valid = conversation("conv_valid");
  const invalid = conversation("conv_invalid");
  const fallback = conversation("conv_fallback");
  const agents = [
    agent("agent_valid", valid.id),
    agent("agent_invalid", invalid.id),
    agent("agent_invalid_secondary", invalid.id),
    agent("agent_fallback", fallback.id),
  ];
  h.invalid.add(invalid.id);
  h.fallback.add(fallback.id);
  h.service.setForAgent("agent_invalid", [
    { role: "user", content: "STALE executable cache", timestamp: 0 },
  ]);
  await h.service.rebuildAll(
    [project],
    [valid, invalid, fallback],
    agents,
    new Map(),
  );
  assert.equal(
    h.service.getForAgent("agent_valid")?.[0]?.content,
    "model:conv_valid",
  );
  assert.equal(
    h.service.getForAgent("agent_fallback")?.[0]?.content,
    "fallback:conv_fallback",
  );
  assert.equal(h.service.getForAgent("agent_invalid"), undefined);
  assert.equal(h.service.getForAgent("agent_invalid_secondary"), undefined);
  assert.deepEqual(h.fallbackReads, [fallback.id]);
  await assert.rejects(
    h.service.contextMessagesForConversation(invalid, "/tmp", new Map()),
    ModelHistoryInvalidError,
  );
});

for (const error of [
  new ConversationError(
    "invalid_conversation",
    "Missing persisted model parent",
  ),
  new ConversationError("not_found", "Unavailable mirror"),
  new Error("invalid_conversation: arbitrary availability message"),
]) {
  test(`cache recognizes only typed tree integrity errors: ${error.name}/${"code" in error ? error.code : "generic"}`, async () => {
    let fallbacks = 0;
    const service = new ConversationService(
      {
        openStorage: async () => {
          throw error;
        },
        warnMirror: () => {},
      } as unknown as ConstructorParameters<typeof ConversationService>[0],
      {
        activeBranchEntries: () => {
          fallbacks++;
          return [
            {
              role: "user",
              text: "availability fallback",
              createdAt: "2026-10-09T00:00:00.000Z",
            },
          ];
        },
      } as unknown as ConstructorParameters<typeof ConversationService>[1],
    );
    const read = service.contextMessagesForConversation(
      conversation("conv_selected"),
      "/tmp",
      new Map(),
    );
    if (
      error instanceof ConversationError &&
      error.code === "invalid_conversation"
    ) {
      await assert.rejects(read, ModelHistoryInvalidError);
      assert.equal(fallbacks, 0);
    } else {
      assert.equal((await read)[0]?.content, "availability fallback");
      assert.equal(fallbacks, 1);
    }
  });
}

test("rebuildConversation removes all affected stale caches on integrity failure and preserves unrelated caches", async () => {
  const h = fixture();
  const selected = conversation("conv_invalid");
  const affected = [
    agent("agent_selected", selected.id),
    agent("agent_secondary", selected.id),
  ];
  const unrelated = agent("agent_unrelated", "conv_valid");
  const prior = [
    { role: "user" as const, content: "prior verified context", timestamp: 0 },
  ];
  for (const item of [...affected, unrelated])
    h.service.setForAgent(item.id, prior);
  h.invalid.add(selected.id);
  const agents = function* () {
    yield* [...affected, unrelated];
  };
  await assert.rejects(
    h.service.rebuildConversation(project, selected, agents(), []),
    ModelHistoryInvalidError,
  );
  for (const item of affected)
    assert.equal(h.service.getForAgent(item.id), undefined);
  assert.equal(h.service.getForAgent(unrelated.id), prior);
  assert.deepEqual(h.fallbackReads, []);
  h.invalid.delete(selected.id);
  await h.service.rebuildConversation(project, selected, agents(), []);
  for (const item of affected)
    assert.equal(
      h.service.getForAgent(item.id)?.[0]?.content,
      `model:${selected.id}`,
    );
});
