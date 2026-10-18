import assert from "node:assert/strict";
import { test } from "node:test";
import { filesystemEventDefinitions } from "../../src/domains/filesystem/events.js";

const schema = filesystemEventDefinitions[0].payloadSchema;
const payload = {
  projectId: "proj_synthetic",
  generation: 7,
  directories: ["src"],
  fullRefreshRequired: true,
};

test("filesystem refresh marker is optional and preserves generation/full-refresh semantics", () => {
  assert.deepEqual(schema.parse(payload), payload);
  assert.deepEqual(
    schema.parse({ ...payload, refreshCause: "uncertain_poll" }),
    { ...payload, refreshCause: "uncertain_poll" },
  );
});

test("filesystem events only accept the transport-neutral uncertain poll marker", () => {
  for (const refreshCause of [
    "poll_error",
    "poll",
    "filesystem",
    "manual",
    "overflow",
  ]) {
    assert.throws(() => schema.parse({ ...payload, refreshCause }));
  }
});
