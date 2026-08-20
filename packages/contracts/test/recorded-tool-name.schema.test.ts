import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  recordedToolNameSchema,
  toolNameSchema,
} from "../src/domains/tools/records.schema.js";

const retiredTools = [
  "task_cancel",
  "task_restart",
  "jira_add_comment",
  "confluence_download_pages",
  "confluence_publish_pages",
  "confluence_upload_attachment",
] as const;

describe("retired tool names", () => {
  it("keeps historical records readable without keeping retired tools active", () => {
    for (const name of retiredTools) {
      assert.equal(recordedToolNameSchema.safeParse(name).success, true, name);
      assert.equal(toolNameSchema.safeParse(name).success, false, name);
    }
  });
});
