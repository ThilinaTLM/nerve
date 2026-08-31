import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  registerWorkspaceFeaturePorts,
  workspaceFeaturePorts,
  type WorkspaceFeaturePorts,
} from "./workspace-feature-ports.svelte";

function fakePorts(onRemove: (ids: string[]) => void): WorkspaceFeaturePorts {
  return {
    conversations: {
      read: { openConversationTabIds: [] },
      commands: {
        removeConversationTabs: async (ids: string[]) => onRemove(ids),
      },
    },
  } as unknown as WorkspaceFeaturePorts;
}

describe("workspace feature ports", () => {
  it("forwards named commands and unregisters the installed ports", async () => {
    const removed: string[][] = [];
    const ports = fakePorts((ids) => removed.push(ids));
    const unregister = registerWorkspaceFeaturePorts(ports);

    assert.equal(workspaceFeaturePorts(), ports);
    await workspaceFeaturePorts().conversations.commands.removeConversationTabs(
      ["conv_1"],
    );
    assert.deepEqual(removed, [["conv_1"]]);

    unregister();
    assert.throws(
      () => workspaceFeaturePorts(),
      /Workspace feature ports are not registered/,
    );
  });

  it("does not let an old cleanup remove a newer registration", () => {
    const unregisterFirst = registerWorkspaceFeaturePorts(fakePorts(() => {}));
    const second = fakePorts(() => {});
    const unregisterSecond = registerWorkspaceFeaturePorts(second);

    unregisterFirst();
    assert.equal(workspaceFeaturePorts(), second);
    unregisterSecond();
  });
});

function compileTimeReadonlyContract(ports: WorkspaceFeaturePorts): void {
  // @ts-expect-error application consumers cannot mutate feature arrays
  ports.tasks.read.openTaskTabIds.push("task_1");
  // @ts-expect-error application consumers cannot replace feature map entries
  ports.conversations.read.conversationViews.conv_1 = {};
}
void compileTimeReadonlyContract;
