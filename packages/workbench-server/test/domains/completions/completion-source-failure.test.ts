import assert from "node:assert/strict";
import { test } from "node:test";
import { completionRemoteFailure } from "../../../src/domains/completions/completion-source-failure.js";

void test("GitHub failures use specific owner codes and offer only existing guidance destinations", () => {
  const cases = [
    [
      "GH_CLI_UNAVAILABLE",
      "GitHub CLI (gh) isn’t installed.",
      "open_pull_requests",
    ],
    ["GH_AUTH_REQUIRED", "GitHub CLI isn’t signed in.", "open_pull_requests"],
    ["GH_NO_REMOTE", "This project has no Git remote.", undefined],
    ["GH_NO_GITHUB_REMOTE", "This project has no GitHub remote.", undefined],
    [
      "GH_RATE_LIMITED",
      "GitHub’s rate limit was reached. Try again later.",
      undefined,
    ],
    ["GH_API_UNAVAILABLE", "GitHub is unreachable.", undefined],
    [
      "GH_FORBIDDEN",
      "GitHub denied access. Check your token permissions.",
      undefined,
    ],
    [
      "GH_NOT_FOUND",
      "The GitHub repository wasn’t found or isn’t accessible.",
      undefined,
    ],
  ] as const;
  for (const [code, reason, action] of cases) {
    const notice = completionRemoteFailure(code, false);
    assert.equal(notice.reason, reason, code);
    assert.equal(notice.action, action, code);
    const cached = completionRemoteFailure(code, true);
    assert.equal(
      cached.reason,
      `${reason.slice(0, -1)} — showing cached results.`,
      code,
    );
    assert.equal(cached.action, action, code);
  }
  assert.deepEqual(
    completionRemoteFailure("private failure with token", false),
    {
      reason: "GitHub data couldn’t be loaded.",
    },
  );
});
