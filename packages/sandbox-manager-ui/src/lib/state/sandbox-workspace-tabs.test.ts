import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ensurePendingConversation } from "./sandbox-conversation-state";
import {
  createSandboxDetailState,
  sandboxSummaryTab,
} from "./sandbox-ui-types";
import {
  closeWorkspaceTab,
  closeWorkspaceTabs,
  openWorkspaceChatTab,
} from "./sandbox-workspace-tabs";

void describe("sandbox workspace tabs", () => {
  void it("starts detail state on the summary tab", () => {
    const detail = createSandboxDetailState("sandbox_test");

    assert.deepEqual(detail.openWorkspaceTabs, [sandboxSummaryTab]);
    assert.deepEqual(detail.activeWorkspaceTab, sandboxSummaryTab);
  });

  void it("can close the summary tab and leave no active tab", () => {
    const detail = createSandboxDetailState("sandbox_test");

    closeWorkspaceTab(detail, sandboxSummaryTab);

    assert.deepEqual(detail.openWorkspaceTabs, []);
    assert.equal(detail.activeWorkspaceTab, undefined);
  });

  void it("allows closing the last chat tab", () => {
    const detail = createSandboxDetailState("sandbox_test");
    detail.openWorkspaceTabs = [{ kind: "chat", id: "conv_one" }];
    detail.activeWorkspaceTab = { kind: "chat", id: "conv_one" };

    closeWorkspaceTab(detail, { kind: "chat", id: "conv_one" });

    assert.deepEqual(detail.openWorkspaceTabs, []);
    assert.equal(detail.activeWorkspaceTab, undefined);
  });

  void it("can close multiple tabs and leave zero tabs", () => {
    const detail = createSandboxDetailState("sandbox_test");
    detail.openWorkspaceTabs = [
      sandboxSummaryTab,
      { kind: "chat", id: "conv_one" },
      { kind: "diagnostic", id: "logs" },
    ];
    detail.activeWorkspaceTab = { kind: "diagnostic", id: "logs" };

    closeWorkspaceTabs(detail, [...detail.openWorkspaceTabs]);

    assert.deepEqual(detail.openWorkspaceTabs, []);
    assert.equal(detail.activeWorkspaceTab, undefined);
  });

  void it("deletes pending conversation state when its tab closes", () => {
    const detail = createSandboxDetailState("sandbox_test");
    ensurePendingConversation(detail, "pending_test");
    openWorkspaceChatTab(detail, "pending_test");

    closeWorkspaceTab(detail, { kind: "chat", id: "pending_test" });

    assert.equal(detail.pendingConversationsById.pending_test, undefined);
  });
});
