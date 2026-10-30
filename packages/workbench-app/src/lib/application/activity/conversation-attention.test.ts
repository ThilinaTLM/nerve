import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationSummary } from "@nervekit/contracts/core";
import type { AttentionEvent } from "$lib/application/notifications/attention-delivery.svelte";
import type { AttentionPresence } from "$lib/application/notifications/attention-policy";
import { ConversationAttention } from "./conversation-attention.js";
import { suppressNextCompletion } from "./user-stop.js";

type Input = NonNullable<ConversationSummary["pendingInput"]>;

function summary(
  patch: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    id: "root",
    projectId: "p1",
    parentConversationId: null,
    title: "Fix bug",
    status: "idle",
    pendingWork: false,
    pendingInput: null,
    ...patch,
  } as ConversationSummary;
}
const input = (patch: Partial<Input> = {}): Input => ({
  conversationId: "root",
  conversationTitle: "Fix bug",
  toolCallId: "t1",
  kind: "approval",
  ...patch,
});

function setup(presence: AttentionPresence = "away") {
  const events: AttentionEvent[] = [];
  const opened: string[] = [];
  const unseen = new Set<string>();
  const attention = new ConversationAttention({
    deliver: (event) => events.push(event),
    presence: () => presence,
    projectName: () => "Atlas",
    open: (id) => opened.push(id),
    unseen,
  });
  return { attention, events, opened, unseen };
}

test("baseline summaries are quiet; unknown conversations only set a baseline", () => {
  const { attention, events } = setup();
  attention.seed([summary({ status: "running" })]);
  attention.observe(summary({ status: "running" }));
  attention.observe(summary({ id: "other", status: "failed" }));
  attention.reset();
  attention.observe(summary({ status: "failed" }));
  assert.equal(events.length, 0);
});

test("each edge fires once and repeated approvals fire again", () => {
  const { attention, events, opened } = setup();
  attention.seed([summary()]);
  attention.observe(summary({ status: "running" }));
  attention.observe(summary({ status: "waiting", pendingInput: input() }));
  attention.observe(
    summary({ status: "waiting", pendingInput: input(), title: "Renamed" }),
  );
  attention.observe(
    summary({ status: "waiting", pendingInput: input({ toolCallId: "t2" }) }),
  );
  attention.observe(summary({ status: "running" }));
  attention.observe(summary({ status: "idle" }));
  attention.observe(summary({ status: "idle" }));
  assert.deepEqual(
    events.map((event) => [event.kind, event.title, event.body]),
    [
      ["input", "Approval needed", "Atlas · Fix bug"],
      ["input", "Approval needed", "Atlas · Fix bug"],
      ["finished", "Agent finished", "Atlas · Fix bug"],
    ],
  );
  events[0]?.open();
  assert.deepEqual(opened, ["root"]);
});

test("sub-agent requests are labelled and open the sub-agent", () => {
  const { attention, events, opened } = setup();
  attention.seed([summary({ status: "running" })]);
  attention.observe(
    summary({
      status: "running",
      pendingInput: input({
        conversationId: "child",
        conversationTitle: "Researcher",
        kind: "user_input",
      }),
    }),
  );
  assert.equal(events[0]?.title, "Researcher · question for you");
  assert.equal(events[0]?.subAgentName, "Researcher");
  events[0]?.open();
  assert.deepEqual(opened, ["child"]);
});

test("failure and interruption notify; a still-busy lead or pending work does not finish", () => {
  const { attention, events } = setup();
  attention.seed([summary({ status: "running" })]);
  attention.observe(summary({ status: "idle", pendingWork: true }));
  assert.equal(events.length, 0);
  attention.observe(summary({ status: "failed" }));
  attention.observe(summary({ status: "idle" }));
  attention.observe(summary({ status: "interrupted" }));
  assert.deepEqual(
    events.map((event) => event.title),
    ["Agent failed", "Agent interrupted"],
  );
});

test("sub-agent summaries never notify directly", () => {
  const { attention, events, unseen } = setup();
  const child = (patch: Partial<ConversationSummary>) =>
    summary({ id: "child", parentConversationId: "root", ...patch });
  attention.seed([child({ status: "running" })]);
  attention.observe(child({ status: "running" }));
  attention.observe(child({ status: "idle" }));
  attention.observe(child({ status: "failed" }));
  assert.equal(events.length, 0);
  assert.equal(unseen.size, 0);
});

test("a Stop from this window silences the next completion", () => {
  const { attention, events, unseen } = setup();
  attention.seed([summary({ id: "stopped", status: "running" })]);
  suppressNextCompletion("stopped");
  attention.observe(summary({ id: "stopped", status: "idle" }));
  assert.equal(events.length, 0);
  assert.equal(unseen.size, 0);
  attention.observe(summary({ id: "stopped", status: "running" }));
  attention.observe(summary({ id: "stopped", status: "idle" }));
  assert.equal(events.length, 1);
});

test("unseen results are added unless watching, and deletion clears them", () => {
  const away = setup("elsewhere");
  away.attention.seed([summary({ status: "running" })]);
  away.attention.observe(summary({ status: "idle" }));
  assert.deepEqual([...away.unseen], ["root"]);
  away.attention.forget("root");
  assert.equal(away.unseen.size, 0);

  const watching = setup("watching");
  watching.attention.seed([summary({ status: "running" })]);
  watching.attention.observe(summary({ status: "idle" }));
  assert.equal(watching.unseen.size, 0);
  assert.equal(watching.events.length, 1);

  const input = setup("away");
  input.attention.seed([summary({ status: "running" })]);
  input.attention.observe(
    summary({
      status: "waiting",
      pendingInput: {
        conversationId: "root",
        conversationTitle: "x",
        toolCallId: "t",
        kind: "approval",
      },
    }),
  );
  assert.equal(input.unseen.size, 0);
});
