import assert from "node:assert/strict";
import { test } from "node:test";
import { canEditComposerDelegation } from "./composer-capability-controller";
import { conversationProfileScope } from "./conversation-profile-controller";

const projectId = "proj_one";
const pendingRoot = { projectId };
const lead = { id: "conv_lead", parentConversationId: null };
const child = { id: "conv_child", parentConversationId: lead.id };

test("pending root drafts can edit the master without acquiring a profile read scope", () => {
  assert.equal(
    canEditComposerDelegation(projectId, undefined, pendingRoot),
    true,
  );
  assert.equal(conversationProfileScope(projectId, undefined), undefined);
  assert.equal(canEditComposerDelegation(projectId, lead, undefined), true);
  assert.deepEqual(conversationProfileScope(projectId, lead), {
    projectId,
    conversationId: lead.id,
  });
});

test("saved children and unknown saved roles cannot delegate, even with a pending draft present", () => {
  assert.equal(canEditComposerDelegation(projectId, child, undefined), false);
  assert.equal(canEditComposerDelegation(projectId, child, pendingRoot), false);
  assert.equal(canEditComposerDelegation(projectId, {}, pendingRoot), false);
  assert.equal(conversationProfileScope(projectId, child), undefined);
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
