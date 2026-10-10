import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publicEventDataGuardSchema } from "../../src/events/bounded-public-data.js";
import { validatePublicEvent } from "../../src/events/catalog.js";
import { conversationChannelEventSchemas } from "../../src/domains/core/channel.js";
import { toolCallSchema } from "../../src/domains/core/tool-call.js";
import { assistantEvent, toolCall } from "./core-event-fixtures.js";

describe("public conversation events", () => {
  it("retains the durable sequence on parsed conversation events", () => {
    const event = assistantEvent();
    const parsed = conversationChannelEventSchemas["conversation.event"].parse(
      validatePublicEvent("conversation.event", event, "workbench_server"),
    );
    assert.equal(parsed.sequence, 7);
  });
  it("accepts canonical approval rules on tool-call notices", () => {
    const call = toolCall();
    const parsed = conversationChannelEventSchemas[
      "conversation.toolCall"
    ].parse(
      validatePublicEvent(
        "conversation.toolCall",
        { conversationId: "conv_test", toolCall: call },
        "workbench_server",
      ),
    );
    assert.deepEqual(parsed.toolCall, call);
  });
  it("requires provider references only for model-origin calls", () => {
    const call = toolCall();
    assert.equal(
      toolCallSchema.safeParse({ ...call, providerCallId: null }).success,
      false,
    );
    assert.equal(
      toolCallSchema.safeParse({ ...call, origin: "user" }).success,
      false,
    );
    assert.equal(
      toolCallSchema.safeParse({
        ...call,
        origin: "user",
        providerCallId: null,
        assistantEventId: null,
        contentIndex: null,
      }).success,
      true,
    );
  });
  it("retains a finite depth ceiling", () => {
    let nested: unknown = "value";
    for (let index = 0; index < 14; index += 1) nested = { child: nested };
    const result = publicEventDataGuardSchema.safeParse(nested);
    assert.equal(result.success, false);
    assert.match(result.error?.issues[0]?.message ?? "", /too deep/);
  });
});
