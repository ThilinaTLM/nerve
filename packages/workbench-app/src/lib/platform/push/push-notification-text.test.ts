import assert from "node:assert/strict";
import test from "node:test";
import { pushNotificationContent } from "./push-notification-text";

const base = {
  type: "attention" as const,
  conversationId: "c1",
  openConversationId: "c1",
  conversationTitle: "Fix login",
  projectName: "Nerve",
};

test("input kinds map to their desktop wording", () => {
  const title = (
    inputKind:
      | "approval"
      | "user_input"
      | "plan_review"
      | "configuration_blocked",
  ) => pushNotificationContent({ ...base, reason: "input", inputKind }).title;
  assert.equal(title("approval"), "Approval needed");
  assert.equal(title("user_input"), "Question for you");
  assert.equal(title("plan_review"), "Plan ready for review");
  assert.equal(title("configuration_blocked"), "Setup needed");
});

test("results, body, tag and open target", () => {
  const content = pushNotificationContent({ ...base, reason: "finished" });
  assert.deepEqual(content, {
    title: "Agent finished",
    body: "Nerve · Fix login",
    tag: "c1",
    openConversationId: "c1",
  });
  assert.equal(
    pushNotificationContent({ ...base, reason: "failed" }).title,
    "Agent failed",
  );
});

test("sub-agent prefix and missing project", () => {
  const content = pushNotificationContent({
    ...base,
    projectName: undefined,
    reason: "input",
    inputKind: "approval",
    openConversationId: "child",
    subAgentTitle: "Reviewer",
  });
  assert.equal(content.title, "Reviewer · approval needed");
  assert.equal(content.body, "Fix login");
  assert.equal(content.openConversationId, "child");
});

test("test payload", () => {
  assert.equal(
    pushNotificationContent({ type: "test" }).title,
    "Nerve notifications work",
  );
});
