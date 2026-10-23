import { test } from "node:test";
import assert from "node:assert/strict";
import { planMetadata } from "./released-metadata.js";
import { sha256 } from "./released-format.js";

await test("planning tool names and missing review approval profiles produce source-bound DML, not prose replacement", () => {
  const payload = JSON.stringify({
    toolName: "plan_mode_present",
    content: [{ type: "text", text: "plan_mode_present" }],
  });
  const interaction = JSON.stringify({
    kind: "plan_review",
    request: { title: "plan" },
  });
  const patches = planMetadata({
    events: [{ id: "event", payload }],
    calls: [{ id: "call", toolName: "plan_mode_present", interaction }],
  });
  assert.equal(patches.length, 3);
  assert.equal(patches[0].beforeDigest, sha256(payload));
  assert.equal(
    JSON.parse(patches[0].after).content[0].text,
    "plan_mode_present",
  );
  assert.equal(patches[1].column, "tool_name");
  assert.equal(patches[2].beforeDigest, sha256(interaction));
  assert.equal(JSON.parse(patches[2].after).request.approvalProfile, "coding");
  for (const approvalProfile of [null, "", "custom"]) {
    assert.deepEqual(
      planMetadata({
        events: [],
        calls: [
          {
            id: "preserved",
            toolName: "plan_present",
            interaction: JSON.stringify({
              kind: "plan_review",
              request: { approvalProfile },
            }),
          },
        ],
      }),
      [],
    );
  }
  assert.deepEqual(
    planMetadata({
      events: [],
      calls: [
        { id: "call", toolName: "plan_present", interaction: patches[2].after },
      ],
    }),
    [],
  );
});
