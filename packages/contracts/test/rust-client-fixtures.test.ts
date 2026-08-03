import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  parseProtocolResponseData,
  parsePublicEventBatch,
  protocolV1MessageSchema,
} from "../src/index.js";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`./fixtures/rust-client/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}

describe("Rust client contract fixtures", () => {
  for (const name of ["hello", "welcome", "ready", "subscription-updated"]) {
    it(`validates ${name}`, () => {
      protocolV1MessageSchema.parse(fixture(name));
    });
  }

  it("validates a cataloged dense event batch", () => {
    const message = protocolV1MessageSchema.parse(fixture("event-batch"));
    assert.equal(message.kind, "event.batch");
    parsePublicEventBatch(message.data, "workbench_server");
  });

  it("validates workspace and conversation operation results", () => {
    for (const [name, method] of [
      ["workspace-response", "snapshot.workspace.get"],
      ["conversation-response", "snapshot.conversation.get"],
    ] as const) {
      const message = protocolV1MessageSchema.parse(fixture(name));
      assert.equal(message.kind, "response");
      assert.equal(message.data.method, method);
      parseProtocolResponseData(method, message.data);
    }
  });
});
