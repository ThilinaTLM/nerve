import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkspaceMonitorPublisher } from "./workspace-monitor-publisher.js";

void test("monitor bridge forwards uncertain hints without upgrading them to hard cache invalidation", () => {
  const invalidations: {
    projectId: string;
    options?: { uncertain?: boolean };
  }[] = [];
  const forwarded: unknown[] = [];
  const publisher = createWorkspaceMonitorPublisher(
    {
      publishBestEffort: (type, data, context) => {
        forwarded.push({ type, data, context });
      },
    },
    {
      invalidateProjectReads: (projectId, options) => {
        invalidations.push({ projectId, options });
      },
    },
  );
  const data = {
    projectId: "proj_A",
    generation: 3,
    fullRefreshRequired: true,
    refreshCause: "uncertain_poll",
  };
  publisher.publishBestEffort("git.repository.invalidated", data, "monitor");
  assert.deepEqual(invalidations, [
    { projectId: "proj_A", options: { uncertain: true } },
  ]);
  assert.deepEqual(forwarded, [
    { type: "git.repository.invalidated", data, context: "monitor" },
  ]);
  publisher.publishBestEffort(
    "filesystem.project.changed",
    { projectId: "proj_A", generation: 4, fullRefreshRequired: true },
    "monitor",
  );
  assert.deepEqual(invalidations[1], {
    projectId: "proj_A",
    options: undefined,
  });
  assert.equal(forwarded.length, 2);
});
