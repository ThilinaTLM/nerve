import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PUBLIC_EVENT_MAX_CONTENT_BYTES,
  PUBLIC_EVENT_MAX_STRING_CHARS,
  validatePublicEvent,
} from "../../src/events/index.js";
import { conversationChannelEventSchemas } from "../../src/domains/core/channel.js";
import { assistantEvent } from "./core-event-fixtures.js";

describe("conversation event content profile", () => {
  for (const kind of ["text", "thinking"] as const) {
    it(`accepts authoritative ${kind} longer than the metadata string cap`, () => {
      const text = "x".repeat(PUBLIC_EVENT_MAX_STRING_CHARS + 500);
      const content =
        kind === "text"
          ? [{ type: kind, text }]
          : [{ type: kind, thinking: text }];
      const parsed = conversationChannelEventSchemas[
        "conversation.event"
      ].parse(
        validatePublicEvent(
          "conversation.event",
          assistantEvent(content),
          "workbench_server",
        ),
      );
      assert.equal(parsed.type, "assistant_message");
      if (parsed.type === "assistant_message")
        assert.deepEqual(parsed.payload.content, content);
    });
  }
  it("still enforces a total byte ceiling for content events", () => {
    assert.throws(
      () =>
        validatePublicEvent(
          "conversation.event",
          assistantEvent([
            { type: "text", text: "x".repeat(PUBLIC_EVENT_MAX_CONTENT_BYTES) },
          ]),
          "workbench_server",
        ),
      /may not exceed/,
    );
  });
  it("rejects secret-like keys even on content events", () => {
    const event = assistantEvent();
    assert.throws(() =>
      validatePublicEvent(
        "conversation.event",
        { ...event, payload: { ...event.payload, apiKey: "nope" } },
        "workbench_server",
      ),
    );
  });
});
