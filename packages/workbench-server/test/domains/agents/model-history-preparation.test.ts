import assert from "node:assert/strict";
import test from "node:test";
import { ConversationError } from "@nervekit/harness";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ConversationTreeEntry } from "@nervekit/harness/conversation";
import { ConversationService } from "../../../src/domains/conversations/conversation-service.js";
import { ModelHistoryInvalidError } from "../../../src/domains/conversations/model-history-navigation.js";
import type { WorkbenchAgentMechanics } from "../../../src/domains/agents/execution/workbench-agent-mechanics.js";
import {
  assertWorkbenchModelHistory,
  prepareWorkbenchTurn,
} from "../../../src/domains/agents/execution/workbench-turn-preparation.js";

const entry: ConversationTreeEntry = {
  type: "message",
  id: "entry_owned",
  parentId: null,
  timestamp: "2026-10-09T00:00:00.000Z",
  message: { role: "user", content: "owned model context", timestamp: 1 },
};
const agent = {
  id: "agent_selected",
  conversationId: "conv_selected",
  contextOwnerAgentId: "agent_selected",
} as AgentRecord;

for (const [name, entries, leaf] of [
  ["transcript-only status leaf", [entry], "entry_run_status_failed"],
  [
    "missing model ancestor",
    [{ ...entry, parentId: "entry_missing" }],
    entry.id,
  ],
  ["ancestry cycle", [{ ...entry, parentId: entry.id }], entry.id],
] as const) {
  test(`common turn preparation rejects ${name} before touching accepted input`, async () => {
    let inputReads = 0;
    let opened: AgentRecord | undefined;
    const mechanics = {
      deps: {
        harnessStorage: {
          openAgentStorage: async (selected: AgentRecord) => {
            opened = selected;
            return {
              getEntries: async () => entries,
              getLeafId: async () => leaf,
            };
          },
        },
        agentInputs: {
          get: async () => {
            inputReads++;
            throw new Error("must not touch accepted input");
          },
        },
      },
    } as unknown as WorkbenchAgentMechanics;
    await assert.rejects(
      prepareWorkbenchTurn({ mechanics, agent } as Parameters<
        typeof prepareWorkbenchTurn
      >[0]),
      (error: unknown) =>
        error instanceof ModelHistoryInvalidError &&
        error.code === "MODEL_HISTORY_INVALID",
    );
    assert.equal(opened, agent);
    assert.equal(inputReads, 0);
  });
}

for (const error of [
  new ConversationError("invalid_conversation", "Stored ancestry cycle"),
  new ConversationError("not_found", "Storage unavailable"),
  new Error("invalid_conversation: not a typed integrity failure"),
]) {
  test(`earliest preparation normalizes only recognized constructor errors: ${error.name}/${"code" in error ? error.code : "generic"}`, async () => {
    const mechanics = {
      deps: {
        harnessStorage: {
          openAgentStorage: async () => {
            throw error;
          },
        },
      },
    } as unknown as WorkbenchAgentMechanics;
    await assert.rejects(
      assertWorkbenchModelHistory(mechanics, agent),
      (failure: unknown) =>
        error instanceof ConversationError &&
        error.code === "invalid_conversation"
          ? failure instanceof ModelHistoryInvalidError &&
            failure.code === "MODEL_HISTORY_INVALID"
          : failure === error,
    );
  });
}

test("preparation selects persisted agent storage, never the shared transcript or another owner's tree", async () => {
  let opens = 0;
  const mechanics = {
    deps: {
      harnessStorage: {
        openStorage: async () => {
          throw new Error("shared fallback is forbidden");
        },
        openAgentStorage: async (selected: AgentRecord) => {
          assert.equal(selected, agent);
          opens++;
          return {
            getEntries: async () => [entry],
            getLeafId: async () => entry.id,
          };
        },
      },
    },
  } as unknown as WorkbenchAgentMechanics;
  await assertWorkbenchModelHistory(mechanics, agent);
  assert.equal(opens, 1);
});

for (const integrityFailure of [true, false]) {
  test(`conversation cache ${integrityFailure ? "rejects integrity errors without transcript fallback" : "preserves availability fallback for a valid model path"}`, async () => {
    let fallbacks = 0;
    let warnings = 0;
    const service = new ConversationService(
      {
        openStorage: async () => ({
          getEntries: async () => [entry],
          getLeafId: async () =>
            integrityFailure ? "entry_run_status_failed" : entry.id,
          buildContext: async () => {
            throw new Error("derived cache unavailable");
          },
        }),
        warnMirror: () => {
          warnings++;
        },
      } as unknown as ConstructorParameters<typeof ConversationService>[0],
      {
        activeBranchEntries: () => {
          fallbacks++;
          return [
            {
              role: "user",
              text: "transcript fallback",
              createdAt: entry.timestamp,
            },
          ];
        },
      } as unknown as ConstructorParameters<typeof ConversationService>[1],
    );
    const read = service.contextMessagesForConversation(
      { id: "conv_selected" } as never,
      "/tmp",
      new Map(),
    );
    if (integrityFailure) {
      await assert.rejects(read, ModelHistoryInvalidError);
      assert.equal(fallbacks, 0);
      assert.equal(warnings, 0);
    } else {
      assert.equal((await read)[0]?.content, "transcript fallback");
      assert.equal(fallbacks, 1);
      assert.equal(warnings, 1);
    }
  });
}
