import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeFileMonitorState,
  describeGitStatusErrors,
  limitMonitoredDirectories,
} from "./file-panel-status";

const healthy = { active: true, degraded: false, watchedDirectoryCount: 3 };

describe("file panel status", () => {
  it("keeps the root and the most recently expanded folders within the cap", () => {
    assert.deepEqual(limitMonitoredDirectories(["", "a", "a", "b"], 3), {
      directories: ["", "a", "b"],
      requestedCount: 3,
    });
    assert.deepEqual(limitMonitoredDirectories(["", "a", "b", "c", "d"], 3), {
      directories: ["", "c", "d"],
      requestedCount: 5,
    });
  });

  it("reports monitor problems and stays quiet when healthy", () => {
    assert.equal(describeFileMonitorState(healthy, 3, 3), undefined);
    assert.match(
      describeFileMonitorState({ ...healthy, degraded: true }, 3, 3) ?? "",
      /degraded/,
    );
    assert.match(
      describeFileMonitorState({ ...healthy, active: false }, 3, 3) ?? "",
      /off/,
    );
    assert.match(
      describeFileMonitorState(healthy, 600, 512) ?? "",
      /512 of 600/,
    );
  });

  it("summarizes Git read errors", () => {
    assert.equal(describeGitStatusErrors([]), undefined);
    const error = { category: "io", message: "boom", retryable: true };
    assert.equal(
      describeGitStatusErrors([
        { ...error, repo: "." },
        { ...error, repo: "vendor/lib" },
      ]),
      "Git status is incomplete for the project repository: boom (+1 more)",
    );
  });
});
