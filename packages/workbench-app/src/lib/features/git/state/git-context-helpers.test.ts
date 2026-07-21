import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GitContext } from "$lib/core/types/state-types";
import {
  GIT_CONTEXT_FOCUS_STALE_MS,
  GIT_OVERVIEW_AUTO_REFRESH_MS,
  shouldRefreshGitContextOnFocus,
} from "./git-context-helpers";

function context(projectId: string, loadedAt: number): GitContext {
  return { projectId, projectIsRepo: true, repos: [], loadedAt };
}

describe("Git refresh policy", () => {
  it("uses a thirty-second fallback cadence", () => {
    assert.equal(GIT_CONTEXT_FOCUS_STALE_MS, 30_000);
    assert.equal(GIT_OVERVIEW_AUTO_REFRESH_MS, 30_000);
  });

  it("refreshes missing, changed, or stale project context on focus", () => {
    assert.equal(
      shouldRefreshGitContextOnFocus(undefined, "project", 40_000, 30_000),
      true,
    );
    assert.equal(
      shouldRefreshGitContextOnFocus(
        context("other", 39_000),
        "project",
        40_000,
        30_000,
      ),
      true,
    );
    assert.equal(
      shouldRefreshGitContextOnFocus(
        context("project", 20_001),
        "project",
        40_000,
        30_000,
      ),
      false,
    );
    assert.equal(
      shouldRefreshGitContextOnFocus(
        context("project", 10_000),
        "project",
        40_000,
        30_000,
      ),
      true,
    );
  });
});
