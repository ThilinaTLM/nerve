import assert from "node:assert/strict";
import { test } from "node:test";
import { planCenterTabClose } from "./center-tab-close-plan";
import { tabIdentityKey } from "./tab-session-helpers";

const conversation = { kind: "conversation", id: "conversation" } as const;
const file = { kind: "file", id: "file" } as const;
const settings = { kind: "settings", id: "settings" } as const;

test("center-tab close planning preserves failures and chooses MRU fallback", () => {
  const result = planCenterTabClose({
    openTabs: [conversation, file, settings],
    activeTab: settings,
    mru: [settings, file, conversation].map(tabIdentityKey),
    closedTabs: [conversation, settings],
  });
  assert.deepEqual(result, {
    remainingTabs: [file],
    activeWasClosed: true,
    fallback: file,
  });
});

test("center-tab close planning honors a remaining preferred fallback", () => {
  const result = planCenterTabClose({
    openTabs: [conversation, file, settings],
    activeTab: settings,
    mru: [settings, file, conversation].map(tabIdentityKey),
    closedTabs: [settings],
    preferredFallback: conversation,
  });
  assert.deepEqual(result.fallback, conversation);
  assert.equal(result.activeWasClosed, true);
});
