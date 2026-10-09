import assert from "node:assert/strict";
import { test } from "node:test";
import { notifyEventSchema } from "@nervekit/contracts/events";
import { WorkbenchNoticePublisher } from "./workbench-notice-publisher.js";

void test("workbench notices satisfy the protocol notification envelope", async () => {
  const publisher = new WorkbenchNoticePublisher();
  const notices: unknown[] = [];
  publisher.subscribeNotify((event) => notices.push(event));

  await publisher.publish("scratchNote.changed", { projectId: "proj_qa" });

  assert.equal(notices.length, 1);
  const event = notifyEventSchema.parse(notices[0]);
  assert.equal(event.type, "scratchNote.changed");
  assert.deepEqual(event.data, { projectId: "proj_qa" });
});
