import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publicEventDataGuardSchema } from "../src/domains/events/bounded-public-data.schema.js";
import { validatePublicEvent } from "../src/domains/events/public-event-catalog.schema.js";

describe("public approval event depth", () => {
  it("retains conversation revisions on parsed conversation events", () => {
    const parsed = validatePublicEvent(
      "run.started",
      {
        conversationId: "conv_test",
        conversationRevision: 7,
        agentId: "agent_test",
        projectId: "proj_test",
        runId: "run_test",
        startedAt: "2026-08-23T00:00:00.000Z",
      },
      "workbench_server",
    ) as { conversationRevision?: number };
    assert.equal(parsed.conversationRevision, 7);
  });

  it("retains revisions for strict conversation event payloads", () => {
    const parsed = validatePublicEvent(
      "agent.subagent_transcript.run.started",
      {
        conversationId: "conv_test",
        conversationRevision: 8,
        projectId: "proj_test",
        parentAgentId: "agent_parent",
        childAgentId: "agent_child",
        runId: "run_test",
        startedAt: "2026-08-23T00:00:00.000Z",
      },
      "workbench_server",
    ) as { conversationRevision?: number };
    assert.equal(parsed.conversationRevision, 8);
  });

  it("accepts canonical command-prefix approval selectors", () => {
    const result = publicEventDataGuardSchema.safeParse({
      conversationId: "conv_test",
      toolCall: {
        id: "tool_test",
        interactions: [
          {
            ordinal: 0,
            kind: "approval",
            request: {
              suggestedExceptions: [
                {
                  selector: {
                    kind: "command_prefix",
                    tokens: ["pnpm", "test"],
                  },
                },
              ],
            },
          },
        ],
      },
    });
    assert.equal(result.success, true);
  });

  it("retains a finite depth ceiling", () => {
    let nested: unknown = "value";
    for (let index = 0; index < 14; index += 1) nested = { child: nested };
    const result = publicEventDataGuardSchema.safeParse(nested);
    assert.equal(result.success, false);
    assert.match(result.error?.issues[0]?.message ?? "", /too deep/);
  });
});
