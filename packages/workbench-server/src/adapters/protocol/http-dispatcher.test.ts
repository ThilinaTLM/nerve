import assert from "node:assert/strict";
import { test } from "node:test";
import { GitWorkflowError, type GitService } from "@nervekit/tools/git";
import { z } from "zod";
import { ApplicationError } from "../../core/application-error.js";
import { withGitMutationEvents } from "../../domains/git/git-mutation-publisher.js";
import { translateError } from "./http-dispatcher.js";

void test("translation adds reported Activity metadata without changing error semantics or redaction", async () => {
  const validation = z
    .object({ password: z.string() })
    .safeParse({ password: 1 });
  assert.equal(validation.success, false);
  const errors = [
    new ApplicationError(409, "GIT_CONFLICT", "Conflict", { retryable: false }),
    new GitWorkflowError(422, "GIT_INVALID", "Invalid mutation"),
    new Error("Unexpected mutation failure"),
    validation.error,
  ];
  for (const original of errors) {
    const before = translateError(original);
    assert.equal(before.details?.activityId, undefined);
    const git = {
      switchBranch: async () => {
        throw original;
      },
    } as unknown as GitService;
    const decorated = withGitMutationEvents(
      git,
      { publish() {} },
      {
        start: () => ({
          id: "activity_reported",
          progress() {},
          succeed() {},
          cancelled() {},
          interrupt() {},
          fail() {},
        }),
      },
    );
    await assert.rejects(
      decorated.switchBranch("proj_test", ".", "main"),
      (error: unknown) => error === original,
    );
    assert.deepEqual(translateError(original), {
      ...before,
      details: { ...before.details, activityId: "activity_reported" },
    });
  }
  assert.deepEqual(translateError(validation.error).details, {
    formErrors: [],
    fieldErrors: { password: "[REDACTED]" },
    activityId: "activity_reported",
  });
});

void test("unreported failures, including primitives, have no Activity metadata", async () => {
  for (const original of [
    new GitWorkflowError(503, "UNAVAILABLE", "Unavailable"),
    null,
    "failure",
  ]) {
    const before = translateError(original);
    const git = {
      switchBranch: async () => {
        throw original;
      },
    } as unknown as GitService;
    const decorated = withGitMutationEvents(
      git,
      { publish() {} },
      {
        start: () => ({
          id: "not_reported",
          progress() {},
          succeed() {},
          cancelled() {},
          interrupt() {},
          fail() {
            throw new Error("report failed");
          },
        }),
      },
    );
    await assert.rejects(
      decorated.switchBranch("proj_test", ".", "main"),
      (error: unknown) => error === original,
    );
    assert.deepEqual(translateError(original), before);
    assert.equal(translateError(original).details?.activityId, undefined);
  }
  assert.equal(
    translateError(new GitWorkflowError(503, "UNAVAILABLE", "Unavailable"))
      .code,
    "SERVICE_UNAVAILABLE",
  );
});
