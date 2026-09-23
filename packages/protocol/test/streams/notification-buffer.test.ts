import assert from "node:assert/strict";
import test from "node:test";
import type { NotifyEvent } from "@nervekit/contracts/events";
import { NotificationBuffer } from "../../src/streams/notification-buffer.js";

const definition = {
  scope: ["taskId", "stream"],
  coalescing: {
    strategy: "concat_delta" as const,
    field: "text" as const,
    offsetField: "offset",
    maxChars: 10,
  },
};

function output(
  id: string,
  taskId: string,
  offset: number,
  text: string,
): NotifyEvent {
  return {
    id,
    ts: "2026-07-18T00:00:00.000Z",
    type: "task.output",
    data: { taskId, stream: "stdout", offset, text },
  };
}

test("notification coalescing preserves offsets and never merges gaps or other scopes", () => {
  const buffer = new NotificationBuffer(10);
  const parseData = (data: unknown) => data;
  buffer.enqueue(output("evt_1", "task_a", 3, "abc"), definition, parseData);
  buffer.enqueue(output("evt_2", "task_a", 6, "def"), definition, parseData);
  assert.deepEqual(
    buffer.all().map((event) => event.data),
    [{ taskId: "task_a", stream: "stdout", offset: 3, text: "abcdef" }],
  );

  buffer.enqueue(output("evt_3", "task_a", 10, "gap"), definition, parseData);
  buffer.enqueue(output("evt_4", "task_b", 13, "other"), definition, parseData);
  assert.deepEqual(
    buffer.take().map((event) => event.id),
    ["evt_2", "evt_3", "evt_4"],
  );
  assert.deepEqual(buffer.take(), []);
});

test("notification coalescing respects the size cap even for adjacent deltas", () => {
  const buffer = new NotificationBuffer(10);
  const parseData = (data: unknown) => data;
  buffer.enqueue(output("evt_1", "task_a", 0, "123456"), definition, parseData);
  buffer.enqueue(output("evt_2", "task_a", 6, "78901"), definition, parseData);
  assert.deepEqual(
    buffer.take().map((event) => event.data),
    [
      { taskId: "task_a", stream: "stdout", offset: 0, text: "123456" },
      { taskId: "task_a", stream: "stdout", offset: 6, text: "78901" },
    ],
  );
});
