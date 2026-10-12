import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mostRecentTab,
  reorderTabs,
  startupTabActivationLane,
  tabIdentityKey,
} from "./tab-session-helpers";
import type { CenterTabIdentity } from "./workspace-state.svelte";

test("async bash tabs are keyed by run, not conversation or command, and restore progressively", () => {
  const tab: CenterTabIdentity = {
    kind: "async-bash",
    id: "bash1",
    conversationId: "conv",
    projectId: "project",
    command: "test",
  };
  assert.equal(tabIdentityKey(tab), "async-bash:bash1");
  assert.equal(
    tabIdentityKey({ ...tab, command: "changed", conversationId: "other" }),
    tabIdentityKey(tab),
  );
  assert.notEqual(tabIdentityKey({ ...tab, id: "bash2" }), tabIdentityKey(tab));
  assert.notEqual(
    tabIdentityKey({ kind: "launch", id: tab.id }),
    tabIdentityKey(tab),
  );
  assert.equal(startupTabActivationLane(tab), "progressive");
});

test("closing an async bash tab falls back by MRU and reordering retains routing metadata", () => {
  const conversation: CenterTabIdentity = { kind: "conversation", id: "conv" };
  const first: CenterTabIdentity = {
    kind: "async-bash",
    id: "bash1",
    conversationId: "conv",
    projectId: "project",
  };
  const second: CenterTabIdentity = { ...first, id: "bash2" };
  const tabs = [conversation, first, second];
  assert.equal(
    mostRecentTab(
      tabs,
      [tabIdentityKey(first), tabIdentityKey(second)],
      [first],
    ),
    second,
  );
  assert.equal(mostRecentTab(tabs, [], [first, second]), conversation);
  assert.deepEqual(reorderTabs(tabs, first, 0), [first, conversation, second]);
});
