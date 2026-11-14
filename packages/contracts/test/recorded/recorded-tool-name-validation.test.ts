import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  recordedToolNameSchema,
  toolNameSchema,
} from "../../src/domains/tools/records.js";

const retiredTools = [
  "task_cancel",
  "task_restart",
  "jira_get_issue",
  "confluence_get_page",
  "kroki_export",
  "generate_image",
] as const;

describe("retired tool names", () => {
  it("keeps historical records readable without keeping retired tools active", () => {
    for (const name of retiredTools) {
      assert.equal(recordedToolNameSchema.safeParse(name).success, true, name);
      assert.equal(toolNameSchema.safeParse(name).success, false, name);
    }
  });
});
