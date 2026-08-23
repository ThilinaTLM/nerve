import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CenterTabIdentity } from "$lib/application/workspace";
import { createCenterTabRefresh } from "./center-tab-refresh";

describe("center tab refresh", () => {
  it("dispatches every tab kind to its canonical action", () => {
    const calls: string[] = [];
    const refresh = createCenterTabRefresh({
      refreshConversation: (id) => calls.push(`conversation:${id}`),
      selectTab: (tab) => calls.push(`select:${tab.kind}:${tab.id}`),
      refreshFile: (id) => calls.push(`file:${id}`),
      refreshMermaid: (id) => calls.push(`mermaid:${id}`),
      refreshPullRequest: (id) => calls.push(`pr:${id}`),
      refreshDiff: (id) => calls.push(`diff:${id}`),
      loadSettings: () => calls.push("settings"),
      refreshLogs: () => calls.push("logs"),
    });
    const tabs: CenterTabIdentity[] = [
      { kind: "conversation", id: "conv_1" },
      { kind: "pending-conversation", id: "pending_1" },
      { kind: "task", id: "task_1" },
      { kind: "discover", id: "discover" },
      { kind: "file", id: "file_1" },
      { kind: "mermaid", id: "mermaid_1" },
      { kind: "pr", id: "pr_1" },
      { kind: "diff", id: "diff_1" },
      { kind: "settings", id: "settings" },
      { kind: "logs", id: "logs" },
    ];
    tabs.forEach(refresh);
    assert.deepEqual(calls, [
      "conversation:conv_1",
      "select:pending-conversation:pending_1",
      "select:task:task_1",
      "select:discover:discover",
      "file:file_1",
      "mermaid:mermaid_1",
      "pr:pr_1",
      "diff:diff_1",
      "settings",
      "logs",
    ]);
  });
});
