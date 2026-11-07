import assert from "node:assert/strict";
import { test } from "node:test";
import {
  profileReviewAction,
  registerProfileReviewHandler,
} from "./profile-review-requests";

test("the action reaches the mounted handler and is a no-op after unregister", () => {
  let opened = 0;
  const action = profileReviewAction("conv_a");
  action.onClick();
  assert.equal(opened, 0);
  const unregister = registerProfileReviewHandler("conv_a", () => opened++);
  action.onClick();
  assert.equal(opened, 1);
  unregister();
  action.onClick();
  assert.equal(opened, 1);
});

test("a stale unregister does not remove a newer handler", () => {
  let opened = "";
  const stale = registerProfileReviewHandler("conv_b", () => (opened = "old"));
  registerProfileReviewHandler("conv_b", () => (opened = "new"));
  stale();
  profileReviewAction("conv_b").onClick();
  assert.equal(opened, "new");
});
