import assert from "node:assert/strict";
import { test } from "node:test";
import { openCoreStorage } from "../storage/core-storage.js";
import type { InputQueueService } from "../inputs/input-queue.service.js";
import { BackgroundTaskService } from "./background-task.service.js";
import type { TaskRef, TaskRunner, TaskTerminal } from "./background-task.js";

const ref: TaskRef = { kind: "subagent", id: "c1", parentConversationId: "p" };
const terminal: TaskTerminal = {
  outcome: "completed",
  text: "done",
  assetIds: [],
  detail: { kind: "subagent", assignmentId: "a" },
  noticeInputId: "input_e1",
};

function service(
  enqueue: (request: {
    inputId: string;
    subtype: string;
    producer: string;
  }) => void,
  events: string[],
  suppress = false,
) {
  const storage = openCoreStorage(":memory:");
  const runner: TaskRunner = {
    kind: "subagent",
    running: () => [],
    isRunning: () => false,
    recover: async () => undefined,
    describe: async () => terminal,
    persist: () => {
      events.push("persist");
      return true;
    },
    suppressNotice: () => suppress,
  };
  const tasks = new BackgroundTaskService({
    storage,
    inputs: { enqueueNotice: enqueue } as unknown as InputQueueService,
  });
  tasks.register(runner);
  return tasks;
}

test("a notice that cannot be enqueued aborts the settle", () => {
  const events: string[] = [];
  const tasks = service(() => {
    throw new Error("queue full");
  }, events);
  assert.throws(() => tasks.settle(ref, terminal), /queue full/);
});

test("settle enqueues one task_result with the stable dedupe id", () => {
  const requests: { inputId: string; subtype: string; producer: string }[] = [];
  const tasks = service(
    ({ inputId, subtype, producer }) =>
      void requests.push({ inputId, subtype, producer }),
    [],
  );
  tasks.settle(ref, terminal);
  assert.deepEqual(requests, [
    { inputId: "input_e1", subtype: "task_result", producer: "c1" },
  ]);
});

test("a suppressed notice is not enqueued", () => {
  let enqueued = 0;
  const tasks = service(() => void enqueued++, [], true);
  tasks.settle(ref, { ...terminal, outcome: "cancelled" });
  assert.equal(enqueued, 0);
});
