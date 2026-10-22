import assert from "node:assert/strict";
import { test } from "node:test";
import { canEditComposerDelegation } from "./composer-capability-controller";

const projectId = "proj_one";
const pendingRoot = { projectId };
const lead = { id: "conv_lead", parentConversationId: null };
const child = { id: "conv_child", parentConversationId: lead.id };

test("pending root drafts and saved leads can edit the delegation master", () => {
  assert.equal(
    canEditComposerDelegation(projectId, undefined, pendingRoot),
    true,
  );
  assert.equal(canEditComposerDelegation(projectId, lead, undefined), true);
});

test("saved children and unknown saved roles cannot delegate, even with a pending draft present", () => {
  assert.equal(canEditComposerDelegation(projectId, child, undefined), false);
  assert.equal(canEditComposerDelegation(projectId, child, pendingRoot), false);
  assert.equal(canEditComposerDelegation(projectId, {}, pendingRoot), false);
});

test("master editing requires an interactive target in the current project", () => {
  assert.equal(
    canEditComposerDelegation(projectId, undefined, pendingRoot, false),
    false,
  );
  assert.equal(
    canEditComposerDelegation(projectId, lead, undefined, false),
    false,
  );
  assert.equal(
    canEditComposerDelegation(undefined, undefined, pendingRoot),
    false,
  );
  assert.equal(
    canEditComposerDelegation(projectId, undefined, {
      projectId: "proj_other",
    }),
    false,
  );
  assert.equal(
    canEditComposerDelegation(projectId, undefined, undefined),
    false,
  );
});
