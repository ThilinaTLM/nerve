import { test } from "node:test";
import assert from "node:assert/strict";
import {
  prepareTitleInput,
  hasMeaningfulTitleInput,
  validateGeneratedTitle,
} from "./ai-title.js";

test("input strips fences and scaffolding, labels images and masks secrets", () => {
  const result = prepareTitleInput(
    "Fix the button @/screen.png\n```log\nprivate stack\n```\n<attachments>hidden</attachments> api_key=abcdef sk-1234567890123456",
  );
  assert.ok(result.includes("[image]"));
  assert.ok(result.includes("[secret]"));
  assert.doesNotMatch(result, /private stack|hidden|abcdef|123456/);
});
test("input samples start and end under the character cap", () => {
  const result = prepareTitleInput("START " + "middle ".repeat(1000) + " END");
  assert.ok(result.length <= 2400);
  assert.ok(result.startsWith("START"));
  assert.ok(result.endsWith("END"));
});
test("greetings and image-only text have no task", () => {
  for (const input of ["hello", "hi", "[image]", "thanks"])
    assert.equal(hasMeaningfulTitleInput(input), false);
  assert.equal(hasMeaningfulTitleInput("修复登录页面的按钮"), true);
});
test("output validation rejects invalid content without truncating", () => {
  for (const title of [
    "NONE",
    "",
    "One\nTwo",
    "I cannot help with that",
    "Sorry, I can't",
    "x".repeat(81),
    "Fix #999",
    "Review acme/other",
    "Title: fix button",
    "Fix\u0000button",
  ]) {
    assert.equal(
      validateGeneratedTitle(title, "Review acme/api#481 and fix button"),
      null,
      title,
    );
  }
  assert.equal(
    validateGeneratedTitle('"修复登录页面的按钮"', "修复登录页面的按钮"),
    "修复登录页面的按钮",
  );
  assert.equal(
    validateGeneratedTitle("Review acme/api#481", "Review acme/api#481"),
    "Review acme/api#481",
  );
});

test("common prefixed credentials and authorization schemes are masked", () => {
  const result = prepareTitleInput(
    "Fix auth with OPENAI_API_KEY=superprivate ACCESS_TOKEN=anotherprivate Authorization: Bearer privatebearer Authorization: Basic cHJpdmF0ZQ== postgres://user:databasepassword@db.local/app",
  );
  assert.doesNotMatch(
    result,
    /superprivate|anotherprivate|privatebearer|cHJpdmF0ZQ|databasepassword/,
  );
});
