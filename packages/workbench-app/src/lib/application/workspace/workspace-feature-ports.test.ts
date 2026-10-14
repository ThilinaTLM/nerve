import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  registerWorkspaceFeaturePorts,
  workspaceFeaturePorts,
  type WorkspaceFeaturePorts,
} from "./workspace-feature-ports.svelte";

function fakePorts(): WorkspaceFeaturePorts {
  return {} as WorkspaceFeaturePorts;
}

describe("workspace feature ports", () => {
  it("does not let an old cleanup remove a newer registration", () => {
    const unregisterFirst = registerWorkspaceFeaturePorts(fakePorts());
    const second = fakePorts();
    const unregisterSecond = registerWorkspaceFeaturePorts(second);

    unregisterFirst();
    assert.equal(workspaceFeaturePorts(), second);
    unregisterSecond();
    assert.throws(
      () => workspaceFeaturePorts(),
      /Workspace feature ports are not registered/,
    );
  });
});

function compileTimeReadonlyContract(ports: WorkspaceFeaturePorts): void {
  // @ts-expect-error application consumers cannot mutate feature arrays
  ports.launches.read.openLaunchTabIds.push("launch_1");
  // @ts-expect-error application consumers cannot replace feature map entries
  ports.conversations.read.asyncBashes.bash_1 = {};
  // @ts-expect-error application consumers cannot mutate known pending work
  ports.conversations.read.pendingAsyncConversationIds.add("conv_1");
  // @ts-expect-error application consumers cannot replace known pending work
  ports.conversations.read.pendingAsyncConversationIds = new Set();
}
void compileTimeReadonlyContract;
