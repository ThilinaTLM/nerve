import assert from "node:assert/strict";
import test from "node:test";
import { extensionChangeAffects } from "./extension-scope.js";

const user = { scope: "user" } as const;
const project = (projectId: string) =>
  ({ scope: "project", projectId }) as const;

test("a user change reaches the user view and project views that inherit it", () => {
  assert.equal(extensionChangeAffects(user, user), true);
  assert.equal(extensionChangeAffects(user, project("a")), true);
});

test("a project change reaches only that project", () => {
  assert.equal(extensionChangeAffects(project("a"), project("a")), true);
  assert.equal(extensionChangeAffects(project("a"), project("b")), false);
  assert.equal(extensionChangeAffects(project("a"), user), false);
});

test("a conversation change reaches only that conversation", () => {
  const changed = { scope: "conversation", conversationId: "c1" } as const;
  assert.equal(extensionChangeAffects(changed, user), false);
  assert.equal(extensionChangeAffects(changed, changed), true);
});
